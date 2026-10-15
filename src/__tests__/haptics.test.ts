// M4 haptics 单测（T7）：D1 两触发点 + 档位门控（三档全保留触觉，静止档补位互补）+
// 后端注入。@sigx/lynx-haptics 在 jsdom 无宿主 Haptics 模块，全部经 setHapticsBackend 注入记录器。
import { beforeEach, describe, expect, test } from '@rstest/core';
import {
  hapticJudge,
  hapticSnap,
  setHapticsBackend,
  setHapticsSignals,
  type HapticsBackend,
} from '../components/haptics';
import { tierParams } from '../design-system/theme';

interface Recorder extends HapticsBackend {
  impacts: string[];
  notifications: string[];
  selections: number;
}

function makeRecorder(): Recorder {
  const recorder: Recorder = {
    impacts: [],
    notifications: [],
    selections: 0,
    impact(style) {
      recorder.impacts.push(style ?? 'default');
    },
    notification(type) {
      recorder.notifications.push(type ?? 'default');
    },
    selection() {
      recorder.selections += 1;
    },
  };
  return recorder;
}

describe('M4 haptics：D1 两触发点 + 档位门控', () => {
  beforeEach(() => {
    setHapticsSignals(null); // 恢复默认 full 档信号
  });

  test('hapticSnap：吸附到位 = impact light（D1 ①）', () => {
    const recorder = makeRecorder();
    setHapticsBackend(recorder);
    hapticSnap();
    expect(recorder.impacts).toEqual(['light']);
    expect(recorder.notifications).toEqual([]);
    expect(recorder.selections).toBe(0);
  });

  test('hapticJudge 映射：对=success / 错=error / 模糊=selection（模糊只给轻确认，D8）', () => {
    const recorder = makeRecorder();
    setHapticsBackend(recorder);
    hapticJudge('correct');
    hapticJudge('wrong');
    hapticJudge('fuzzy');
    expect(recorder.notifications).toEqual(['success', 'error']);
    expect(recorder.selections).toBe(1);
  });

  test('静止档（reduceMotion）触觉保留（D1：动效可关、触觉补位互补）', () => {
    setHapticsSignals({ reduceMotion: true, lowEndDevice: false, powerSave: false, sustainedJank: false });
    const recorder = makeRecorder();
    setHapticsBackend(recorder);
    hapticSnap();
    hapticJudge('correct');
    expect(recorder.impacts).toEqual(['light']);
    expect(recorder.notifications).toEqual(['success']);
  });

  test('精简档（lowEndDevice）触觉同样保留（三档参数表全 haptics:true）', () => {
    setHapticsSignals({ reduceMotion: false, lowEndDevice: true, powerSave: false, sustainedJank: false });
    const recorder = makeRecorder();
    setHapticsBackend(recorder);
    hapticSnap();
    expect(recorder.impacts).toEqual(['light']);
  });

  test('门控为结构性占位：三档 tierParams().haptics 均为 true（档位表调整即生效）', () => {
    expect(tierParams('full').haptics).toBe(true);
    expect(tierParams('reduced').haptics).toBe(true);
    expect(tierParams('static').haptics).toBe(true);
  });

  test('setHapticsBackend(null) 恢复真实现（jsdom 无宿主模块时包内静默 no-op，不抛错）', () => {
    setHapticsBackend(makeRecorder());
    expect(() => setHapticsBackend(null)).not.toThrow();
    expect(() => hapticSnap()).not.toThrow(); // 真实现 no-op 路径
  });
});
