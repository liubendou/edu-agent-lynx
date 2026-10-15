// M2a 存储层测试：KV（native 探测 + 内存 fallback）+ 9 集合仓库往返 + 1s 撤销窗口。
import { describe, expect, test } from '@rstest/core';
import { createMemoryKVStore, createNativeKVStore, detectNativeStorage } from '../storage/kv';
import type { StorageModuleLike } from '../storage/kv';
import { DEFAULT_APP_SETTINGS, DEFAULT_GRAYSCALE, Repositories } from '../storage/repos';
import { createEnqueuedState } from '../domain/fsrs';
import { createEmptyProfile } from '../domain/profile';
import type { AnswerRecord } from '../domain/alu';

const BASE = new Date('2026-10-15T08:00:00.000Z');

function record(grade: AnswerRecord['grade'], aluId = 'a-1', revoked = false): AnswerRecord {
  return { aluId, grade, latencyMs: 1000, skill: 'review', at: BASE.toISOString(), ...(revoked ? { revoked: true } : {}) };
}

describe('kv: Native 探测与 fallback', () => {
  test('无 NativeModules 环境 → 探测为 null、createKVStore 走内存', () => {
    expect(detectNativeStorage()).toBeNull();
  });

  test('内存 KV 读写往返', async () => {
    const kv = createMemoryKVStore();
    await kv.set('k', 'v1');
    expect(await kv.get('k')).toBe('v1');
    expect(await kv.get('missing')).toBeNull();
    await kv.set('k', 'v2');
    expect(await kv.get('k')).toBe('v2');
    await kv.remove('k');
    expect(await kv.get('k')).toBeNull();
    await kv.set('a', '1');
    await kv.set('b', '2');
    expect((await kv.keys()).sort()).toEqual(['a', 'b']);
  });

  test('注入 fake StorageModule 全局 → 原生适配层可用', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const store = new Map<string, string>();
    const fake: StorageModuleLike = {
      setItem: (k, v) => { store.set(k, v); },
      getItem: (k, cb) => { cb(store.has(k) ? (store.get(k) as string) : null); },
      removeItem: (k) => { store.delete(k); },
      getAllKeys: (cb) => { cb(Array.from(store.keys())); },
    };
    const saved = g['NativeModules'];
    g['NativeModules'] = { StorageModule: fake };
    try {
      expect(detectNativeStorage()).toBe(fake);
      const kv = createNativeKVStore(detectNativeStorage()!);
      await kv.set('k', 'native');
      expect(await kv.get('k')).toBe('native');
      expect(await kv.keys()).toEqual(['k']);
    } finally {
      if (saved === undefined) delete g['NativeModules'];
      else g['NativeModules'] = saved;
    }
  });
});

describe('repos: 9 集合读写往返（内存 fallback KV）', () => {
  test('alu / alu_state / gate_reports / budget / profile / settings / grayscale', async () => {
    const repos = new Repositories(createMemoryKVStore());
    const alu = {
      id: 'psy-001', subjectId: 'psy', moduleId: 'stat', kind: 'concept' as const,
      front: 'p 值？', back: '…', variants: [], prereq: [], difficulty: 2,
      source: { docId: 'd1', docTitle: 't', locator: { kind: 'span' as const, start: 0, end: 5 }, text: '原句' },
    };
    await repos.putAlu(alu);
    expect((await repos.getAlu('psy-001'))?.front).toBe('p 值？');

    const state = createEnqueuedState('psy-001', BASE, 'standard');
    await repos.putAluState(state);
    expect((await repos.getAluState('psy-001'))?.status).toBe('learned_once');
    expect((await repos.getAluState('psy-001'))?.fsrs.due.getTime()).toBeGreaterThan(BASE.getTime());

    const report = {
      batchId: 'b1',
      traceability: { rate: 1, isolatedAluIds: [] },
      judgeable: { rate: 0.95, sampleSize: 120, llmReview: true, manualRatio: 0.25 },
      granularity: { rate: 0.9, sampleSize: 120 },
      verdict: 'pass' as const,
      createdAt: BASE.toISOString(),
    };
    await repos.putGateReport(report);
    expect((await repos.getGateReport('b1'))?.verdict).toBe('pass');

    await repos.saveBudget({ date: '2026-10-15', dailyTokenUsed: 0, dailyTokenLimit: 100, escalationsUsed: 0, escalationLimit: 1 });
    expect((await repos.loadBudget())?.dailyTokenLimit).toBe(100);

    await repos.saveProfile(createEmptyProfile());
    expect((await repos.loadProfile())?.version).toBe(1);

    expect(await repos.loadSettings()).toEqual(DEFAULT_APP_SETTINGS);
    expect(DEFAULT_APP_SETTINGS.cloudSync).toBe(false);
    await repos.saveSettings({ ...DEFAULT_APP_SETTINGS, cloudSync: true });
    expect((await repos.loadSettings()).cloudSync).toBe(true);

    expect(await repos.loadGrayscale()).toEqual(DEFAULT_GRAYSCALE);
    expect(DEFAULT_GRAYSCALE.mode).toBe('seed');
  });

  test('review_log：仅 correct/wrong 落盘（fuzzy 不落，D8；revoked 不落）', async () => {
    const repos = new Repositories(createMemoryKVStore());
    await repos.appendReviewLog([record('correct', 'a-1'), record('fuzzy', 'a-2'), record('wrong', 'a-3'), record('correct', 'a-4', true)]);
    const log = await repos.listReviewLog();
    expect(log.map((r) => r.aluId)).toEqual(['a-1', 'a-3']);
  });

  test('session_summaries 追加截尾 50', async () => {
    const repos = new Repositories(createMemoryKVStore());
    for (let i = 0; i < 55; i++) {
      await repos.appendSessionSummary({ sessionId: `s-${i}`, skill: 'review', at: BASE.toISOString(), whatHappened: '', stuckAt: [], nextSuggestion: '' });
    }
    const all = await repos.listSessionSummaries();
    expect(all).toHaveLength(50);
    expect(all[0].sessionId).toBe('s-5');
  });

  test('loadAll/saveAll 回合边界批量落盘', async () => {
    const repos = new Repositories(createMemoryKVStore());
    await repos.saveAll({ grayscale: { consecutivePasses: 2, mode: 'auto_split' } });
    const loaded = await repos.loadAll();
    expect(loaded.grayscale).toEqual({ consecutivePasses: 2, mode: 'auto_split' });
    expect(loaded.alu).toBeUndefined(); // 未写集合不出现
  });
});

describe('repos: judge 延迟提交（1 秒撤销窗口，UID §三）', () => {
  test('撤销期内不落盘不进日志；revoke 后 flush 也不落', async () => {
    const kv = createMemoryKVStore();
    const repos = new Repositories(kv, 60_000); // 长窗口：不自动到期
    const state = createEnqueuedState('a-1', BASE, 'standard');
    repos.judgeCommitter.submit('a-1', { aluState: state, record: record('correct') });

    expect(repos.judgeCommitter.isPending('a-1')).toBe(true);
    // 撤销期内：未落盘、未进日志
    expect(await repos.getAluState('a-1')).toBeNull();
    expect(await repos.listReviewLog()).toEqual([]);

    const revokedPayload = repos.judgeCommitter.revoke('a-1');
    expect(revokedPayload?.record?.grade).toBe('correct');
    await repos.judgeCommitter.flush();
    // 撤销后：仍不落盘
    expect(await repos.getAluState('a-1')).toBeNull();
    expect(await repos.listReviewLog()).toEqual([]);
  });

  test('flush（回合边界）立即提交：alu_state 更新 + review_log 追加', async () => {
    const kv = createMemoryKVStore();
    const repos = new Repositories(kv, 60_000);
    const state = createEnqueuedState('a-1', BASE, 'standard');
    repos.judgeCommitter.submit('a-1', { aluState: state, record: record('correct') });
    await repos.judgeCommitter.flush();

    expect((await repos.getAluState('a-1'))?.aluId).toBe('a-1');
    expect((await repos.listReviewLog()).map((r) => r.grade)).toEqual(['correct']);
  });

  test('窗口到期自动提交（默认 1s 语义的小延迟模拟）', async () => {
    const kv = createMemoryKVStore();
    const repos = new Repositories(kv, 15);
    repos.judgeCommitter.submit('a-1', { aluState: createEnqueuedState('a-1', BASE, 'standard'), record: record('wrong') });
    await new Promise((r) => setTimeout(r, 60)); // 超过 15ms 窗口
    expect((await repos.listReviewLog()).map((r) => r.grade)).toEqual(['wrong']);
  });

  test('fuzzy 提交不进 review_log（D8）', async () => {
    const kv = createMemoryKVStore();
    const repos = new Repositories(kv, 60_000);
    repos.judgeCommitter.submit('a-1', { aluState: createEnqueuedState('a-1', BASE, 'standard'), record: record('fuzzy') });
    await repos.judgeCommitter.flush();
    expect(await repos.listReviewLog()).toEqual([]);
    expect((await repos.getAluState('a-1'))?.aluId).toBe('a-1'); // 状态仍更新（含 lastAnswers 会话语义由上层维护）
  });
});
