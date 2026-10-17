/**
 * 识图工具（M6，PRD §7.3 / ARCHITECTURE §1 tools/vision.ts）：
 * 拍照/选图 → base64 → 云侧多模态（deepseek-flash 图像输入，D2 实测 /models input_modalities 含 image）
 * → 结构化识别结论。
 *
 * sub-agent 隔离（PRD §7.7⑤）：识图占独立云侧窗口——独立 system 提示词，
 * 不掺主会话上下文（不发 ①~⑧ 段），只回传识别/多模态结论，原图留在子窗口不入端侧存储。
 *
 * 图像传递形态：data URL（data:image/jpeg;base64,…），OpenAI 兼容 chat/completions
 * 多模态 content 数组（type:'image_url'）。端侧不落盘原图（§5.5 同口径：成绩单链路不存原图）。
 */
import type { CloudConfig } from '../cloud/config';
import { CloudClientError, DEFAULT_TIMEOUT_MS } from '../cloud/client';

/** 识图请求：imageDataUrl 为 data URL（含 base64），hint 为可选拍摄意图提示（"这道题怎么解"等）；
 *  system 覆盖默认 sub-agent 独立窗口提示词（grade-entry 等专用链路注入自己的隔离提示词）。 */
export interface VisionRequest {
  imageDataUrl: string;
  hint?: string;
  system?: string;
}

/** 识图结果：ok=false 时 error 说明原因（网络/配置/模型拒绝），调用方据此兜底。 */
export interface VisionResult {
  ok: boolean;
  /** 多模态识别结论文本（提炼后；调用方按 ⑧ 段 digest 口径截断入窗）。 */
  text?: string;
  error?: string;
}

/** 识图云侧端口（测试注入 fake；生产 createDeepSeekVisionClient）。system=独立窗口提示词。 */
export interface VisionCloudPort {
  completeVision(params: { system: string; prompt: string; imageDataUrl: string }): Promise<string>;
}

/** 识图 sub-agent 独立 system 提示词（§7.7⑤：只回传结论，不输出无关客套）。 */
export const VISION_SUBAGENT_SYSTEM = [
  '你是学习助手的识图子代理，工作在独立窗口：只看这张图和一句拍摄意图，没有其他上下文。',
  '任务：读图并给出结构化识别结论（题目原文、书页要点、板书条目等），不改写学习目标、不引用不存在的内容。',
  '只输出识别结论本身，不要寒暄、不要解释你看到了什么格式。',
].join('\n');

/** data URL 基本校验（must be data:image/*;base64,）。 */
export function isImageDataUrl(dataUrl: string): boolean {
  return typeof dataUrl === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl);
}

/** DeepSeek 多模态识图客户端：OpenAI 兼容 POST {base}/chat/completions，非流式。 */
export function createDeepSeekVisionClient(
  config: CloudConfig,
  fetchImpl: typeof fetch = fetch,
): VisionCloudPort {
  const completeVision = async ({ system, prompt, imageDataUrl }: { system: string; prompt: string; imageDataUrl: string }): Promise<string> => {
    if (config.mock || config.apiKey === '') {
      // 去 Mock（S1.8 / R-P3）：缺 Key 时显式报「未配置」，绝不静默返回假识别结果。
      throw new CloudClientError(
        'not_configured',
        '云侧未配置：识图需要 API Key，请到「设置」页填入 DeepSeek API Key 后重试。',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.modelFlash, // deepseek-flash 图像输入（D2 实测）
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new CloudClientError(res.status === 429 ? 'rate_limited' : 'http', `识图请求失败 (HTTP ${res.status})`, { status: res.status });
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content ?? '';
      if (text.length === 0) throw new CloudClientError('invalid_response', '识图响应为空');
      return text;
    } catch (e) {
      if (e instanceof CloudClientError) throw e;
      if (e instanceof Error && e.name === 'AbortError') {
        throw new CloudClientError('timeout', '识图请求超时', { cause: e });
      }
      throw new CloudClientError('network', '识图网络错误', { cause: e });
    } finally {
      clearTimeout(timer);
    }
  };
  return { completeVision };
}

/** 识图主入口：拍题/拍书页 → 多模态结论（sub-agent 独立窗口）。 */
export async function recognizeImage(req: VisionRequest, port: VisionCloudPort): Promise<VisionResult> {
  if (!isImageDataUrl(req.imageDataUrl)) {
    return { ok: false, error: 'invalid_image：imageDataUrl 必须是 data:image/*;base64 形态' };
  }
  const prompt = req.hint && req.hint.length > 0
    ? `拍摄意图：${req.hint}\n请识别图中与该意图相关的内容并给出结论。`
    : '请识别图中内容（题目/书页/板书），给出结构化结论。';
  try {
    const text = await port.completeVision({
      system: req.system ?? VISION_SUBAGENT_SYSTEM,
      prompt,
      imageDataUrl: req.imageDataUrl,
    });
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
