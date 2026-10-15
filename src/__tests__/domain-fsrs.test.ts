// M2a 域层测试：FSRS 封装（映射/骨架/间隔升降/status 映射）。
import { describe, expect, test } from '@rstest/core';
import { State, type Card } from 'ts-fsrs';
import {
  CONSOLIDATED_DAYS,
  EBINGHAUS_SKELETON,
  createScheduler,
  deriveStatus,
  gradeToRating,
  newCardForQueue,
  scheduleReview,
} from '../domain/fsrs';
import { Rating } from 'ts-fsrs';

const day = (base: Date, n: number) => new Date(base.getTime() + n * 86_400_000);
const BASE = new Date('2026-10-15T00:00:00.000Z');

function reviewCard(scheduledDays: number, reps = 6): Card {
  return {
    due: day(BASE, scheduledDays),
    stability: 20,
    difficulty: 5,
    elapsed_days: scheduledDays,
    scheduled_days: scheduledDays,
    learning_steps: 0,
    reps,
    lapses: 0,
    state: State.Review,
    last_review: day(BASE, 0),
  };
}

describe('fsrs: 判定映射（D8）', () => {
  test('correct→Good(3)、wrong→Again(1)', () => {
    expect(gradeToRating('correct')).toBe(Rating.Good);
    expect(gradeToRating('wrong')).toBe(Rating.Again);
  });

  test('调度器目标保持率 0.9', () => {
    const f = createScheduler();
    expect(f.parameters.request_retention).toBe(0.9);
    expect(createScheduler(0.95).parameters.request_retention).toBe(0.95);
  });
});

describe('fsrs: 冷启动骨架 1-2-4-7-15（D6）', () => {
  test('newCardForQueue 初次入队 due=T+1', () => {
    const card = newCardForQueue(BASE);
    expect(card.state).toBe(State.New);
    expect(card.due.getTime()).toBe(day(BASE, 1).getTime());
    expect(card.scheduled_days).toBe(1);
  });

  test('答对序列按骨架 2/4/7/15 覆盖，第 5 次起 FSRS 接管', () => {
    let card = newCardForQueue(BASE);
    let t = day(BASE, 1);
    const expected = [2, 4, 7, 15];
    for (let i = 0; i < expected.length; i++) {
      const r = scheduleReview(card, 'correct', t);
      expect(r.skeletonApplied).toBe(true);
      expect(r.card.scheduled_days).toBe(expected[i]);
      expect(r.card.due.getTime()).toBe(day(t, expected[i]).getTime());
      card = r.card;
      t = r.card.due;
    }
    // 第 5 次答对：骨架用尽，FSRS 默认参数接管（间隔远大于 15）
    const r5 = scheduleReview(card, 'correct', t);
    expect(r5.skeletonApplied).toBe(false);
    expect(r5.card.scheduled_days).toBeGreaterThan(EBINGHAUS_SKELETON[4]);
  });

  test('答对间隔上升：Review 卡 correct 后 due 显著后移', () => {
    const card = reviewCard(20);
    const r = scheduleReview(card, 'correct', day(BASE, 20));
    expect(r.card.scheduled_days).toBeGreaterThan(20);
    expect(r.card.stability).toBeGreaterThan(card.stability);
  });

  test('答错间隔下降：Review 卡 wrong → Relearning、lapse+1、短间隔', () => {
    const card = reviewCard(20);
    const r = scheduleReview(card, 'wrong', day(BASE, 20));
    expect(r.card.state).toBe(State.Relearning);
    expect(r.card.lapses).toBe(1);
    expect(r.card.due.getTime() - day(BASE, 20).getTime()).toBeLessThan(86_400_000); // 远短于一天
    expect(r.skeletonApplied).toBe(false);
  });
});

describe('fsrs: 产品 status ↔ FSRS State 映射（D5）', () => {
  test('已稳固阈值：Review 且 scheduled_days≥21 → consolidated（默认/参数化）', () => {
    expect(deriveStatus(reviewCard(21))).toBe('consolidated');
    expect(deriveStatus(reviewCard(20))).toBe('learned_once');
    expect(deriveStatus(reviewCard(20), { consolidatedDays: 30 })).toBe('learned_once');
    expect(deriveStatus(reviewCard(30), { consolidatedDays: 30 })).toBe('consolidated');
    expect(CONSOLIDATED_DAYS).toBe(21);
  });

  test('暂记：Relearning 或近期 wrong → retaining', () => {
    const relearning = { ...reviewCard(20), state: State.Relearning as Card['state'] };
    expect(deriveStatus(relearning)).toBe('retaining');
    expect(deriveStatus(reviewCard(20), { lastGrade: 'wrong' })).toBe('retaining');
  });

  test('New/Learning → learned_once（入队语境；unseen/seen 由调用方管理，硬规则1）', () => {
    expect(deriveStatus(newCardForQueue(BASE))).toBe('learned_once');
    expect(deriveStatus({ ...reviewCard(20), state: State.Learning as Card['state'] })).toBe('learned_once');
  });
});
