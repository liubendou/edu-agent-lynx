/**
 * TTS 工具（M6，PRD §7.3 / ARCHITECTURE §1 tools/tts.ts）：
 * sherpa-onnx + Kokoro 端侧离线合成（中文优先，Apache-2.0），语速接画像偏好（§5.1 C 层 tts.rate）。
 *
 * 实现分层：本文件只做 JS 接口层（speak/stop/模型管理），真实合成走 NativeModule 桥
 * （android/ SpeechModule，仿 StorageModule 先例：LynxModule + @LynxMethod，见 ARCHITECTURE §2 SpeechModule.kt）。
 * 模型文件不入 APK（PRD §7.3 体积约束）：首次使用时由原生侧下载到 app 私有目录，失败兜底返回错误。
 *
 * 环境降级：探测不到原生桥（web 预览/jsdom 测试/未捆绑宿主）→ 返回 { ok:false, error:'speech_unavailable' }
 * 绝不抛错——TTS 失败不阻塞教学主流程（四档口播可降级为纯文字）。
 */

/** 语音原生桥形状（android/ SpeechModule 的 JS 视角签名；docs/03 §4 回调风格同 StorageModule）。 */
export interface SpeechNativeBridge {
  /** 确保模型就绪（首次触发下载，重复调用幂等）；ok=false 时 err 说明原因。 */
  ensureTtsModel(callback: (ok: boolean, err?: string) => void): void;
  isTtsReady(callback: (ready: boolean) => void): void;
  /** 合成并播放（端侧离线）；ok=false 时 err 说明原因。 */
  speak(text: string, rate: number, callback: (ok: boolean, err?: string) => void): void;
  stopTts(): void;
  ensureAsrModel(callback: (ok: boolean, err?: string) => void): void;
  isAsrReady(callback: (ready: boolean) => void): void;
  /** 启动流式识别（录音开始）；结果经 asrPoll 轮询回收（LynxModule Callback 单发限制 → 轮询模式）。 */
  startAsr(callback: (ok: boolean, err?: string) => void): void;
  stopAsr(): void;
  /** 轮询识别进度：partial=当前未定稿文本，finals=自上次 poll 以来的定稿分句。 */
  asrPoll(callback: (partial: string, finals: string[]) => void): void;
}

const SPEECH_MODULE_NAME = 'SpeechModule';

/** 探测 Lynx 原生 SpeechModule（后台线程全局 NativeModules；形状不符 → null，同 storage/kv.ts 先例）。 */
export function detectSpeechBridge(): SpeechNativeBridge | null {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const nativeModules = g['NativeModules'] as Record<string, unknown> | undefined;
    const mod = nativeModules?.[SPEECH_MODULE_NAME] as Partial<SpeechNativeBridge> | undefined;
    if (
      mod
      && typeof mod.ensureTtsModel === 'function'
      && typeof mod.isTtsReady === 'function'
      && typeof mod.speak === 'function'
      && typeof mod.stopTts === 'function'
      && typeof mod.ensureAsrModel === 'function'
      && typeof mod.isAsrReady === 'function'
      && typeof mod.startAsr === 'function'
      && typeof mod.stopAsr === 'function'
      && typeof mod.asrPoll === 'function'
    ) {
      return mod as SpeechNativeBridge;
    }
  } catch {
    // 探测异常按无桥处理
  }
  return null;
}

let bridge: SpeechNativeBridge | null = detectSpeechBridge();

/** 注入语音桥（测试 mock 用）；传 undefined 恢复自动探测。 */
export function setSpeechBridge(next: SpeechNativeBridge | null | undefined): void {
  bridge = next === undefined ? detectSpeechBridge() : next;
}

/** 当前生效的语音桥（注入优先，其次自动探测结果；asr.ts 同层共用，保证注入口径一致）。 */
export function getSpeechBridge(): SpeechNativeBridge | null {
  return bridge;
}

function cbToPromise(fn: (cb: (ok: boolean, err?: string) => void) => void): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    fn((ok, err) => resolve(ok ? { ok: true } : { ok: false, error: err ?? 'speech_error' }));
  });
}

/** 最近一次成功合成的文本（TTSBar 重播/继续播放的数据源；会话级内存态，不落盘）。 */
let lastSpokenText = '';

/**
 * 合成并播放（端侧离线）。语速默认 1.0（接画像 §5.1 C 层 tts.rate，由调用方传入）。
 * 模型未就绪时自动先 ensureTtsModel（首次会触发下载，可能耗时/失败）。
 */
export async function speak(text: string, opts: { rate?: number } = {}): Promise<{ ok: boolean; error?: string }> {
  if (bridge === null || text.trim().length === 0) {
    return { ok: false, error: bridge === null ? 'speech_unavailable' : 'empty_text' };
  }
  const ensured = await ensureTtsModel();
  if (!ensured.ok) return ensured;
  const result = await cbToPromise((cb) => bridge!.speak(text, opts.rate ?? 1, cb));
  if (result.ok) lastSpokenText = text;
  return result;
}

/** 停止播放（fire-and-forget，无桥静默 no-op）。 */
export function stopSpeak(): void {
  bridge?.stopTts();
}

/** 模型是否已就绪（无桥 → false）。 */
export async function isTtsReady(): Promise<boolean> {
  if (bridge === null) return false;
  return new Promise((resolve) => bridge!.isTtsReady((ready) => resolve(ready === true)));
}

/** 按需下载模型（PRD §7.3：不打进 APK，首次使用下载；失败返回错误，不阻塞 UI）。 */
export function downloadTtsModel(): Promise<{ ok: boolean; error?: string }> {
  if (bridge === null) return Promise.resolve({ ok: false, error: 'speech_unavailable' });
  return cbToPromise((cb) => bridge!.ensureTtsModel(cb));
}

/** ensureTtsModel 别名语义（幂等：已就绪直接返回）。 */
function ensureTtsModel(): Promise<{ ok: boolean; error?: string }> {
  return downloadTtsModel();
}

/** 最近一次成功合成的文本（TTSBar 播/重播用；空串表示无可播内容）。 */
export function getLastSpokenText(): string {
  return lastSpokenText;
}
