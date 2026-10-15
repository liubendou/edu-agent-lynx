// M2-int 跨模块集成测试（T5）：经 src/composition.ts 一处装配的完整 Orchestrator，
// 走通"storage 空库 → 灌种子 → TodayDecision → activator 确定性激活（零模型调用）→
// 会话循环（mock cloud 流）→ 三档判定 + FSRS（fuzzy 不写 review_log，D8）→ 回合边界
// 落盘 → 重新 loadSnapshot 状态一致 → 回 [TodayDecision]"端到端域层链路。
// 只加本文件，不改既有测试。mock 云 = MockCloudClient 确定性四档流 + 少量补齐行
// （teach/variant 的 FeedbackBar、wrap_up 的 SessionEndCard+签名组件），使 validator 全绿、
// 升级通道零触发，装配断言不被纠偏噪声掩盖。
import { describe, expect, test } from '@rstest/core';
import { State, type Card } from 'ts-fsrs';
import { createAlu, type Alu, type AluUserState } from '../domain/alu';
import type { SessionEvent } from '../domain/events';
import { createEmptyProfile, type LearnerProfile } from '../domain/profile';
import { createMemoryKVStore, type KVStore } from '../storage/kv';
import { Repositories } from '../storage/repos';
import { SESSION_EVENTS_KEY } from '../storage/repos/collections';
import { RepositoriesStoragePort, createAppMachine, type AppMachine } from '../composition';
import { MockCloudClient } from '../cloud/mock';
import type {
  CloudLikeClient,
  CloudStreamResult,
  CompleteTextParams,
  CompleteTextResult,
  StreamChatParams,
} from '../cloud/client';

const BASE = new Date('2026-10-15T08:00:00.000Z');
const day = (n: number) => new Date(BASE.getTime() + n * 86_400_000);

// ── 种子工厂（与 orchestrator.test.ts 同构；测试内构造）──────────────

function makeAlu(id: string, moduleId = 'm1'): Alu {
  return createAlu({
    id, subjectId: 'psy', moduleId, kind: 'concept',
    front: `${id} 正题？`, back: `${id} 背面`,
    difficulty: 2,
    source: { docId: 'doc-1', docTitle: '样例', locator: { kind: 'span', start: 0, end: 10 }, text: '原句' },
  });
}

/** 到期复习卡（同 elapsed 不同 stability → R 升序可比：低 stability 先出）。 */
function dueCard(stability: number): Card {
  return {
    due: day(-1), stability, difficulty: 5, elapsed_days: 20, scheduled_days: 20,
    learning_steps: 0, reps: 6, lapses: 0, state: State.Review, last_review: day(-21),
  };
}

function stateOf(aluId: string, card: Card): AluUserState {
  return {
    aluId, status: 'learned_once', fromMode: 'standard', fsrs: card, lastAnswers: [],
    createdAt: BASE.toISOString(), updatedAt: BASE.toISOString(),
  };
}

/** 非首启画像（含一条历史会话摘要，facts/欠账为空 → new_learn 决策）。 */
function profileWithHistory(): LearnerProfile {
  const profile = createEmptyProfile();
  profile.sessionSummaries = [{
    sessionId: 's-0', skill: 'standard-learning', at: '2026-10-10T08:00:00.000Z',
    whatHappened: '旧会话', stuckAt: [], nextSuggestion: '继续',
  }];
  return profile;
}

// ── mock cloud：MockCloudClient + validator 期望补齐 ────────────────

const WRAP_SIGNATURE: Record<string, string> = {
  'quick-learning': 'ConceptCard',
  review: 'FeedbackBar',
  'standard-learning': 'ExplainStep',
  'deep-learning': 'ExplainStep',
};

function surfaceLine(id: string, name: string): string {
  return JSON.stringify({ surfaceUpdate: { surfaceId: 'main', components: [{ id, name, props: {} }] } });
}

/**
 * 确定性 mock 云流（委托 MockCloudClient 四档典型流）+ 两处补齐：
 *  - aluIds 非空回合补 FeedbackBar（mock 四段式/变式流无判定条，teach/variant 期望组需要）；
 *  - aluIds 为空（wrap_up）补 SessionEndCard + 档位签名组件（validator 先查签名再查收尾卡）。
 * 补齐后全回合 validator 一次通过：零纠偏、零 pro 升级（proCalls 恒 0 可断言）。
 */
class PatchedMockCloud implements CloudLikeClient {
  constructor(readonly inner: MockCloudClient) {}

  async streamChat(params: StreamChatParams): Promise<CloudStreamResult> {
    const result = await this.inner.streamChat(params);
    const ti = params.segments.taskInstruction;
    const extras = ti.aluIds.length === 0
      ? [
          surfaceLine('mock-session-end', 'SessionEndCard'),
          surfaceLine('mock-wrap-sig', WRAP_SIGNATURE[ti.mode] ?? 'ExplainStep'),
        ]
      : [surfaceLine('mock-feedback', 'FeedbackBar')];
    for (const line of extras) params.callbacks?.onTextDelta?.(line);
    return { ...result, a2uiLines: [...result.a2uiLines, ...extras] };
  }

  completeText(params: CompleteTextParams): Promise<CompleteTextResult> {
    return this.inner.completeText(params);
  }

  get streamCalls(): number {
    return this.inner.calls.filter((c) => c.kind === 'streamChat').length;
  }

  get proCalls(): number {
    return this.inner.calls.filter((c) => c.kind === 'completeText').length;
  }
}

async function makeMachine(): Promise<{ kv: KVStore; cloud: PatchedMockCloud; machine: AppMachine }> {
  const kv = createMemoryKVStore();
  const cloud = new PatchedMockCloud(new MockCloudClient());
  const machine = await createAppMachine({ kv, cloud, now: () => BASE });
  return { kv, cloud, machine };
}

async function readSessionEvents(kv: KVStore): Promise<SessionEvent[]> {
  const raw = await kv.get(SESSION_EVENTS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as SessionEvent[]);
}

// ── 端到端主链路（任务书规格全步骤）────────────────────────────────

describe('M2-int 集成：composition root 全装配端到端', () => {
  test('主链路：空库首启 → 种子复习决策 → 确定性激活零模型调用 → 会话（fuzzy/correct/wrong+补讲）→ D8 落盘 → 重载一致回环', async () => {
    const { kv, cloud, machine } = await makeMachine();
    const { orchestrator, repos, emitter } = machine;

    // ① storage 空库初始化：first_run 决策 → quick 档确定性激活，全程零模型调用
    const first = await orchestrator.boot(BASE);
    expect(first.decision.kind).toBe('first_run');
    expect(first.isFirstRun).toBe(true);
    expect(first.activation.skill).toBe('quick-learning');
    expect(first.activation.source).toBe('deterministic');
    expect(cloud.streamCalls).toBe(0);
    expect(cloud.proCalls).toBe(0);

    // ② 灌种子：两张到期复习卡（R 升序 r-low → r-high）+ 一张未见卡
    await repos.saveAll({
      alu: { 'r-low': makeAlu('r-low'), 'r-high': makeAlu('r-high'), fresh: makeAlu('fresh') },
      alu_state: {
        'r-low': stateOf('r-low', dueCard(5)),
        'r-high': stateOf('r-high', dueCard(20)),
      },
    });

    // ③ TodayDecision（D10：到期复习优先）+ activator 确定性激活（仍零模型调用）
    const boot = await orchestrator.boot(BASE);
    expect(boot.decision.kind).toBe('review');
    if (boot.decision.kind !== 'review') throw new Error('unreachable');
    expect(boot.decision.batch.map((q) => q.aluId)).toEqual(['r-low', 'r-high']);
    expect(boot.activation.skill).toBe('review');
    expect(boot.activation.source).toBe('deterministic');
    expect(boot.activation.aluIds).toEqual(['r-low', 'r-high']);
    expect(boot.boundedLine).toBe('再 2 张清完今天');
    expect(cloud.streamCalls).toBe(0);
    expect(cloud.proCalls).toBe(0);

    // ④ 会话循环（mock cloud 流，validator 全绿零纠偏）
    orchestrator.openSession(BASE);
    const t1 = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(t1.ok).toBe(true);
    expect(t1.attempts).toBe(1);
    expect(t1.phase).toBe('present');
    expect(t1.components.some((c) => c.name === 'RevealCard')).toBe(true);
    expect(t1.components.some((c) => c.name === 'FeedbackBar')).toBe(true);
    expect(t1.directives[0].includes('会话有界：再 2 张清完今天')).toBe(true);

    // 判定一：fuzzy（D8：不写 FSRS、不拉补讲、本轮稍后重现）
    const t2 = await orchestrator.runTurn({ kind: 'answer', aluId: 'r-low', grade: 'fuzzy', latencyMs: 9_000 }, BASE);
    expect(t2.judged?.fsrsApplied).toBe(false);
    expect(t2.remediationStarted).toBe(false);
    expect(t2.directives.some((d) => d.includes('再讲一遍'))).toBe(true);
    expect(t2.phase).toBe('present'); // fuzzy 重现：仍指向 r-low

    // 判定二：correct（fuzzy→correct：struggleWin；FSRS 写入；推进下一张）
    const t3 = await orchestrator.runTurn({ kind: 'answer', aluId: 'r-low', grade: 'correct', latencyMs: 30_000 }, BASE);
    expect(t3.judged?.fsrsApplied).toBe(true);
    expect(t3.phase).toBe('present'); // r-high

    // 判定三：wrong（硬规则3：FSRS Again + 自动拉起 90 秒补讲子会话）
    const t4 = await orchestrator.runTurn({ kind: 'answer', aluId: 'r-high', grade: 'wrong', latencyMs: 8_000 }, BASE);
    expect(t4.judged?.fsrsApplied).toBe(true);
    expect(t4.remediationStarted).toBe(true);
    expect(t4.phase).toBe('remediation');
    expect(t4.directives.some((d) => d.includes('复习失败自动补讲'))).toBe(true);

    // 补讲期作答：不写 FSRS（间隔按答错处理——wrong 时 Again 已落）
    const t5 = await orchestrator.runTurn({ kind: 'answer', aluId: 'r-high', grade: 'correct', latencyMs: 15_000 }, BASE);
    expect(t5.judged?.fsrsApplied).toBe(false);
    expect(t5.phase).toBe('remediation');

    // 补讲完成：重新入队回主流程；批次已尽 → wrap_up（mock 补齐收尾卡）
    const t6 = await orchestrator.runTurn({ kind: 'remediation_done' }, BASE);
    expect(t6.phase).toBe('wrap_up');
    expect(t6.ok).toBe(true);
    expect(t6.components.some((c) => c.name === 'SessionEndCard')).toBe(true);

    // 零纠偏零升级：6 回合 6 次 flash 流、0 次 pro
    expect(cloud.streamCalls).toBe(6);
    expect(cloud.proCalls).toBe(0);
    // A2UI 渐进下发：每回合一批、批内全为 surfaceUpdate 行（机器级行不存在）
    expect(emitter.batches.length).toBe(6);
    expect(emitter.batches.every((b) => b.length > 0 && b.every((l) => l.includes('surfaceUpdate')))).toBe(true);

    // ⑤ 回合边界落盘（会话结束触发 idle_90s）
    const end = await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(end?.trigger).toBe('idle_90s');
    expect(end?.persisted.reviewLogAppend.map((r) => r.grade)).toEqual(['correct', 'wrong', 'correct']);

    // D8：review_log 仅 correct/wrong，fuzzy 不落盘；fuzzy→correct 记 struggleWin
    const log = await repos.listReviewLog();
    expect(log.length).toBe(3);
    expect(log.every((r) => r.grade !== 'fuzzy')).toBe(true);
    expect(log[0].struggleWin).toBe(true);

    // ⑥ 重新 loadSnapshot（新 Repositories 同一 KV）状态一致
    const reloaded = new RepositoriesStoragePort(new Repositories(kv));
    const snap = await reloaded.loadSnapshot();
    expect(Object.keys(snap.alus).sort()).toEqual(['fresh', 'r-high', 'r-low']);
    const low = snap.aluStates['r-low'];
    expect(low.fsrs.reps).toBe(7); // 6 → fuzzy 不写 → correct 写一次
    expect(low.fsrs.state).toBe(State.Review);
    expect(low.fsrs.due.getTime()).toBeGreaterThan(BASE.getTime());
    expect(low.lastAnswers.map((r) => r.grade)).toEqual(['fuzzy', 'correct']); // fuzzy 会话内留存
    const high = snap.aluStates['r-high'];
    expect(high.fsrs.state).toBe(State.Relearning); // Again → Relearning
    expect(high.fsrs.lapses).toBe(1);
    expect(high.fsrs.reps).toBe(7); // 补讲 correct 不再写（间隔按答错处理）
    expect(high.lastAnswers.map((r) => r.grade)).toEqual(['wrong', 'correct']);
    expect(snap.profile?.sessionSummaries.length).toBe(1);
    expect(snap.profile?.sessionSummaries[0].skill).toBe('review');
    // 事件流水落 session_events 集合（埋点同源）
    const events = await readSessionEvents(kv);
    const types = events.map((e) => e.type);
    expect(types).toContain('session_start');
    expect(types).toContain('judge');
    expect(events.some((e) => e.type === 'judge' && e.grade === 'fuzzy' && !e.fsrsApplied)).toBe(true);
    expect(types).toContain('remediation_start');
    expect(types).toContain('remediation_done');
    expect(types).toContain('session_end');

    // ⑦ 回 [TodayDecision]：新机器冷启动按持久化状态再决策（无欠账 → 新学建议 fresh）
    const second = await createAppMachine({ kv, cloud, now: () => BASE });
    const reboot = await second.orchestrator.boot(BASE);
    expect(reboot.isFirstRun).toBe(false);
    expect(reboot.decision.kind).toBe('new_learn');
    if (reboot.decision.kind !== 'new_learn') throw new Error('unreachable');
    expect(reboot.decision.suggestion.aluId).toBe('fresh');
    expect(cloud.streamCalls).toBe(6); // 决策与激活依旧零模型调用
  });

  test('新学链路：new_learn → standard 讲解回合 → 答对自动出卡（硬规则2，due=T+1）→ 批次尽自然收尾', async () => {
    const { cloud, machine } = await makeMachine();
    const { orchestrator, repos } = machine;
    await repos.saveAll({
      alu: { n1: makeAlu('n1'), n2: makeAlu('n2') },
      alu_state: {},
      profile: profileWithHistory(),
    });

    const boot = await orchestrator.boot(BASE);
    expect(boot.decision.kind).toBe('new_learn');
    if (boot.decision.kind !== 'new_learn') throw new Error('unreachable');
    expect(boot.decision.suggestion.aluId).toBe('n1');
    expect(boot.activation.skill).toBe('standard-learning');
    expect(boot.activation.params.cardGeneration).toBe(true);

    orchestrator.openSession(BASE);
    const t1 = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(t1.ok).toBe(true);
    expect(t1.phase).toBe('teach');
    expect(t1.components.some((c) => c.name === 'ExplainStep')).toBe(true);

    // 讲完自检答对 → 硬规则2 自动出卡（quick/review 拒绝，standard 直通）；
    // 批次仅 1 张（new_learn 单卡建议），答对推进到队尾 → 本回合即自然收尾
    const t2 = await orchestrator.runTurn({ kind: 'answer', aluId: 'n1', grade: 'correct', latencyMs: 20_000 }, BASE);
    expect(t2.judged?.fsrsApplied).toBe(false); // standard 插问不写 FSRS
    expect(t2.directives.some((d) => d.includes('已出卡：讲完并自检过'))).toBe(true);
    expect(t2.phase).toBe('wrap_up');
    expect(t2.components.some((c) => c.name === 'SessionEndCard')).toBe(true);

    // goodbye 触发结束分析；峰值收尾卡已在自然收尾回合给过，不重复产出
    const end = await orchestrator.notifySessionEnd({ saidGoodbye: true }, BASE);
    expect(end?.trigger).toBe('goodbye');
    expect(end?.wrapUp).toBe(null);
    expect(cloud.proCalls).toBe(0);

    // 出卡落盘：n1 入队 due=T+1（New 态），card_generated 事件含出处 chunk id
    const states = await repos.listAluStates();
    expect(states.n1?.fsrs.state).toBe(State.New);
    expect(states.n1?.fsrs.due.getTime()).toBe(day(1).getTime());
    const events = await readSessionEvents(machine.repos.kv);
    const cardEvents = events.filter((e) => e.type === 'card_generated');
    expect(cardEvents.length).toBe(1);
    expect(cardEvents[0].sourceChunkId).toBe('doc-1#span-0-10');
  });

  test('点名链路：activateByMention 直连 quick 档（零模型调用）→ 硬规则1 禁卡不产生欠账', async () => {
    const { cloud, machine } = await makeMachine();
    const { orchestrator, repos } = machine;
    await repos.saveAll({
      alu: { fresh: makeAlu('fresh') },
      alu_state: {},
      profile: profileWithHistory(),
    });

    // 点名直连：确定性路由，不经模型
    const hit = await orchestrator.activateByMention('快速过一遍', BASE);
    expect(hit?.skill).toBe('quick-learning');
    expect(hit?.source).toBe('named');
    expect(hit?.aluIds).toEqual(['fresh']);
    expect(cloud.streamCalls).toBe(0);

    const session = orchestrator.openSession(BASE);
    expect(session.skill).toBe('quick-learning');
    expect(session.params.cardGeneration).toBe(false); // 硬规则1：domain 层双保险

    const t1 = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(t1.ok).toBe(true);
    expect(t1.phase).toBe('teach'); // quick 地图构建走 teach 期望组
    expect(t1.components.some((c) => c.name === 'MapView')).toBe(true);

    expect(() => orchestrator.requestCardGeneration(['fresh'], BASE)).toThrow(/硬规则1/);
    const t2 = await orchestrator.runTurn({ kind: 'answer', aluId: 'fresh', grade: 'correct', latencyMs: 6_000 }, BASE);
    expect(t2.judged?.fsrsApplied).toBe(false); // quick 不写 FSRS
    expect(t2.directives.some((d) => d.includes('已出卡'))).toBe(false);

    const end = await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(end?.trigger).toBe('idle_90s');
    expect(cloud.proCalls).toBe(0);
    // 硬规则1：quick 不产生复习欠账（无新状态入队、无 card_generated 事件）
    expect(Object.keys(await repos.listAluStates())).toEqual([]);
    const events = await readSessionEvents(repos.kv);
    expect(events.some((e) => e.type === 'card_generated')).toBe(false);
    const log = await repos.listReviewLog();
    expect(log.map((r) => r.skill)).toEqual(['quick-learning']);
  });
});
