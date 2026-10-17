/**
 * 未配置云侧客户端（生产语义出口）：config.mock=true（无 Key）且调用方未显式 allowMock 时，
 * createCloudClient 返回本类而非 MockCloudClient——绝不静默走假数据（S1.8 / R-P3）。
 *
 * 行为契约：与 CloudLikeClient 同接口，每个方法都抛 CloudClientError('not_configured')，
 * retryable=false、producedOutput=false；消息面向用户给出"下一步做什么"，不暴露堆栈。
 */
import { CloudClientError } from './client';
import type {
  CloudLikeClient,
  CloudStreamResult,
  CompleteTextParams,
  CompleteTextResult,
  StreamChatParams,
} from './client';

/** 面向用户的未配置提示（下一步做什么；不含堆栈/内部细节）。 */
export const UNCONFIGURED_MESSAGE =
  '云侧未配置：请到「设置」页填入 DeepSeek API Key 后重试（或由宿主注入本地配置）。';

function notConfiguredError(): CloudClientError {
  return new CloudClientError('not_configured', UNCONFIGURED_MESSAGE, {
    retryable: false,
    producedOutput: false,
  });
}

/** 未配置占位客户端：任何调用都显式报错，绝不返回假数据。 */
export class UnconfiguredCloudClient implements CloudLikeClient {
  async streamChat(_params: StreamChatParams): Promise<CloudStreamResult> {
    throw notConfiguredError();
  }

  async completeText(_params: CompleteTextParams): Promise<CompleteTextResult> {
    throw notConfiguredError();
  }
}
