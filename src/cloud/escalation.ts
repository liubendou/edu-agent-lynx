/**
 * 卡死升级（M2c，CONTRACTS §7 / ARCHITECTURE §7 / PRD §7.6，学 Trae Advisor 模式）。
 * 五类卡死信号（同义重试不收敛/工具连续失败/输出反复偏离/用户明显不满或纠错/模型自评低置信）
 * → 触发后向 pro 发一次请求、上下文最小化（只带"卡在哪+目标"）、拿到建议即切回 flash 执行；
 * 每次卡死只升一次（会话内去重）；升级与结果产出 skill_escalation 事件（供画像
 * "这个点在 Flash 上卡过"留痕）。升级配额由 budget.ts 护栏。
 */
import type { SkillName } from '../domain/types';
import type { SessionEvent } from '../domain/events';
import { createSkillEscalationEvent } from '../domain/events';
import type { CloudLikeClient } from './client';
import type { BudgetGuard } from './budget';

/** 卡死升级信号（CONTRACTS §7；M2-int 归位自 domain/types.ts）。（§7.6：五类触发） */
export type EscalationSignal =
  | { type: 'retry_no_converge'; turns: number }     // 同义重试连续不收敛
  | { type: 'tool_failures'; consecutive: number }   // 工具连续失败
  | { type: 'output_deviation'; detail: string }     // 输出反复偏离目标
  | { type: 'user_correction'; detail: string }      // 用户明显不满或纠错
  | { type: 'low_confidence'; selfReport: string };  // 模型自评低置信

/** 升级结果（CONTRACTS §7；M2-int 归位自 domain/types.ts） */
export interface EscalationResult {
  nextStep: string;          // 拿到"下一步怎么做"，随即切回 flash 执行
  loggedToFacts: boolean;    // 记入学习事实层（"这个点在 Flash 上卡过"）
}

/** 同义重试连续不收敛阈值（连续 N 次用户同义重试 → 卡死信号）。 */
export const RETRY_NO_CONVERGE_THRESHOLD = 3;
/** 工具连续失败阈值。 */
export const TOOL_FAILURE_THRESHOLD = 2;

/** 升级请求（CONTRACTS §7）：单次；上下文最小化只带"卡在哪+目标"。 */
export interface EscalationRequest {
  stuckAt: string;
  goal: string;
  skill: SkillName;
}

/** 会话观察输入：StuckDetector 累积计数并按阈值产出 EscalationSignal。 */
export type StuckObservation =
  | { kind: 'user_retry' }                        // 用户同义重试一次
  | { kind: 'tool_failure' }                       // 工具调用失败一次
  | { kind: 'output_deviation'; detail: string }   // 输出反复偏离（直通）
  | { kind: 'user_correction'; detail: string }    // 用户明显不满或纠错（直通）
  | { kind: 'model_low_confidence'; selfReport: string }; // 模型自评低置信（直通）

/** 五类信号检测器：累积计数 + 阈值判定（CONTRACTS §7 EscalationSignal）。 */
export class StuckDetector {
  private retryCount = 0;
  private toolFailureCount = 0;

  /** 观察一次；达到阈值返回 EscalationSignal（否则 null）。 */
  observe(obs: StuckObservation): EscalationSignal | null {
    switch (obs.kind) {
      case 'user_retry':
        this.retryCount += 1;
        break;
      case 'tool_failure':
        this.toolFailureCount += 1;
        break;
      case 'output_deviation':
        return { type: 'output_deviation', detail: obs.detail };
      case 'user_correction':
        return { type: 'user_correction', detail: obs.detail };
      case 'model_low_confidence':
        return { type: 'low_confidence', selfReport: obs.selfReport };
    }
    if (this.retryCount >= RETRY_NO_CONVERGE_THRESHOLD) {
      return { type: 'retry_no_converge', turns: this.retryCount };
    }
    if (this.toolFailureCount >= TOOL_FAILURE_THRESHOLD) {
      return { type: 'tool_failures', consecutive: this.toolFailureCount };
    }
    return null;
  }

  /** 收敛/成功后清零（卡死计数不跨故障累积）。 */
  reset(): void {
    this.retryCount = 0;
    this.toolFailureCount = 0;
  }
}

/** 升级建议兜底（pro 请求失败拿不到建议时不给空 nextStep）。 */
export const FALLBACK_NEXT_STEP = '把当前 ALU 拆成更小的步骤，从最近一次用户答对的地方继续讲，先给一个具体例子再提问。';

/** 上下文最小化 prompt：只带"卡在哪+目标"，不带八段长上下文。 */
export function buildEscalationPrompt(request: EscalationRequest): string {
  return [
    '你是教学督导（Advisor 模式）。当前 Flash 模型在教学中卡死，请基于以下最小信息，给出"下一步怎么做"的一条可执行建议。',
    `卡在: ${request.stuckAt}`,
    `目标: ${request.goal}`,
    `当前档位: ${request.skill}`,
    '只输出一条建议本身，不要展开讲解，不要输出组件 JSON。',
  ].join('\n');
}

/** 卡死信号去重键：类型 + 语义详情（同类型计数型信号视为同一卡点——"会话内去重"口径）。 */
export function escalationKey(signal: EscalationSignal): string {
  switch (signal.type) {
    case 'output_deviation':
    case 'user_correction':
      return `${signal.type}:${signal.detail}`;
    case 'low_confidence':
      return `low_confidence:${signal.selfReport}`;
    default:
      return signal.type;
  }
}

export type EscalationOutcome =
  | { escalated: true; result: EscalationResult; signal: EscalationSignal }
  | { escalated: false; reason: 'duplicate' | 'budget_exhausted' };

export interface EscalationDeps {
  client: CloudLikeClient;
  budget: BudgetGuard;
  /** 升级与结果事件回调（orchestrator 消费 → 画像学习事实层留痕）。 */
  onEvent?: (event: SessionEvent) => void;
}

/** 单次升级管理器：会话内去重（每次卡死只升一次）+ 配额护栏 + 事件留痕。 */
export class EscalationManager {
  private readonly deps: EscalationDeps;
  private readonly escalatedKeys = new Set<string>();

  constructor(deps: EscalationDeps) {
    this.deps = deps;
  }

  /** 该信号是否已升过（会话内去重）。 */
  hasEscalated(signal: EscalationSignal): boolean {
    return this.escalatedKeys.has(escalationKey(signal));
  }

  /**
   * 升级入口：去重 → 配额 → 向 pro 发一次最小化请求 → 产出事件与结果。
   * 第二次同信号不再升（duplicate）；配额尽不升（budget_exhausted）。
   */
  async escalate(signal: EscalationSignal, request: EscalationRequest): Promise<EscalationOutcome> {
    const key = escalationKey(signal);
    if (this.escalatedKeys.has(key)) {
      return { escalated: false, reason: 'duplicate' };
    }
    const allowed = await this.deps.budget.recordEscalation();
    if (allowed === null) {
      return { escalated: false, reason: 'budget_exhausted' };
    }
    // 上下文最小化：只带"卡在哪+目标"，用 pro 模型，单次
    const { text } = await this.deps.client.completeText({
      prompt: buildEscalationPrompt(request),
      modelRole: 'pro',
    });
    const result: EscalationResult = {
      nextStep: text.trim().length > 0 ? text.trim() : FALLBACK_NEXT_STEP,
      loggedToFacts: true, // 记入学习事实层（"这个点在 Flash 上卡过"）
    };
    this.escalatedKeys.add(key);
    this.deps.onEvent?.(createSkillEscalationEvent(signal, result));
    return { escalated: true, result, signal };
  }
}
