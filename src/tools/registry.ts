/**
 * 工具注册表（M6，PRD §7.3 / CONTRACTS §6 ToolName / ARCHITECTURE §1 tools/registry.ts）。
 * 职责：白名单注册、每工具日限额、offline 标注、调用经 ToolInvokerPort 进 orchestrator，
 * 调用流水走事件流（tool_call/tool_result → composition 桥接进 session_events 集合，
 * 与 SessionEvent 同源落盘；CONTRACTS §9 事件流机制对齐——domain/events.ts 联合类型不扩，V1 记流水）。
 *
 * 调用语义（orchestrator/machine.invokeTool 契约）：
 *  - 未知工具 / 超日限额 → **抛错**（计入 tool_failures 连续失败升级）；
 *  - 环境不可用（无语音桥/无云 Key）与业务失败 → **返回 { ok:false, error }**（降级不阻塞主流程，
 *    与 NoopToolInvoker 非抛语义一致，工具失败升级只针对"连续"异常）。
 */
import type { ToolInvokerPort } from '../orchestrator/ports';
import type { ToolName } from '../skills/runtime';
import { recognizeImage, type VisionCloudPort, type VisionResult } from './vision';
import { speak, stopSpeak, type SpeechNativeBridge } from './tts';
import { startListening } from './asr';

/** 工具描述符（白名单条目；offline=true = 端侧离线，语音数据不出端 §7.3）。 */
export interface ToolDescriptor {
  name: ToolName;
  description: string;
  offline: boolean;
  /** 每日调用上限（PRD §7.3 "有限额"未定值，取安全默认；调整改此表即可）。 */
  dailyLimit: number;
}

/** 日限额表（web_search 未接入前也先占位限额，接入即生效）。 */
export const TOOL_DAILY_LIMITS: Record<ToolName, number> = {
  web_search: 20,
  vision_capture: 20,
  tts_speak: 200,
  asr_transcribe: 100,
};

/** 白名单（CONTRACTS §6 ToolName 联合，注册表即白名单的事实源）。 */
export const TOOL_WHITELIST: readonly ToolDescriptor[] = [
  { name: 'web_search', description: '联网搜索（资料库没有的/时效性内容；结果再加工后呈现，必留出处，§7.3）', offline: false, dailyLimit: TOOL_DAILY_LIMITS.web_search },
  { name: 'vision_capture', description: '识图：拍题/拍书页/拍板书 → 多模态结论（sub-agent 独立窗口，§7.7⑤）', offline: false, dailyLimit: TOOL_DAILY_LIMITS.vision_capture },
  { name: 'tts_speak', description: '端侧离线语音合成（sherpa-onnx + Kokoro，语速接画像偏好）', offline: true, dailyLimit: TOOL_DAILY_LIMITS.tts_speak },
  { name: 'asr_transcribe', description: '端侧离线流式识别（流式 zipformer；仅档4 费曼启用 + 文字兜底）', offline: true, dailyLimit: TOOL_DAILY_LIMITS.asr_transcribe },
];

/** 工具事件（调用流水；composition 桥接进 session_events 集合，§7.8④ 埋点同源）。 */
export interface ToolEvent {
  type: 'tool_call' | 'tool_result';
  name: string;
  at: string; // ISODate
  ok?: boolean; // 仅 tool_result
  error?: string; // 仅 tool_result
  durationMs?: number; // 仅 tool_result
}

export type ToolEventSink = (event: ToolEvent) => void;

/** web_search 可配置后端（M7 T3b）：settings 配 endpoint+key；空 = 工具返回 not-configured 业务失败。 */
export interface SearchBackend {
  /** 搜索服务端点（POST，JSON { query }；响应 JSON {results|data:[...]} 或数组，其余原文透传）。 */
  endpoint: string;
  /** 可选 Bearer 鉴权 Key。 */
  apiKey?: string;
}

/** 日限额计数存储（KV 持久化；按日期分桶，读时清理过期桶）。 */
export interface ToolUsageStore {
  countFor(date: string, name: string): Promise<number>;
  increment(date: string, name: string): Promise<void>;
}

const TOOL_USAGE_KEY = 'edu:col:tool_usage';

/** web_search 请求超时（M7 T3b；对齐云侧默认超时量级）。 */
const SEARCH_TIMEOUT_MS = 15_000;

type ToolUsageShape = Record<string, Partial<Record<string, number>>>;

/** KV 日限额存储（keys() 清过期桶；损坏集合从空重记——限额计数可丢不可阻）。 */
export function createKvToolUsageStore(kv: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; keys(): Promise<string[]> }): ToolUsageStore {
  async function load(): Promise<ToolUsageShape> {
    try {
      const raw = await kv.get(TOOL_USAGE_KEY);
      return raw === null ? {} : (JSON.parse(raw) as ToolUsageShape);
    } catch {
      return {};
    }
  }
  async function save(all: ToolUsageShape): Promise<void> {
    await kv.set(TOOL_USAGE_KEY, JSON.stringify(all));
  }
  return {
    async countFor(date, name) {
      const all = await load();
      return all[date]?.[name] ?? 0;
    },
    async increment(date, name) {
      const all = await load();
      const bucket = { ...(all[date] ?? {}) };
      bucket[name] = (bucket[name] ?? 0) + 1;
      // 只保留今天（限额按日，历史桶无价值）
      const pruned: ToolUsageShape = { [date]: bucket };
      await save(pruned);
    },
  };
}

export interface ToolInvokerDeps {
  /** 识图云侧端口（composition 注入：有 Key → createDeepSeekVisionClient；无 Key → 显式「未配置」降级结果）。 */
  vision: VisionCloudPort;
  /** 语音原生桥（探测结果；null = web/测试环境，语音工具返回 unavailable）。 */
  speechBridge: SpeechNativeBridge | null;
  /** web_search 后端（M7 T3b：composition 从 settings 注入；缺省 = not-configured 业务失败）。 */
  search?: SearchBackend;
  /** 事件流水（tool_call/tool_result；composition 桥接 session_events）。 */
  onEvent?: ToolEventSink;
  /** 限额存储（缺省内存实现——单会话级；真机注入 KV 版持久化）。 */
  usage?: ToolUsageStore;
  now?: () => Date;
}

function createMemoryUsageStore(): ToolUsageStore {
  const counts = new Map<string, number>();
  return {
    async countFor(date, name) {
      return counts.get(`${date}\u0000${name}`) ?? 0;
    },
    async increment(date, name) {
      const key = `${date}\u0000${name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
  };
}

export interface ToolInvokerPortExt extends ToolInvokerPort {
  /** 白名单只读视图（Skill 校验/调试用）。 */
  descriptors: readonly ToolDescriptor[];
}

/**
 * 构建真实工具调用器（M6 接入 composition，替换 NoopToolInvoker；Noop 保留测试用）。
 * 每次调用：白名单核验 → 日限额核验 → tool_call 事件 → 执行 → tool_result 事件。
 */
export function createToolInvoker(deps: ToolInvokerDeps): ToolInvokerPortExt {
  const usage = deps.usage ?? createMemoryUsageStore();
  const now = deps.now ?? (() => new Date());
  const descriptorsByName = new Map(TOOL_WHITELIST.map((d) => [d.name, d]));
  let seq = 0;

  function emit(event: ToolEvent): void {
    try {
      deps.onEvent?.(event);
    } catch {
      // 事件流水失败不阻塞工具调用（可丢不可阻，同 session_events 口径）
    }
  }

  function today(): string {
    return now().toISOString().slice(0, 10);
  }

  async function checkGate(name: string): Promise<ToolDescriptor> {
    const descriptor = descriptorsByName.get(name as ToolName);
    if (descriptor === undefined) {
      throw new Error(`tool_not_allowed: ${name} 不在白名单（§7.3）`);
    }
    const used = await usage.countFor(today(), name);
    if (used >= descriptor.dailyLimit) {
      throw new Error(`quota_exceeded: ${name} 今日已用 ${used}/${descriptor.dailyLimit}`);
    }
    return descriptor;
  }

  // ── 各工具实现 ──────────────────────────────────────────────

  /** tts_speak：args { text, rate? } → 端侧合成播放。环境不可用/失败返回 {ok:false}（不抛，口播可降级）。 */
  async function invokeTts(args: unknown): Promise<unknown> {
    const { text, rate } = (args ?? {}) as { text?: unknown; rate?: unknown };
    if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'invalid_args: text 必填' };
    if (deps.speechBridge === null) return { ok: false, error: 'speech_unavailable', unavailable: true };
    const result = await speak(text, { rate: typeof rate === 'number' ? rate : 1 });
    return result;
  }

  /** asr_transcribe：一次性听写（录音→首个定稿或超时→停）→ { ok, text }。 */
  async function invokeAsr(args: unknown): Promise<unknown> {
    const { maxWaitMs } = (args ?? {}) as { maxWaitMs?: unknown };
    if (deps.speechBridge === null) return { ok: false, error: 'speech_unavailable', unavailable: true };
    let firstFinal = '';
    const session = await startListening({ onFinal: (t) => { if (firstFinal === '') firstFinal = t; } });
    if (!('stop' in session)) return { ok: false, error: (session as { error: string }).error };
    const wait = typeof maxWaitMs === 'number' && maxWaitMs > 0 ? maxWaitMs : 15_000;
    await new Promise<void>((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (firstFinal !== '' || Date.now() - startedAt >= wait) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
    const text = await session.stop();
    return { ok: text.length > 0, ...(text.length > 0 ? { text } : { error: 'asr_empty：走文字兜底' }) };
  }

  /** vision_capture：args { imageDataUrl, hint? } → 识图结论（sub-agent 独立窗口）。失败返回 {ok:false}（降级）。 */
  async function invokeVision(args: unknown): Promise<unknown> {
    const { imageDataUrl, hint } = (args ?? {}) as { imageDataUrl?: unknown; hint?: unknown };
    if (typeof imageDataUrl !== 'string') return { ok: false, error: 'invalid_args: imageDataUrl 必填' };
    const result: VisionResult = await recognizeImage(
      { imageDataUrl, hint: typeof hint === 'string' ? hint : undefined },
      deps.vision,
    );
    return result;
  }

  /** web_search：可配置后端（M7 T3b）。未配置 = {ok:false, not_configured} 业务失败不抛错；
   *  已配置 = 原生 fetch POST（无新依赖，同 updater defaultFetch 口径），失败降级结果对象。 */
  async function invokeSearch(args: unknown): Promise<unknown> {
    const { query } = (args ?? {}) as { query?: unknown };
    if (typeof query !== 'string' || query.trim().length === 0) {
      return { ok: false, error: 'invalid_args: query 必填' };
    }
    const backend = deps.search;
    if (backend === undefined || backend.endpoint.trim() === '') {
      return { ok: false, error: 'not_configured: web_search 后端未配置（设置页配置端点后可用，§7.3 结果必留出处）' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (backend.apiKey !== undefined && backend.apiKey.length > 0) {
        headers['Authorization'] = `Bearer ${backend.apiKey}`;
      }
      const res = await fetch(backend.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: query.trim() }),
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, error: `search_http: HTTP ${res.status}` };
      const text = await res.text();
      try {
        const parsed: unknown = JSON.parse(text);
        // 常见形状容忍：数组 / {results:[]} / {data:[]}；其余原文透传（调用方按 ⑧ 段 digest 消费）
        if (Array.isArray(parsed)) return { ok: true, query, results: parsed };
        if (parsed !== null && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          const results = Array.isArray(obj['results']) ? obj['results'] : Array.isArray(obj['data']) ? obj['data'] : undefined;
          if (results !== undefined) return { ok: true, query, results };
        }
        return { ok: true, query, raw: text.slice(0, 2000) };
      } catch {
        return { ok: true, query, raw: text.slice(0, 2000) };
      }
    } catch (e) {
      const reason = e instanceof Error && e.name === 'AbortError' ? 'search_timeout' : 'search_failed';
      return { ok: false, error: `${reason}: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  const handlers: Record<ToolName, (args: unknown) => Promise<unknown>> = {
    web_search: (args) => invokeSearch(args),
    vision_capture: (args) => invokeVision(args),
    tts_speak: (args) => invokeTts(args),
    asr_transcribe: (args) => invokeAsr(args),
  };

  return {
    descriptors: TOOL_WHITELIST,

    async callTool(name: string, args: unknown): Promise<unknown> {
      seq += 1;
      const descriptor = await checkGate(name);
      const at = now().toISOString();
      emit({ type: 'tool_call', name, at });
      const startedAt = Date.now();
      let result: unknown;
      let error: string | undefined;
      try {
        result = await handlers[descriptor.name](args);
        if (
          result !== null && typeof result === 'object'
          && 'ok' in (result as Record<string, unknown>)
          && (result as Record<string, unknown>)['ok'] === false
        ) {
          error = String((result as Record<string, unknown>)['error'] ?? 'tool_error');
        }
        await usage.increment(today(), name); // 成功/业务失败都计次（防刷）；白名单/限额拒绝不计
      } catch (err) {
        await usage.increment(today(), name);
        error = err instanceof Error ? err.message : String(err);
        emit({ type: 'tool_result', name, at: now().toISOString(), ok: false, error, durationMs: Date.now() - startedAt });
        throw err; // 未知工具/超限额 → 机器侧计入连续失败（升级通道）
      }
      emit({
        type: 'tool_result', name, at: now().toISOString(),
        ok: error === undefined, ...(error !== undefined ? { error } : {}),
        durationMs: Date.now() - startedAt,
      });
      return result;
    },
  };
}

// stopSpeak 由 TTSBar（M6 组件接线）与 stop 类入口使用；此处 re-export 保持 tools 层单一出口。
export { stopSpeak };
