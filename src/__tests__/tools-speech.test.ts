// M6 端侧语音单测（T3/T7）：mock SpeechNativeBridge（形状对齐 SpeechModule.kt）。
// 覆盖：TTS speak/stop/重播数据源、模型下载幂等、无桥降级不抛；ASR 流式轮询出
// partial/final、stop 收尾、模型失败兜底文字入口、档4 门控（isAsrEnabledForSkill）。
import { afterEach, describe, expect, test } from '@rstest/core';
import {
  downloadTtsModel,
  getLastSpokenText,
  isTtsReady,
  setSpeechBridge,
  speak,
  stopSpeak,
  type SpeechNativeBridge,
} from '../tools/tts';
import {
  downloadAsrModel,
  isAsrEnabledForSkill,
  isAsrReady,
  setSpeechBridge as setAsrBridge,
  startListening,
} from '../tools/asr';

/** 语音桥 mock（同步回调；asrPoll 吐出排队的 partial/finals）。 */
function makeMockBridge(opts: { ttsReadyOk?: boolean; asrReadyOk?: boolean; ensureFail?: string; startFail?: string; speakFail?: string } = {}) {
  const calls: string[] = [];
  const pendingFinals: string[] = [];
  let partial = '';
  const bridge: SpeechNativeBridge = {
    ensureTtsModel: (cb) => { calls.push('ensureTtsModel'); if (opts.ensureFail !== undefined) cb(false, opts.ensureFail); else cb(true); },
    isTtsReady: (cb) => cb(opts.ttsReadyOk === true),
    speak: (text, rate, cb) => { calls.push(`speak:${text}:${rate}`); if (opts.speakFail !== undefined) cb(false, opts.speakFail); else cb(true); },
    stopTts: () => { calls.push('stopTts'); },
    ensureAsrModel: (cb) => { calls.push('ensureAsrModel'); if (opts.ensureFail !== undefined) cb(false, opts.ensureFail); else cb(true); },
    isAsrReady: (cb) => cb(opts.asrReadyOk === true),
    startAsr: (cb) => { calls.push('startAsr'); if (opts.startFail !== undefined) cb(false, opts.startFail); else cb(true); },
    stopAsr: () => { calls.push('stopAsr'); },
    asrPoll: (cb) => cb(partial, pendingFinals.splice(0)),
  };
  return { bridge, calls, pendingFinals, setPartial: (p: string) => { partial = p; } };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('M6 TTS（tts.ts）', () => {
  afterEach(() => {
    setSpeechBridge(undefined); // 恢复自动探测（jsdom 无桥）
  });

  test('无桥 → speak/isTtsReady/downloadTtsModel 均降级不抛', async () => {
    setSpeechBridge(null);
    expect(await speak('你好')).toEqual({ ok: false, error: 'speech_unavailable' });
    expect(await isTtsReady()).toBe(false);
    expect(await downloadTtsModel()).toEqual({ ok: false, error: 'speech_unavailable' });
    expect(() => stopSpeak()).not.toThrow(); // fire-and-forget no-op
  });

  test('空文本 → empty_text（不发原生调用）', async () => {
    setSpeechBridge(makeMockBridge().bridge);
    expect(await speak('   ')).toEqual({ ok: false, error: 'empty_text' });
  });

  test('speak 成功链路：ensureTtsModel → speak(rate) → lastSpokenText 记录（重播数据源）', async () => {
    const mock = makeMockBridge();
    setSpeechBridge(mock.bridge);
    const result = await speak('梯度下降是优化算法', { rate: 1.2 });
    expect(result).toEqual({ ok: true });
    expect(mock.calls).toEqual(['ensureTtsModel', 'speak:梯度下降是优化算法:1.2']);
    expect(getLastSpokenText()).toBe('梯度下降是优化算法');
    stopSpeak();
    expect(mock.calls).toContain('stopTts');
  });

  test('speak 失败 → 不更新 lastSpokenText（重播不落旧数据）', async () => {
    const before = getLastSpokenText(); // 单例跨用例：失败前后必须不变
    setSpeechBridge(makeMockBridge({ speakFail: 'audio_track_error' }).bridge);
    expect(await speak('内容')).toEqual({ ok: false, error: 'audio_track_error' });
    expect(getLastSpokenText()).toBe(before);
  });

  test('ensureTtsModel 失败（模型下载错误）→ speak 返回错误不抛', async () => {
    setSpeechBridge(makeMockBridge({ ensureFail: 'model_download_failed' }).bridge);
    expect(await speak('内容')).toEqual({ ok: false, error: 'model_download_failed' });
  });

  test('isTtsReady / downloadTtsModel 直连桥回调', async () => {
    expect(await isTtsReady()).toBe(false); // ttsReadyOk 未置 true
    const mock = makeMockBridge({ ttsReadyOk: true });
    setSpeechBridge(mock.bridge);
    expect(await isTtsReady()).toBe(true);
    expect(await downloadTtsModel()).toEqual({ ok: true });
  });
});

describe('M6 ASR（asr.ts，仅档4 费曼）', () => {
  afterEach(() => {
    setSpeechBridge(undefined);
    setAsrBridge(undefined);
  });

  test('档位门控：ASR 仅 deep-learning（档4）启用，其余档位关闭', () => {
    expect(isAsrEnabledForSkill('deep-learning')).toBe(true);
    expect(isAsrEnabledForSkill('standard-learning')).toBe(false);
    expect(isAsrEnabledForSkill('review')).toBe(false);
    expect(isAsrEnabledForSkill('quick-learning')).toBe(false);
  });

  test('无桥 → startListening/downloadAsrModel/isAsrReady 降级（文字兜底入口）', async () => {
    setAsrBridge(null);
    const session = await startListening({});
    expect(session).toEqual({ ok: false, error: 'speech_unavailable' });
    expect(await isAsrReady()).toBe(false);
    expect(await downloadAsrModel()).toEqual({ ok: false, error: 'speech_unavailable' });
  });

  test('流式听写：轮询吐 partial/final，stop 收尾返回全文（语音数据不出端）', async () => {
    const mock = makeMockBridge();
    setAsrBridge(mock.bridge);
    const partials: string[] = [];
    const finals: { text: string; fullSoFar: string }[] = [];
    const session = await startListening({
      onPartial: (p) => partials.push(p),
      onFinal: (text, fullSoFar) => finals.push({ text, fullSoFar }),
    });
    if (!('stop' in session)) throw new Error(`startListening 失败：${JSON.stringify(session)}`);
    expect(mock.calls).toEqual(['ensureAsrModel', 'startAsr']); // 模型就绪检查先行

    mock.pendingFinals.push('今天我来讲');
    mock.setPartial('今天我来讲梯度');
    await wait(400); // 覆盖 250ms 轮询窗口
    expect(finals).toEqual([{ text: '今天我来讲', fullSoFar: '今天我来讲' }]);
    expect(partials).toContain('今天我来讲梯度');

    mock.pendingFinals.push('下降');
    const text = await session.stop();
    expect(text).toBe('今天我来讲下降'); // finals 拼接
    expect(mock.calls).toContain('stopAsr');
    expect(finals[1]).toEqual({ text: '下降', fullSoFar: '今天我来讲下降' }); // 收尾 poll 残余定稿也回调
  }, 10_000);

  test('stop 后无定稿 → 返回尾部 partial（听了个开头）', async () => {
    const mock = makeMockBridge();
    setAsrBridge(mock.bridge);
    const session = await startListening({});
    if (!('stop' in session)) throw new Error('startListening 失败');
    mock.setPartial('梯度');
    const text = await session.stop();
    expect(text).toBe('梯度');
  }, 10_000);

  test('模型下载失败 → {ok:false, error}（UI 走文字兜底，不抛）', async () => {
    setAsrBridge(makeMockBridge({ ensureFail: 'asr_model_download_failed' }).bridge);
    expect(await startListening({})).toEqual({ ok: false, error: 'asr_model_download_failed' });
  });

  test('startAsr 失败（录音占用等）→ {ok:false, error}', async () => {
    setAsrBridge(makeMockBridge({ startFail: 'recorder_busy' }).bridge);
    expect(await startListening({})).toEqual({ ok: false, error: 'recorder_busy' });
  });

  test('重复 stop 幂等（返回同一全文）', async () => {
    const mock = makeMockBridge();
    setAsrBridge(mock.bridge);
    const session = await startListening({});
    if (!('stop' in session)) throw new Error('startListening 失败');
    mock.pendingFinals.push('一句');
    await wait(300);
    const first = await session.stop();
    const second = await session.stop();
    expect(second).toBe(first);
    expect(mock.calls.filter((c) => c === 'stopAsr')).toHaveLength(1);
  }, 10_000);
});
