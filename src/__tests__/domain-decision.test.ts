// M2a 域层测试：今日决策（D10 优先级）+ 保持率催收 + TodayPlan。
import { describe, expect, test } from '@rstest/core';
import { buildTodayPlan, decideToday, retentionPressure } from '../domain/decision';
import type { QueueItem } from '../domain/queue';
import type { Goal } from '../domain/profile';

const NOW = new Date('2026-10-15T08:00:00.000Z');
const BUDGET = { newCards: 5, reviewCards: 20 };

function dueItem(aluId: string, retrievability: number, moduleId = 'm1'): QueueItem {
  return { aluId, due: '2026-10-15T00:00:00.000Z', retrievability, moduleId, isPriority: false, bookmarked: false };
}

describe('decision: D10 优先级（到期复习 > 当日补讲 > 新学）', () => {
  test('有到期卡 → review（batch 按 R 升序）', () => {
    const r = decideToday({
      dueItems: [dueItem('a-1', 0.9), dueItem('a-2', 0.7)],
      budget: BUDGET,
      remediationAluIds: ['r-1'],
      now: NOW,
    });
    expect(r.decision.kind).toBe('review');
    if (r.decision.kind === 'review') {
      expect(r.decision.batch.map((i) => i.aluId)).toEqual(['a-2', 'a-1']);
      expect(r.decision.remediationCount).toBe(1);
    }
    expect(r.reason).toContain('到期');
  });

  test('无到期、有补讲 → remediation', () => {
    const r = decideToday({ dueItems: [], budget: BUDGET, remediationAluIds: ['r-1', 'r-2'], now: NOW });
    expect(r.decision.kind).toBe('remediation');
    if (r.decision.kind === 'remediation') expect(r.decision.aluIds).toEqual(['r-1', 'r-2']);
  });

  test('无欠账 → new_learn（带可解释 reason）', () => {
    const r = decideToday({
      dueItems: [], budget: BUDGET, remediationAluIds: [],
      newSuggestion: { aluId: 'new-1' }, now: NOW,
    });
    expect(r.decision.kind).toBe('new_learn');
    if (r.decision.kind === 'new_learn') {
      expect(r.decision.suggestion.aluId).toBe('new-1');
      expect(r.decision.reason.length).toBeGreaterThan(0);
    }
    expect(r.reason.length).toBeGreaterThan(0);
  });

  test('首启 → first_run', () => {
    const r = decideToday({ dueItems: [], budget: BUDGET, remediationAluIds: [], isFirstRun: true, now: NOW });
    expect(r.decision.kind).toBe('first_run');
  });
});

describe('decision: 保持率催收（§5.6 目标期限临近）', () => {
  const goal = (deadline: string): Goal => ({ text: '考研', deadline, createdAt: '2026-09-01T00:00:00.000Z' });

  test('无期限压力：保持率 0.9、不压缩', () => {
    const p = retentionPressure([], NOW);
    expect(p.requestRetention).toBe(0.9);
    expect(p.compressNewLearn).toBe(false);
    expect(p.daysToDeadline).toBeNull();
  });

  test('deadline ≤3 天：紧急档 0.95 + 压缩新学', () => {
    const p = retentionPressure([goal('2026-10-17T00:00:00.000Z')], NOW);
    expect(p.requestRetention).toBe(0.95);
    expect(p.compressNewLearn).toBe(true);
  });

  test('deadline ≤7 天：催收档 0.92 + 压缩新学', () => {
    const p = retentionPressure([goal('2026-10-20T00:00:00.000Z')], NOW);
    expect(p.requestRetention).toBe(0.92);
    expect(p.compressNewLearn).toBe(true);
  });

  test('已过期 deadline 忽略；远期不催收', () => {
    expect(retentionPressure([goal('2026-10-01T00:00:00.000Z')], NOW).daysToDeadline).toBeNull();
    const far = retentionPressure([goal('2026-12-01T00:00:00.000Z')], NOW);
    expect(far.requestRetention).toBe(0.9);
    expect(far.compressNewLearn).toBe(false);
  });

  test('催收信息进入 new_learn reason', () => {
    const r = decideToday({
      dueItems: [], budget: BUDGET, remediationAluIds: [],
      goals: [goal('2026-10-17T00:00:00.000Z')], now: NOW,
    });
    expect(r.reason).toContain('压缩');
  });
});

describe('decision: TodayPlan（回访第一屏三行）', () => {
  test('三行数据 + 端侧生成时间', () => {
    const r = decideToday({ dueItems: [dueItem('a-1', 0.8)], budget: BUDGET, remediationAluIds: ['r-1'], now: NOW });
    const plan = buildTodayPlan({ dueCount: 1, remediationCount: 1, suggestion: r.decision as import('../domain/decision').TodayPlan['suggestion'], now: NOW });
    expect(plan.dueCount).toBe(1);
    expect(plan.remediationCount).toBe(1);
    expect(plan.suggestion.kind).toBe('review');
    expect(plan.generatedAt).toBe(NOW.toISOString());
  });
});
