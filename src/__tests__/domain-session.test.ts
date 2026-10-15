// M2a 域层测试：会话状态机（三条硬规则代码强制）+ 前置归因 BFS + fuzzy/struggleWin/撤销。
import { describe, expect, test } from '@rstest/core';
import { State, type Card } from 'ts-fsrs';
import { buildPrereqGraph, createAlu, tracePrereqSuspects } from '../domain/alu';
import type { Alu } from '../domain/alu';
import { newCardForQueue } from '../domain/fsrs';
import {
  REMEDIATION_DURATION_MS,
  allowsCardGeneration,
  completeRemediation,
  emitCardGenerated,
  improvedSinceLastWrong,
  judgeAnswer,
  popFuzzyRequeue,
  revokeAnswer,
  startSession,
} from '../domain/session';
import { createJudgeEvent } from '../domain/events';

const BASE = new Date('2026-10-15T08:00:00.000Z');
const day = (n: number) => new Date(BASE.getTime() + n * 86_400_000);

function makeAlu(id: string, prereq: string[] = [], moduleId = 'm1'): Alu {
  return createAlu({
    id, subjectId: 'psy', moduleId, kind: 'concept',
    front: `${id} 正题？`, back: `${id} 背面`,
    prereq, difficulty: 2,
    source: { docId: 'doc-1', docTitle: '样例', locator: { kind: 'span', start: 0, end: 10 }, text: '原句' },
  });
}

function reviewCard(dueInDays = 1, reps = 6): Card {
  return {
    due: day(dueInDays),
    stability: 20,
    difficulty: 5,
    elapsed_days: 20,
    scheduled_days: 20,
    learning_steps: 0,
    reps,
    lapses: 0,
    state: State.Review,
    last_review: BASE,
  };
}

const PARAMS = { cardGeneration: true };

describe('alu: 前置归因 BFS（§4.6②/F1）', () => {
  test('沿 prereq 向上游追溯，按距离升序，限深、去重、环安全', () => {
    // a3 ← a2 ← a1（深度 1、2）；a4 ← a1（深度 3）；b 独立
    const alus = [
      makeAlu('a3', ['a2']),
      makeAlu('a2', ['a1']),
      makeAlu('a1', ['a0']),
      makeAlu('a4', ['a3']),
      makeAlu('b'),
    ];
    const graph = buildPrereqGraph(alus);
    // 深度 3：a2(d1) a1(d2) a0(d3) a4? a4 依赖 a3 不在上游
    expect(tracePrereqSuspects('a3', graph, { maxDepth: 3 })).toEqual(['a2', 'a1', 'a0']);
    // 限深 1：只一层
    expect(tracePrereqSuspects('a3', graph, { maxDepth: 1 })).toEqual(['a2']);
    // 环：c1↔c2 不死循环
    const cyclic = buildPrereqGraph([makeAlu('c1', ['c2']), makeAlu('c2', ['c1'])]);
    expect(tracePrereqSuspects('c1', cyclic)).toEqual(['c2']);
    // 无前置
    expect(tracePrereqSuspects('b', graph)).toEqual([]);
  });

  test('createAlu 工厂校验：难度刻度、prereq 自环', () => {
    expect(() => makeAlu('x', ['x'])).toThrow();
    const base = makeAlu('y');
    expect(() => createAlu({ ...base, id: 'y2', difficulty: 6 })).toThrow();
    expect(() => createAlu({ ...base, id: 'y3', difficulty: 0 })).toThrow(); // 非资源型下限 1
    expect(() => createAlu({ ...base, id: 'y4', kind: 'resource', difficulty: 0, variants: [] })).toBeTruthy();
  });
});

describe('session: 硬规则1——快速档不产生复习欠账', () => {
  test('quick 会话强制 cardGeneration=false 且 judge 不写 FSRS、不可发卡', () => {
    const s0 = startSession({ sessionId: 's1', skill: 'quick-learning', aluIds: ['a-1'], params: { ...PARAMS }, now: BASE });
    expect(s0.params.cardGeneration).toBe(false);
    expect(allowsCardGeneration('quick-learning')).toBe(false);

    const { state, fsrsApplied } = judgeAnswer(s0, { aluId: 'a-1', grade: 'correct', latencyMs: 900, now: BASE });
    expect(fsrsApplied).toBe(false);
    expect(state.cards['a-1']).toBeUndefined();
    expect(() => emitCardGenerated(state, ['a-1'], 'chunk-1')).toThrow(/硬规则2|forbidden/);
  });
});

describe('session: 硬规则2——card_generated 仅 standard/deep 可发', () => {
  test('review 档发卡抛错；standard 档成功', () => {
    const review = startSession({ sessionId: 's2', skill: 'review', aluIds: ['a-1'], params: { cardGeneration: false }, now: BASE });
    expect(() => emitCardGenerated(review, ['a-1'], 'chunk-1')).toThrow();

    const std = startSession({ sessionId: 's3', skill: 'standard-learning', aluIds: ['a-1'], params: { ...PARAMS }, now: BASE });
    const { state, event } = emitCardGenerated(std, ['a-1', 'a-2'], 'chunk-1');
    expect(event.type).toBe('card_generated');
    expect(state.events.some((e) => e.type === 'card_generated')).toBe(true);
  });

  test('事件工厂：quick/review 的 card_generated 运行时拒绝', () => {
    expect(() => createJudgeEvent({ aluId: 'a', grade: 'fuzzy', fsrsApplied: true, at: BASE.toISOString() }))
      .toThrow(/D8/);
  });
});

describe('session: 硬规则3——复习失败自动拉起 90 秒补讲，补完重新入队（间隔按答错）', () => {
  test('review 档 wrong → remediation_start + 90s 子会话；补完 requeued', () => {
    const s = startSession({ sessionId: 's4', skill: 'review', aluIds: ['a-1'], params: { cardGeneration: false }, now: BASE, cards: { 'a-1': reviewCard() } });
    const out = judgeAnswer(s, { aluId: 'a-1', grade: 'wrong', latencyMs: 5000, now: BASE });
    expect(out.remediationStarted).toBe(true);
    expect(out.state.activeRemediation?.aluId).toBe('a-1');
    expect(new Date(out.state.activeRemediation!.deadline).getTime() - BASE.getTime()).toBe(REMEDIATION_DURATION_MS);
    expect(out.events.some((e) => e.type === 'remediation_start')).toBe(true);
    // 间隔按答错处理：Relearning、lapse、短 due
    expect(out.state.cards['a-1'].state).toBe(State.Relearning);
    expect(out.state.cards['a-1'].lapses).toBe(1);

    const done = completeRemediation(out.state, 'a-1');
    expect(done.activeRemediation).toBeNull();
    expect(done.completedRemediations).toEqual([{ aluId: 'a-1', requeued: true }]);
    expect(done.events.some((e) => e.type === 'remediation_done' && e.requeued)).toBe(true);
  });

  test('同卡重复 wrong 不重复拉起补讲', () => {
    const s = startSession({ sessionId: 's5', skill: 'review', aluIds: ['a-1'], params: { cardGeneration: false }, now: BASE, cards: { 'a-1': reviewCard() } });
    const first = judgeAnswer(s, { aluId: 'a-1', grade: 'wrong', latencyMs: 5000, now: BASE });
    const second = judgeAnswer(first.state, { aluId: 'a-1', grade: 'wrong', latencyMs: 5000, now: day(0.5) });
    expect(second.remediationStarted).toBe(false);
  });
});

describe('session: fuzzy 处置（D8）', () => {
  test('fuzzy 不写 FSRS、不拉补讲、本轮稍后重现、不产生新欠账', () => {
    const s0 = startSession({ sessionId: 's6', skill: 'review', aluIds: ['a-1'], params: { cardGeneration: false }, now: BASE, cards: { 'a-1': reviewCard() } });
    const before = s0.cards['a-1'];
    const out = judgeAnswer(s0, { aluId: 'a-1', grade: 'fuzzy', latencyMs: 3000, now: BASE });
    expect(out.fsrsApplied).toBe(false);
    expect(out.remediationStarted).toBe(false);
    expect(out.state.cards['a-1']).toBe(before); // FSRS 卡未动
    expect(out.state.fuzzyRequeue).toEqual(['a-1']);
    expect(popFuzzyRequeue(out.state)).toBe('a-1'); // 稍后重现
    // judge 事件：fuzzy 恒 fsrsApplied=false
    const judgeEv = out.events.find((e) => e.type === 'judge');
    expect(judgeEv && judgeEv.type === 'judge' && judgeEv.fsrsApplied).toBe(false);
  });

  test('fuzzy→correct：struggleWin=true（高价值正反馈）且不再重现', () => {
    const s0 = startSession({ sessionId: 's7', skill: 'review', aluIds: ['a-1'], params: { cardGeneration: false }, now: BASE, cards: { 'a-1': newCardForQueue(BASE) } });
    const fuzzy = judgeAnswer(s0, { aluId: 'a-1', grade: 'fuzzy', latencyMs: 3000, now: BASE });
    const win = judgeAnswer(fuzzy.state, { aluId: 'a-1', grade: 'correct', latencyMs: 2000, now: BASE });
    expect(win.record.struggleWin).toBe(true);
    expect(win.state.fuzzyRequeue).toEqual([]);
  });
});

describe('session: 撤销窗口与派生信号', () => {
  test('revokeAnswer：记录标 revoked、FSRS 卡回滚', () => {
    const card = reviewCard();
    const s0 = startSession({ sessionId: 's8', skill: 'review', aluIds: ['a-1'], params: { cardGeneration: false }, now: BASE, cards: { 'a-1': card } });
    const judged = judgeAnswer(s0, { aluId: 'a-1', grade: 'wrong', latencyMs: 1000, now: BASE });
    const revoked = revokeAnswer(judged.state, 'a-1');
    expect(revoked.record?.revoked).toBe(true);
    expect(revoked.state.cards['a-1']).toBe(card); // 回滚到判定前
    expect(revoked.state.records.some((r) => r.revoked)).toBe(true);
  });

  test('"比上次错得少"：同卡 wrong→correct 为 true', () => {
    const records = [
      { aluId: 'a', grade: 'wrong' as const, latencyMs: 1, skill: 'review' as const, at: '' },
      { aluId: 'a', grade: 'correct' as const, latencyMs: 1, skill: 'review' as const, at: '' },
    ];
    expect(improvedSinceLastWrong(records, 'a')).toBe(true);
    expect(improvedSinceLastWrong(records.slice(0, 1), 'a')).toBe(false);
  });
});
