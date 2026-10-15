/**
 * 云侧接入层汇出（M2c）+ 客户端工厂。
 */
export {
  MODEL_FLASH,
  MODEL_PRO,
  DEFAULT_BASE_URL,
  CLOUD_LOCAL_FILENAME,
  CLOUD_GLOBAL_INJECTION_KEY,
  parseCloudLocalFile,
  resolveCloudConfig,
  readCloudLocalFileRaw,
  loadCloudConfig,
} from './config';
export type { CloudLocalFile, CloudConfig, LoadCloudConfigOptions } from './config';

export {
  buildStablePrefix,
  buildRequest,
  formatLocator,
  formatRetrievedChunk,
  serializeTaskInstruction,
  MAX_RETRIEVED_DIGEST_CHARS,
} from './context-builder';
export type {
  TaskInstruction,
  ChatTurn,
  RetrievedChunk,
  CloudRequestSegments,
  CloudMessage,
  BuiltRequest,
  StableSegments,
} from './context-builder';

export {
  CloudClient,
  CloudClientError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
} from './client';
export type {
  CloudModelRole,
  CloudStreamResult,
  CloudUsage,
  ToolCallDelta,
  StreamCallbacks,
  StreamChatParams,
  CompleteTextParams,
  CompleteTextResult,
  CloudErrorCode,
  CloudLikeClient,
  CloudClientOptions,
} from './client';

export {
  compressSegments,
  turnImportance,
  DEFAULT_COMPRESS_OPTIONS,
} from './compressor';
export type { CompressOptions, CompressionReport } from './compressor';

export {
  StuckDetector,
  EscalationManager,
  buildEscalationPrompt,
  escalationKey,
  RETRY_NO_CONVERGE_THRESHOLD,
  TOOL_FAILURE_THRESHOLD,
  FALLBACK_NEXT_STEP,
} from './escalation';
export type {
  EscalationRequest,
  StuckObservation,
  EscalationOutcome,
  EscalationDeps,
} from './escalation';

export {
  BudgetGuard,
  DEFAULT_DAILY_TOKEN_LIMIT,
  DEFAULT_ESCALATION_LIMIT,
} from './budget';
export type { IdleTask, IdleTaskInput, BudgetGuardDeps } from './budget';

export {
  MOCK_COMPONENT_NAMES,
  buildMockA2UILines,
  MOCK_ESCALATION_NEXT_STEP,
  MockCloudClient,
} from './mock';
export type {
  MockComponentName,
  MockComponentNode,
  MockA2UIMessage,
  MockStreamInput,
  MockCloudClientOptions,
  MockCallRecord,
} from './mock';

import { loadCloudConfig } from './config';
import type { CloudConfig, LoadCloudConfigOptions } from './config';
import { CloudClient } from './client';
import type { CloudLikeClient } from './client';
import { MockCloudClient } from './mock';
import type { MockCloudClientOptions } from './mock';

export interface CreateCloudClientOptions {
  /** 已有配置则跳过加载。 */
  config?: CloudConfig;
  /** 透传 loadCloudConfig（测试注入 read 等）。 */
  loadConfigOptions?: LoadCloudConfigOptions;
  /** Mock 模式参数（延迟/升级应答注入）。 */
  mockOptions?: MockCloudClientOptions;
}

/**
 * 客户端工厂（D7）：文件缺失或 key 为空 → 自动 Mock 模式（无 Key 全链路可开发可测）；
 * 有 Key → CloudClient（DeepSeek OpenAI 兼容，原生 fetch）。
 */
export async function createCloudClient(
  options: CreateCloudClientOptions = {},
): Promise<{ client: CloudLikeClient; config: CloudConfig }> {
  const config = options.config ?? await loadCloudConfig(options.loadConfigOptions);
  const client: CloudLikeClient = config.mock
    ? new MockCloudClient(options.mockOptions)
    : new CloudClient({ config });
  return { client, config };
}
