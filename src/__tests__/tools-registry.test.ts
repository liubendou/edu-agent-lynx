// M6 工具注册表单测（T1/T7）：白名单/offline 标注、日限额、未知工具抛错、
// 业务失败返回 {ok:false} 不抛（降级语义）、tool_call/tool_result 事件流水、KV 限额存储。
import { afterEach, describe, expect, test } from '@rstest/core';
import {
  TOOL_DAILY_LIMITS,
  TOOL_WHITELIST,
  createKvToolUsageStore,
  createToolInvoker,
  type ToolEvent,
} from '../tools/registry';
import type { VisionCloudPort } from '../tools/vision';
import { setSpeechBridge, type SpeechNativeBridge } from '../tools/tts';
import { createMemoryKVStore, type KVStore } from '../storage/kv';

const DATA_URL = 'data:image/jpeg;base64,QUJD';

function fakeVisionPort(impl?: VisionCloudPort['completeVision']): VisionCloudPort {
  return { completeVision: impl ?? (async () => '识别结论') };
}

/** 语音桥 mock（形状对齐 SpeechNativeBridge；同步回调便于断言）。 */
function makeMockBridge() {
  const calls: string[] = [];
  const pendingFinals: string[] = [];
  let partial = '';
  const bridge: SpeechNativeBridge = {
    ensureTtsModel: (cb) => { calls.push('ensureTtsModel'); cb(true); },
    isTtsReady: (cb) => cb(true),
    speak: (text, rate, cb) => { calls.push(`speak:${text}:${rate}`); cb(true); },
    stopTts: () => { calls.push('stopTts'); },
    ensureAsrModel: (cb) => { calls.push('ensureAsrModel'); cb(true); },
    isAsrReady: (cb) => cb(true),
    startAsr: (cb) => { calls.push('startAsr'); cb(true); },
    stopAsr: () => { calls.push('stopAsr'); },
    asrPoll: (cb) => cb(partial, pendingFinals.splice(0)),
  };
  return { bridge, calls, pendingFinals, setPartial: (p: string) => { partial = p; } };
}

/** 可编程限额存储（计数捕获，断言计次口径）。 */
function fakeUsage(initial = 0) {
  const increments: string[] = [];
  return {
    increments,
    store: {
      countFor: async () => initial,
      increment: async (_date: string, name: string) => { increments.push(name); },
    },
  };
}

describe('M6 工具注册表：白名单 + offline 标注', () => {
  test('白名单四工具 = CONTRACTS §6 ToolName 联合；offline 仅端侧语音（§7.3 数据不出端）', () => {
    expect(TOOL_WHITELIST.map((d) => d.name)).toEqual(['web_search', 'vision_capture', 'tts_speak', 'asr_transcribe']);
    const offline = Object.fromEntries(TOOL_WHITELIST.map((d) => [d.name, d.offline]));
    expect(offline).toEqual({ web_search: false, vision_capture: false, tts_speak: true, asr_transcribe: true });
    expect(TOOL_DAILY_LIMITS).toEqual({ web_search: 20, vision_capture: 20, tts_speak: 200, asr_transcribe: 100 });
  });

  test('descriptors 暴露白名单只读视图', () => {
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: null });
    expect(invoker.descriptors).toBe(TOOL_WHITELIST);
  });
});

describe('M6 工具注册表：门控语义', () => {
  test('未知工具抛错（tool_not_allowed）', async () => {
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: null });
    await expect(invoker.callTool('rm_rf', {})).rejects.toThrow('tool_not_allowed');
  });

  test('超日限额抛错（quota_exceeded）且不计次', async () => {
    const { store, increments } = fakeUsage(TOOL_DAILY_LIMITS.vision_capture);
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: null, usage: store });
    await expect(invoker.callTool('vision_capture', { imageDataUrl: DATA_URL })).rejects.toThrow('quota_exceeded');
    expect(increments).toEqual([]);
  });

  test('web_search 未配置返回 {ok:false} 明确 not_configured（不抛）——M7 T3b 可配置后端语义', async () => {
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: null });
    const result = await invoker.callTool('web_search', { query: 'x' }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not_configured');
  });
});

describe('M6 工具注册表：vision_capture', () => {
  test('成功：透传识图端口结论 + tool_call/tool_result(ok:true) 事件', async () => {
    const events: ToolEvent[] = [];
    const seen: { system?: string; prompt?: string; imageDataUrl?: string } = {};
    const port: VisionCloudPort = {
      completeVision: async (p) => {
        Object.assign(seen, p);
        return '图里是一道一元一次方程题';
      },
    };
    const invoker = createToolInvoker({ vision: port, speechBridge: null, onEvent: (e) => events.push(e) });
    const result = await invoker.callTool('vision_capture', { imageDataUrl: DATA_URL, hint: '这道题怎么解' }) as { ok: boolean; text?: string };
    expect(result.ok).toBe(true);
    expect(result.text).toContain('一元一次方程');
    expect(seen.system).toContain('识图子代理');
    expect(seen.imageDataUrl).toBe(DATA_URL);
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result']);
    expect(events[1]!.ok).toBe(true);
    expect(typeof events[1]!.durationMs).toBe('number');
  });

  test('invalid_args：imageDataUrl 缺失 → {ok:false} 不抛，事件 ok:false', async () => {
    const events: ToolEvent[] = [];
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: null, onEvent: (e) => events.push(e) });
    const result = await invoker.callTool('vision_capture', {}) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid_args');
    expect(events[1]!.ok).toBe(false);
  });

  test('识图端口抛错（Mock 无 Key）→ {ok:false} 降级不抛', async () => {
    const port: VisionCloudPort = { completeVision: async () => { throw new Error('Mock 模式无云侧识图能力'); } };
    const invoker = createToolInvoker({ vision: port, speechBridge: null });
    const result = await invoker.callTool('vision_capture', { imageDataUrl: DATA_URL }) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Mock');
  });
});

describe('M6 工具注册表：tts_speak / asr_transcribe（mock 原生桥）', () => {
  afterEach(() => {
    setSpeechBridge(undefined); // 恢复自动探测（jsdom 无桥 → null）
  });

  test('无语音桥 → {ok:false, speech_unavailable} 不抛，且计次', async () => {
    const { store, increments } = fakeUsage();
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: null, usage: store });
    const result = await invoker.callTool('tts_speak', { text: '你好' }) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('speech_unavailable');
    expect(increments).toEqual(['tts_speak']);
  });

  test('有桥：speak 走 ensureTtsModel→speak 链路，语速透传', async () => {
    const mock = makeMockBridge();
    setSpeechBridge(mock.bridge);
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: mock.bridge });
    const result = await invoker.callTool('tts_speak', { text: '你好世界', rate: 1.25 }) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mock.calls).toEqual(['ensureTtsModel', 'speak:你好世界:1.25']);
  });

  test('asr_transcribe：一次听写（首条定稿即收）→ {ok:true, text}', async () => {
    const mock = makeMockBridge();
    setSpeechBridge(mock.bridge);
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: mock.bridge });
    mock.pendingFinals.push('费曼复述：梯度下降');
    const result = await invoker.callTool('asr_transcribe', {}) as { ok: boolean; text?: string };
    expect(result.ok).toBe(true);
    expect(result.text).toBe('费曼复述：梯度下降');
    expect(mock.calls).toContain('stopAsr');
  }, 10_000);

  test('asr_transcribe 无定稿 → {ok:false, asr_empty}（文字兜底信号）', async () => {
    const mock = makeMockBridge();
    setSpeechBridge(mock.bridge);
    const invoker = createToolInvoker({ vision: fakeVisionPort(), speechBridge: mock.bridge });
    const result = await invoker.callTool('asr_transcribe', { maxWaitMs: 200 }) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('asr_empty');
  }, 10_000);
});

describe('M6 KV 日限额存储', () => {
  test('按日分桶计数，increment 只保留当天（历史桶清理）', async () => {
    const kv: KVStore = createMemoryKVStore();
    const usage = createKvToolUsageStore(kv);
    expect(await usage.countFor('2026-10-15', 'tts_speak')).toBe(0);
    await usage.increment('2026-10-15', 'tts_speak');
    await usage.increment('2026-10-15', 'tts_speak');
    expect(await usage.countFor('2026-10-15', 'tts_speak')).toBe(2);
    await usage.increment('2026-10-16', 'tts_speak'); // 次日 → 旧桶清掉
    expect(await usage.countFor('2026-10-15', 'tts_speak')).toBe(0);
    expect(await usage.countFor('2026-10-16', 'tts_speak')).toBe(1);
  });

  test('KV 数据损坏从空重记（可丢不可阻）', async () => {
    const kv = createMemoryKVStore();
    await kv.set('edu:col:tool_usage', '{oops');
    const usage = createKvToolUsageStore(kv);
    expect(await usage.countFor('2026-10-15', 'web_search')).toBe(0);
  });
});
