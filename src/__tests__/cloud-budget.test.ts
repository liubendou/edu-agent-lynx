// M2c 成本护栏测试：token 日预算计数与持久化、跨日重置、升级配额、闲时调度队列。
import { describe, expect, test } from '@rstest/core';
import { BudgetGuard, DEFAULT_DAILY_TOKEN_LIMIT, DEFAULT_ESCALATION_LIMIT } from '../cloud';
import { Repositories } from '../storage/repos';
import { createMemoryKVStore } from '../storage/kv';

const DAY1 = new Date('2026-10-15T08:00:00.000Z');
const DAY2 = new Date('2026-10-16T08:00:00.000Z');

function newGuard(now = DAY1) {
  const repos = new Repositories(createMemoryKVStore());
  return { repos, guard: new BudgetGuard({ repos, now: () => now }) };
}

describe('cloud-budget: 日预算计数与持久化', () => {
  test('recordUsage 累计并落盘（Repositories.budget 集合）', async () => {
    const { repos, guard } = newGuard();
    const s1 = await guard.recordUsage(1200);
    expect(s1.dailyTokenUsed).toBe(1200);
    const s2 = await guard.recordUsage(800);
    expect(s2.dailyTokenUsed).toBe(2000);
    // 持久化：新实例读同一仓库可见
    const reloaded = new BudgetGuard({ repos, now: () => DAY1 });
    expect((await reloaded.getState()).dailyTokenUsed).toBe(2000);
    expect((await reloaded.getState()).dailyTokenLimit).toBe(DEFAULT_DAILY_TOKEN_LIMIT);
  });

  test('跨日自动重置计数', async () => {
    const { repos, guard } = newGuard();
    await guard.recordUsage(999_999);
    await guard.recordEscalation();
    const nextDay = new BudgetGuard({ repos, now: () => DAY2 });
    const state = await nextDay.getState();
    expect(state.date).toBe('2026-10-16');
    expect(state.dailyTokenUsed).toBe(0);
    expect(state.escalationsUsed).toBe(0);
  });

  test('isOverBudget / remainingTokens / canEscalate', async () => {
    const { guard } = newGuard();
    await guard.recordUsage(600);
    let state = await guard.getState();
    expect(guard.isOverBudget(state)).toBe(false);
    expect(guard.remainingTokens(state)).toBe(DEFAULT_DAILY_TOKEN_LIMIT - 600);
    state = await guard.recordUsage(DEFAULT_DAILY_TOKEN_LIMIT); // 超预算仍如实计数
    expect(guard.isOverBudget(state)).toBe(true);
    expect(guard.remainingTokens(state)).toBe(0);
    expect(await guard.canEscalate()).toBe(true);
  });
});

describe('cloud-budget: 升级配额', () => {
  test('配额内递增；到顶后 recordEscalation 返回 null 且 canEscalate=false', async () => {
    const { guard } = newGuard();
    for (let i = 1; i <= DEFAULT_ESCALATION_LIMIT; i++) {
      const state = await guard.recordEscalation();
      expect(state?.escalationsUsed).toBe(i);
    }
    expect(await guard.recordEscalation()).toBeNull();
    expect(await guard.canEscalate()).toBe(false);
  });

  test('自定义配额与默认值可调', async () => {
    const repos = new Repositories(createMemoryKVStore());
    const guard = new BudgetGuard({ repos, now: () => DAY1, defaults: { escalationLimit: 1 } });
    expect((await guard.recordEscalation())?.escalationsUsed).toBe(1);
    expect(await guard.recordEscalation()).toBeNull();
  });
});

describe('cloud-budget: 闲时调度队列（非实时任务）', () => {
  test('登记/出队 FIFO + 持久化', async () => {
    const { repos, guard } = newGuard();
    await guard.enqueueIdle({ kind: 'batch_split', payload: { batchId: 'b1' } });
    await guard.enqueueIdle({ kind: 'batch_review', payload: { batchId: 'r1' } });
    expect(await guard.idleQueueSize()).toBe(2);

    // 持久化：新实例可见（闲时执行器另一会话出队）
    const reloaded = new BudgetGuard({ repos, now: () => DAY1 });
    const first = await reloaded.dequeueIdle(1);
    expect(first).toHaveLength(1);
    expect(first[0].kind).toBe('batch_split');
    expect((first[0].payload as { batchId: string }).batchId).toBe('b1');

    const rest = await reloaded.dequeueIdle();
    expect(rest).toHaveLength(1);
    expect(rest[0].kind).toBe('batch_review');
    expect(await reloaded.idleQueueSize()).toBe(0);
    expect(await guard.dequeueIdle()).toEqual([]);
  });

  test('peek 不出队；登记 id 可指定', async () => {
    const { guard } = newGuard();
    await guard.enqueueIdle({ id: 'task-9', kind: 'batch_review', payload: null });
    const peeked = await guard.peekIdle();
    expect(peeked[0].id).toBe('task-9');
    expect(await guard.idleQueueSize()).toBe(1); // peek 不影响队列
    const out = await guard.dequeueIdle();
    expect(out[0].id).toBe('task-9');
  });
});
