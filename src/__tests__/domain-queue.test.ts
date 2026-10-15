// M2a 域层测试：到期队列（R 升序/D11 收藏优先/交错抽取/预算截断）。
import { describe, expect, test } from '@rstest/core';
import { DEFAULT_DAILY_BUDGET, MAX_BATCH_PER_ROUND, pickReviewBatch, type QueueItem } from '../domain/queue';

let seq = 0;
function item(partial: Partial<QueueItem> & Pick<QueueItem, 'retrievability' | 'moduleId'>): QueueItem {
  seq += 1;
  return {
    ...partial,
    aluId: partial.aluId ?? `a-${seq}`,
    due: partial.due ?? '2026-10-15T00:00:00.000Z',
    isPriority: partial.isPriority ?? false,
    bookmarked: partial.bookmarked ?? false,
  };
}

describe('queue: R 升序底序（§4.6③）', () => {
  test('R 低的（最先跌出保持率）排前', () => {
    const batch = pickReviewBatch(
      [item({ retrievability: 0.95, moduleId: 'm1' }), item({ retrievability: 0.72, moduleId: 'm2' }), item({ retrievability: 0.85, moduleId: 'm3' })],
      10,
    );
    expect(batch.map((i) => i.retrievability)).toEqual([0.72, 0.85, 0.95]);
  });
});

describe('queue: 同日到期 bookmarked > isPriority > 普通（D11，仅排序不改间隔）', () => {
  test('同日到期时收藏卡优先于重点卡、重点卡优先于普通卡', () => {
    const batch = pickReviewBatch(
      [
        item({ aluId: 'plain', retrievability: 0.9, moduleId: 'm1' }),
        item({ aluId: 'prio', retrievability: 0.9, moduleId: 'm2', isPriority: true }),
        item({ aluId: 'marked', retrievability: 0.9, moduleId: 'm3', bookmarked: true }),
      ],
      10,
    );
    expect(batch.map((i) => i.aluId)).toEqual(['marked', 'prio', 'plain']);
  });

  test('不同日到期仍以 R 升序为主序', () => {
    const batch = pickReviewBatch(
      [
        item({ aluId: 'tomorrow-low-r', retrievability: 0.8, moduleId: 'm1', due: '2026-10-16T00:00:00.000Z' }),
        item({ aluId: 'today-marked', retrievability: 0.95, moduleId: 'm2', bookmarked: true, due: '2026-10-15T00:00:00.000Z' }),
      ],
      10,
    );
    // 非同日：R 0.8 在前（跨日不适用收藏优先覆盖）
    expect(batch[0].aluId).toBe('tomorrow-low-r');
  });
});

describe('queue: 交错抽取（§4.6②）', () => {
  test('同板块至多 2 张', () => {
    const items: QueueItem[] = [];
    for (let i = 0; i < 5; i++) items.push(item({ retrievability: 0.5 + i * 0.01, moduleId: 'same' }));
    for (let m = 2; m <= 6; m++) items.push(item({ retrievability: 0.6 + m * 0.01, moduleId: `m${m}` }));
    const batch = pickReviewBatch(items, 20);
    expect(batch.filter((i) => i.moduleId === 'same')).toHaveLength(2);
    expect(batch.length).toBeGreaterThan(2);
  });
});

describe('queue: 预算截断与一次只还 3~6 张（§2 欠账牵引）', () => {
  test('budget 截断', () => {
    const items = Array.from({ length: 10 }, (_, i) => item({ retrievability: 0.5 + i * 0.01, moduleId: `m${i}` }));
    expect(pickReviewBatch(items, 3)).toHaveLength(3);
  });

  test('预算充足时批次上限 6（一次只还 3~6 张）', () => {
    const items = Array.from({ length: 20 }, (_, i) => item({ retrievability: 0.5 + i * 0.01, moduleId: `m${i}` }));
    expect(pickReviewBatch(items, 20)).toHaveLength(MAX_BATCH_PER_ROUND);
    expect(MAX_BATCH_PER_ROUND).toBe(6);
  });

  test('默认预算存在且为正', () => {
    expect(DEFAULT_DAILY_BUDGET.newCards).toBeGreaterThan(0);
    expect(DEFAULT_DAILY_BUDGET.reviewCards).toBeGreaterThan(0);
  });
});
