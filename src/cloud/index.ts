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

export { UnconfiguredCloudClient, UNCONFIGURED_MESSAGE } from './unconfigured';

import { loadCloudConfig } from './config';
import type { CloudConfig, LoadCloudConfigOptions } from './config';
import { CloudClient } from './client';
import type { CloudLikeClient } from './client';
import { MockCloudClient } from './mock';
import type { MockCloudClientOptions } from './mock';
import { UnconfiguredCloudClient } from './unconfigured';

export interface CreateCloudClientOptions {
  /** 已有配置则跳过加载。 */
  config?: CloudConfig;
  /** 透传 loadCloudConfig（测试注入 read 等）。 */
  loadConfigOptions?: LoadCloudConfigOptions;
  /** Mock 模式参数（延迟/升级应答注入）。 */
  mockOptions?: MockCloudClientOptions;
  /**
   * 显式允许 Mock（测试 fixture 用）；默认 false（生产语义）。
   * config.mock=true 时：true → MockCloudClient；false → UnconfiguredCloudClient（每次调用显式报错）。
   */
  allowMock?: boolean;
}

/**
 * 客户端工厂（D7 / S1.8）：
 *  - 有 Key → CloudClient（DeepSeek OpenAI 兼容，原生 fetch）；
 *  - 无 Key（config.mock=true）且未显式 allowMock → UnconfiguredCloudClient（显式报错，绝不静默 Mock）；
 *  - 无 Key 且 allowMock=true → MockCloudClient（测试用假数据）。
 */
export async function createCloudClient(
  options: CreateCloudClientOptions = {},
): Promise<{ client: CloudLikeClient; config: CloudConfig }> {
  const config = options.config ?? await loadCloudConfig(options.loadConfigOptions);
  const client: CloudLikeClient = !config.mock
    ? new CloudClient({ config })
    : options.allowMock === true
      ? new MockCloudClient(options.mockOptions)
      : new UnconfiguredCloudClient();
  return { client, config };
}
