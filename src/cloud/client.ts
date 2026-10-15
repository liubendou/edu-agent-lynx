/**
 * DeepSeek 云侧客户端（M2c，CONTRACTS §7 / ARCHITECTURE §7、§12）。
 * OpenAI 兼容接口：POST {base}/chat/completions，原生 fetch，不引 SDK。
 * 流式 SSE 解析 chat.completion.chunk → 文本增量/工具调用增量回调；
 * 超时与错误分类（网络/限流/内容过滤）+ 重试（幂等才重试：
 * 一旦已向调用方产出增量则不重试，避免重复生成/重复计费）。
 * 稳定前缀缓存纪律落在请求层：①②③经 context-builder 拼为字节级固定字符串，
 * ④~⑧动态追加，history 只追加。
 */
import type { CloudConfig } from './config';
import { buildRequest } from './context-builder';
import type { CloudRequestSegments } from './context-builder';

/** 模型逻辑角色（CloudStreamResult.modelUsed 取此值；升级时 pro）。 */
export type CloudModelRole = 'flash' | 'pro';

/** 云侧流式结果（CONTRACTS §7）。 */
export interface CloudStreamResult {
  a2uiLines: string[]; // A2UI v0.9 JSONL（每行一个完整 surfaceUpdate 消息）
  usage: { promptTokens: number; completionTokens: number; cacheHit: boolean };
  modelUsed: string; // 'flash' | 'pro'（升级时）
}

export interface CloudUsage {
  promptTokens: number;
  completionTokens: number;
  cacheHit: boolean;
}

/** 文本增量回调（A2UI JSONL 逐块产出）。 */
export type TextDeltaCallback = (text: string) => void;

/** 工具调用增量回调（chat.completion.chunk 的 delta.tool_calls 元素透传）。 */
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface StreamCallbacks {
  onTextDelta?: TextDeltaCallback;
  onToolCallDelta?: (delta: ToolCallDelta) => void;
}

export interface StreamChatParams {
  segments: CloudRequestSegments;
  /** 实际模型名；默认按 modelRole 取配置常量。 */
  model?: string;
  modelRole?: CloudModelRole;
  timeoutMs?: number;
  maxRetries?: number;
  callbacks?: StreamCallbacks;
}

export interface CompleteTextParams {
  prompt: string;
  model?: string;
  modelRole?: CloudModelRole;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface CompleteTextResult {
  text: string;
  usage: CloudUsage;
}

export type CloudErrorCode = 'network' | 'timeout' | 'rate_limited' | 'content_filtered' | 'http' | 'invalid_response';

/** 错误分类（网络/限流/内容过滤…）+ 重试判定。 */
export class CloudClientError extends Error {
  readonly code: CloudErrorCode;
  readonly status?: number;
  /** 是否可重试（幂等才重试：rate_limited/5xx/未产出任何增量的网络与超时错误）。 */
  readonly retryable: boolean;
  /** 是否已向调用方产出过增量（true 则绝不重试）。 */
  readonly producedOutput: boolean;

  constructor(
    code: CloudErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; producedOutput?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'CloudClientError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.producedOutput = options.producedOutput ?? false;
  }
}

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

/** 最小客户端接口（CloudClient 与 MockCloudClient 共同实现；escalation 依赖此接口）。 */
export interface CloudLikeClient {
  streamChat(params: StreamChatParams): Promise<CloudStreamResult>;
  completeText(params: CompleteTextParams): Promise<CompleteTextResult>;
}

export interface CloudClientOptions {
  config: CloudConfig;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
}

function toUsage(raw: RawUsage | null | undefined): CloudUsage {
  return {
    promptTokens: raw?.prompt_tokens ?? 0,
    completionTokens: raw?.completion_tokens ?? 0,
    cacheHit: (raw?.prompt_cache_hit_tokens ?? 0) > 0,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CloudClient implements CloudLikeClient {
  private readonly config: CloudConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: CloudClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** 流式对话：八段 segments → 消息序列 → SSE 解析 → 文本/工具调用增量回调。 */
  async streamChat(params: StreamChatParams): Promise<CloudStreamResult> {
    const role = params.modelRole ?? 'flash';
    const model = params.model ?? (role === 'pro' ? this.config.modelPro : this.config.modelFlash);
    const built = buildRequest(params.segments);
    const body: Record<string, unknown> = {
      model,
      messages: built.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    const { text, usage } = await this.withRetries(params, () => this.doStreamRequest(body, params));
    return {
      a2uiLines: text.split('\n').filter((line) => line.trim().length > 0),
      usage,
      modelUsed: role,
    };
  }

  /** 非流式补全（升级请求等只需整段文本的场景）。 */
  async completeText(params: CompleteTextParams): Promise<CompleteTextResult> {
    const role = params.modelRole ?? 'flash';
    const model = params.model ?? (role === 'pro' ? this.config.modelPro : this.config.modelFlash);
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: params.prompt }],
    };
    return this.withRetries(params, async () => {
      const res = await this.fetchResponse(`${this.config.baseUrl}/chat/completions`, body, params.timeoutMs);
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: RawUsage;
      };
      const text = json.choices?.[0]?.message?.content ?? '';
      return { text, usage: toUsage(json.usage) };
    });
  }

  // ── 内部 ─────────────────────────────────────────────

  private async fetchResponse(url: string, body: Record<string, unknown>, timeoutMs?: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw this.errorFromStatus(res.status, errText);
      }
      return res;
    } catch (e) {
      throw this.normalizeError(e, false);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 单次流式请求：SSE 解析 chat.completion.chunk；一旦产出增量即标记 producedOutput。 */
  private async doStreamRequest(
    body: Record<string, unknown>,
    params: StreamChatParams,
  ): Promise<{ text: string; usage: CloudUsage }> {
    let produced = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw this.errorFromStatus(res.status, errText);
      }
      if (!res.body) {
        throw new CloudClientError('invalid_response', 'response has no body', { retryable: true });
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      let rawUsage: RawUsage | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice('data:'.length).trim();
          if (payload === '[DONE]' || payload === '') continue;
          // 无 `= null` 初始化：catch 分支 continue 直接跳行，唯一到达后续代码的
          // 路径是 try 正常完成（JSON.parse 成功且已赋值），判空收窄才成立。
          let chunk: {
            choices?: { delta?: { content?: string; tool_calls?: ToolCallDelta[] } }[];
            usage?: RawUsage | null;
          } | null;
          try {
            chunk = JSON.parse(payload) as {
              choices?: { delta?: { content?: string; tool_calls?: ToolCallDelta[] } }[];
              usage?: RawUsage | null;
            } | null;
          } catch {
            continue; // 单行解析失败跳过（残缺块不致命）
          }
          if (chunk === null) continue;
          if (chunk.usage !== null && chunk.usage !== undefined) rawUsage = chunk.usage;
          const delta = chunk.choices?.[0]?.delta;
          if (delta === undefined || delta === null) continue;
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            produced = true;
            full += delta.content;
            params.callbacks?.onTextDelta?.(delta.content);
          }
          if (Array.isArray(delta.tool_calls)) {
            produced = true;
            for (const tc of delta.tool_calls) params.callbacks?.onToolCallDelta?.(tc);
          }
        }
      }
      return { text: full, usage: toUsage(rawUsage) };
    } catch (e) {
      throw this.normalizeError(e, produced);
    } finally {
      clearTimeout(timer);
    }
  }

  /** HTTP 状态 + 响应体 → 分类错误（429 限流 / 内容过滤 / 其他）。 */
  private errorFromStatus(status: number, body: string): CloudClientError {
    if (status === 429) {
      return new CloudClientError('rate_limited', `rate limited (HTTP ${status})`, { status, retryable: true });
    }
    if (status >= 500) {
      return new CloudClientError('http', `server error (HTTP ${status})`, { status, retryable: true });
    }
    if (status === 400 && /content[_ ]?filter|敏感|审核/i.test(body)) {
      return new CloudClientError('content_filtered', 'content filtered', { status, retryable: false });
    }
    return new CloudClientError('http', `http error (HTTP ${status}): ${body.slice(0, 200)}`, { status, retryable: false });
  }

  /** 底层异常 → CloudClientError；Abort=超时、TypeError=网络；producedOutput 冻结重试判定。 */
  private normalizeError(e: unknown, producedOutput: boolean): CloudClientError {
    if (e instanceof CloudClientError) {
      return e.producedOutput || !e.retryable
        ? e
        : new CloudClientError(e.code, e.message, {
          status: e.status,
          retryable: true,
          producedOutput,
          cause: e,
        });
    }
    if (e instanceof Error && e.name === 'AbortError') {
      return new CloudClientError('timeout', 'request timed out', { retryable: !producedOutput, producedOutput, cause: e });
    }
    if (e instanceof TypeError) {
      return new CloudClientError('network', 'network error', { retryable: !producedOutput, producedOutput, cause: e });
    }
    const message = e instanceof Error ? e.message : String(e);
    return new CloudClientError('invalid_response', message, { retryable: false, producedOutput, cause: e });
  }

  /** 重试策略：仅未产出任何增量的可重试错误重试（幂等才重试），指数退避。 */
  private async withRetries<T>(
    params: { timeoutMs?: number; maxRetries?: number },
    fn: () => Promise<T>,
  ): Promise<T> {
    const maxRetries = params.maxRetries ?? DEFAULT_MAX_RETRIES;
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        const err = e instanceof CloudClientError
          ? e
          : this.normalizeError(e, false);
        if (!err.retryable || err.producedOutput || attempt >= maxRetries) throw err;
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        attempt += 1;
      }
    }
  }
}
