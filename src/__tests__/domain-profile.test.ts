// M2a 域层测试：画像四层（防噪音/截尾/TTL/触发）。
import { describe, expect, test } from '@rstest/core';
import {
  MAX_SESSION_SUMMARIES,
  appendSessionSummary,
  createEmptyProfile,
  declareBoundary,
  detectSessionEndTrigger,
  isMindStateExpired,
  observeBoundary,
  shouldTriggerPeriodic,
} from '../domain/profile';
import type { LearnerProfile, SessionSummary } from '../domain/profile';

const NOW = new Date('2026-10-15T08:00:00.000Z');

function summary(sessionId: string): SessionSummary {
  return { sessionId, skill: 'review', at: NOW.toISOString(), whatHappened: 'x', stuckAt: [], nextSuggestion: 'y' };
}

describe('profile: 偏好防噪音（§5.3：≥2 次或明确声明才落库）', () => {
  test('观察第 1 次不落库、第 2 次落库', () => {
    const profile = createEmptyProfile();
    const first = observeBoundary(profile.preferences, '别用太多类比', NOW);
    expect(first.shouldPersist).toBe(false);
    expect(first.boundary.observedCount).toBe(1);

    const prefsWithFirst = { ...profile.preferences, boundaries: [first.boundary] };
    const second = observeBoundary(prefsWithFirst, '别用太多类比', NOW);
    expect(second.shouldPersist).toBe(true);
    expect(second.boundary.observedCount).toBe(2);
  });

  test('明确声明即时落库（source=declared）', () => {
    const profile = createEmptyProfile();
    const declared = declareBoundary(profile.preferences, '不喜欢被问"听懂了吗"', NOW);
    expect(declared.source).toBe('declared');
  });
});

describe('profile: 心理状态 TTL（§5.4/§5.5）', () => {
  test('过期即弃', () => {
    const mind = { text: '今天偏焦虑', expiresAt: '2026-10-15T09:00:00.000Z' };
    expect(isMindStateExpired(mind, new Date('2026-10-15T09:00:01.000Z'))).toBe(true);
    expect(isMindStateExpired(mind, new Date('2026-10-15T08:59:59.000Z'))).toBe(false);
  });
});

describe('profile: 会话摘要截尾（CONTRACTS §4：最近 50）', () => {
  test('追加截尾保留最近 50 条', () => {
    let profile: LearnerProfile = createEmptyProfile();
    for (let i = 0; i < MAX_SESSION_SUMMARIES + 5; i++) {
      profile = appendSessionSummary(profile, summary(`s-${i}`));
    }
    expect(profile.sessionSummaries).toHaveLength(MAX_SESSION_SUMMARIES);
    expect(MAX_SESSION_SUMMARIES).toBe(50);
    expect(profile.sessionSummaries[0].sessionId).toBe('s-5'); // 最早的被截掉
  });
});

describe('profile: 三类触发（§5.2）', () => {
  test('周期触发：会话 ≥10 分钟或交互 ≥8 次', () => {
    expect(shouldTriggerPeriodic(9, 7)).toBeNull();
    expect(shouldTriggerPeriodic(10, 0)).toEqual({ type: 'periodic', reason: 'session_10min' });
    expect(shouldTriggerPeriodic(1, 8)).toEqual({ type: 'periodic', reason: 'interactions_8' });
  });

  test('会话结束触发：idle 90s / 退后台 / 连跳 2 次 / 再见', () => {
    expect(detectSessionEndTrigger({ idleMs: 90_001 })).toBe('idle_90s');
    expect(detectSessionEndTrigger({ idleMs: 90_000 })).toBeNull();
    expect(detectSessionEndTrigger({ enteredBackground: true })).toBe('enter_background');
    expect(detectSessionEndTrigger({ consecutiveSkips: 2 })).toBe('skip_twice');
    expect(detectSessionEndTrigger({ saidGoodbye: true, idleMs: 100_000 })).toBe('goodbye');
    expect(detectSessionEndTrigger({})).toBeNull();
  });
});
