/**
 * MockCloudClient（M2c，D7 无 Key 模式的默认客户端）。
 * 按当前 Skill 模板与任务指令产出确定性的合法 A2UI JSONL（四档典型流见 streams.ts）；
 * 模拟流式分块回调（每行一个 chunk）；延迟可注入（测试判定时延路径）；
 * completeText 返回确定性升级建议（可注入文本，配合 EscalationManager 验证单次升级逻辑）。
 * calls 记录每次调用（modelRole/prompt），供测试断言"只发了一次 pro 请求"。
 */
import type {
  CloudLikeClient,
  CloudModelRole,
  CloudStreamResult,
  CompleteTextParams,
  CompleteTextResult,
  StreamChatParams,
} from '../client';
import { buildRequest } from '../context-builder';
import { buildMockA2UILines } from './streams';

/** Mock 升级默认建议（确定性）。 */
export const MOCK_ESCALATION_NEXT_STEP =
  '把当前 ALU 拆成两个更小的判断点，先讲第一个判断点的例子，讲完立刻用一道二选一自检题确认。';

export interface MockCloudClientOptions {
  /** 模拟流式块间延迟（默认 0；测试注入以验证时延路径）。 */
  delayMs?: number;
  /** sleep 注入（测试用）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 注入 completeText 应答文本（升级建议），默认 MOCK_ESCALATION_NEXT_STEP。 */
  completeTextResponse?: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 确定性 token 估算（约 4 字符/token；与真实用量同数量级即可）。 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface MockCallRecord {
  kind: 'streamChat' | 'completeText';
  modelRole: CloudModelRole;
  promptChars: number;
  mode?: string;
}

export class MockCloudClient implements CloudLikeClient {
  private readonly options: Required<Pick<MockCloudClientOptions, 'delayMs'>> & MockCloudClientOptions;
  /** 调用记录（测试断言：升级只发一次 pro 请求等）。 */
  readonly calls: MockCallRecord[] = [];

  constructor(options: MockCloudClientOptions = {}) {
    this.options = { delayMs: options.delayMs ?? 0, ...options };
  }

  async streamChat(params: StreamChatParams): Promise<CloudStreamResult> {
    const role = params.modelRole ?? 'flash';
    const mode = params.segments.taskInstruction.mode;
    const aluIds = params.segments.taskInstruction.aluIds;
    const promptChars = buildRequest(params.segments).messages.reduce((sum, m) => sum + m.content.length, 0);
    this.calls.push({ kind: 'streamChat', modelRole: role, promptChars, mode });

    const lines = buildMockA2UILines({ mode, aluIds });
    // 模拟流式分块：每行一个 chunk，块间可注入延迟
    for (const [index, l] of lines.entries()) {
      if (index > 0) await this.doSleep();
      params.callbacks?.onTextDelta?.(`${l}\n`);
    }
    return {
      a2uiLines: lines,
      usage: {
        promptTokens: Math.ceil(promptChars / 4),
        completionTokens: estimateTokens(lines.join('\n')),
        cacheHit: true, // ①②③前缀命中（Mock 假定稳定前缀生效）
      },
      modelUsed: role,
    };
  }

  async completeText(params: CompleteTextParams): Promise<CompleteTextResult> {
    const role = params.modelRole ?? 'flash';
    this.calls.push({ kind: 'completeText', modelRole: role, promptChars: params.prompt.length });
    const text = this.options.completeTextResponse ?? MOCK_ESCALATION_NEXT_STEP;
    return {
      text,
      usage: {
        promptTokens: estimateTokens(params.prompt),
        completionTokens: estimateTokens(text),
        cacheHit: false, // 升级请求为最小化上下文，不走稳定前缀
      },
    };
  }

  private async doSleep(): Promise<void> {
    const sleep = this.options.sleep ?? defaultSleep;
    if (this.options.delayMs > 0) await sleep(this.options.delayMs);
  }
}
