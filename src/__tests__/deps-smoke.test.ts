// M2-pre 依赖冒烟测试：验证 ts-fsrs（核心域层唯一算法依赖）已锁定且 API 形状符合 ARCHITECTURE §12 假设。
import { expect, test } from '@rstest/core';

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
} from 'ts-fsrs';

test('ts-fsrs generatorParameters(0.9) returns FSRS-6 default weights', () => {
  const params = generatorParameters(0.9);
  expect(params.request_retention).toBe(0.9);
  expect(Array.isArray(params.w)).toBe(true);
  expect(params.w).toHaveLength(21);
  expect(params.w[0]).toBeCloseTo(0.212, 3);
  expect(params.enable_fuzz).toBe(false);
});

test('ts-fsrs Rating/State enums match domain mapping assumptions', () => {
  expect(Rating.Again).toBe(1);
  expect(Rating.Hard).toBe(2);
  expect(Rating.Good).toBe(3);
  expect(Rating.Easy).toBe(4);
  expect(State.New).toBe(0);
  expect(State.Learning).toBe(1);
  expect(State.Review).toBe(2);
  expect(State.Relearning).toBe(3);
});

test('ts-fsrs fsrs() schedules a new card (RecordLog keyed by Rating)', () => {
  const f = fsrs(generatorParameters(0.9));
  const now = new Date('2026-10-15T00:00:00.000Z');
  const card = createEmptyCard(now);
  expect(card.state).toBe(State.New);

  const log = f.repeat(card, now);
  const good = log[Rating.Good];
  expect(good.card.state).toBe(State.Learning);
  expect(good.card.due.getTime()).toBeGreaterThan(now.getTime());
});
