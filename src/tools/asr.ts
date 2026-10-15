/**
 * ASR 工具（M6，PRD §7.3 / ARCHITECTURE §1 tools/asr.ts）：
 * sherpa-onnx 流式 zipformer 端侧识别，**仅服务档4 费曼复述**（isAsrEnabledForSkill 门控），
 * 保留文字兜底——ASR 质量不得阻塞 V1（PRD §7.3），识别不可用时调用方直接给文字输入入口。
 *
 * 中间结果：LynxModule Callback 单发限制 → 原生侧仅提供 startAsr/stopAsr/asrPoll，
 * 本层以 250ms 轮询桥接出 onPartial/onFinal 回调（语音数据不出端，§7.3 隐私一致性）。
 * 模型按需下载到 app 私有目录（同 tts.ts 口径，失败兜底返回错误）。
 */
import { detectSpeechBridge, getSpeechBridge, setSpeechBridge as setSharedBridge, type SpeechNativeBridge } from './tts';

export type { SpeechNativeBridge };
export { setSharedBridge as setSpeechBridge, detectSpeechBridge };

/** 流式识别回调（onFinal 每个定稿分句触发一次；onError 触发后识别终止）。 */
export interface AsrHandlers {
  onPartial?: (partial: string) => void;
  onFinal?: (text: string, fullSoFar: string) => void;
  onError?: (error: string) => void;
}

const POLL_INTERVAL_MS = 250;

/** ASR 启用档位（PRD §7.3：ASR 仅档4 费曼"讲给别人听"）：Session 层据此开关录音入口（M4 页面不改）。 */
const ASR_ENABLED_SKILLS: ReadonlySet<string> = new Set(['deep-learning']);

export function isAsrEnabledForSkill(skill: string): boolean {
  return ASR_ENABLED_SKILLS.has(skill);
}

/** 模型是否已就绪（无桥 → false → UI 直接走文字兜底）。 */
export async function isAsrReady(): Promise<boolean> {
  const bridge = getSpeechBridge();
  if (bridge === null) return false;
  return new Promise((resolve) => bridge.isAsrReady((ready) => resolve(ready === true)));
}

/** 按需下载 ASR 模型（幂等；失败返回错误原因）。 */
export function downloadAsrModel(): Promise<{ ok: boolean; error?: string }> {
  const bridge = getSpeechBridge();
  if (bridge === null) return Promise.resolve({ ok: false, error: 'speech_unavailable' });
  return new Promise((resolve) => bridge.ensureAsrModel((ok, err) => resolve(ok ? { ok: true } : { ok: false, error: err ?? 'speech_error' })));
}

export interface AsrSession {
  /** 停止录音并结束轮询；返回累计全文（finals 拼接 + 尾部 partial）。 */
  stop(): Promise<string>;
}

/** 启动流式听写（档4 费曼入口；模型未就绪先触发下载，失败即 onError/返回错误 → 文字兜底）。 */
export async function startListening(handlers: AsrHandlers): Promise<AsrSession | { ok: false; error: string }> {
  const bridge = getSpeechBridge();
  if (bridge === null) return { ok: false, error: 'speech_unavailable' };
  const ensured = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
    bridge.ensureAsrModel((ok, err) => resolve(ok ? { ok: true } : { ok: false, error: err ?? 'speech_error' })));
  if (!ensured.ok) return { ok: false, error: ensured.error ?? 'model_not_ready' };
  const started = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
    bridge.startAsr((ok, err) => resolve(ok ? { ok: true } : { ok: false, error: err ?? 'speech_error' })));
  if (!started.ok) return { ok: false, error: started.error ?? 'start_failed' };

  const finals: string[] = [];
  let lastPartial = '';
  let stopped = false;
  let stopResolve: ((text: string) => void) | null = null;
  const stopPromise = new Promise<string>((resolve) => { stopResolve = resolve; });

  const timer = setInterval(() => {
    bridge.asrPoll((partial, newFinals) => {
      if (newFinals.length > 0) {
        finals.push(...newFinals);
        for (const f of newFinals) handlers.onFinal?.(f, [...finals].join(''));
      }
      if (partial !== lastPartial) {
        lastPartial = partial;
        handlers.onPartial?.(partial);
      }
    });
  }, POLL_INTERVAL_MS);

  return {
    async stop(): Promise<string> {
      if (stopped) return stopPromise;
      stopped = true;
      clearInterval(timer);
      // 收尾：先 poll 一次拿残余，再停录音
      await new Promise<void>((resolve) => {
        bridge.asrPoll((partial, newFinals) => {
          if (newFinals.length > 0) {
            finals.push(...newFinals);
            for (const f of newFinals) handlers.onFinal?.(f, [...finals].join(''));
          }
          lastPartial = partial;
          resolve();
        });
      });
      bridge.stopAsr();
      stopResolve?.(finals.length > 0 ? finals.join('') : lastPartial);
      return stopPromise;
    },
  };
}
