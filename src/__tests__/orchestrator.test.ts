// M2e 调度器测试：fake ports 驱动 Orchestrator 主状态机全路径（ARCHITECTURE §4）。
// 状态机全路径：首启分支/回访决策/会话循环/四触发结束；硬规则 1/2/3（含 fuzzy D8、
// 补讲重新入队）；确定性激活（零模型调用）；validator 纠偏与上限；difficulty 升降与
// 复习档节拍；会话有界话术；工具/TTS 分派；metrics 样本留存。
import { describe, expect, test } from '@rstest/core';
import { State, type Card } from 'ts-fsrs';
import { createAlu, type Alu, type AluUserState, type AnswerRecord } from '../domain/alu';
import type { SessionEvent } from '../domain/events';
import { createEmptyProfile } from '../domain/profile';
import type { EscalationResult, EscalationSignal, SkillName } from '../domain/types';
import { Orchestrator, type Observation } from '../orchestrator/machine';
import type {
  A2UiEmitterPort,
  CloudClientPort,
  CloudStreamCallbacks,
  CloudTurnRequest,
  EscalationRequest,
  OrchestratorPorts,
  SkillManifestPort,
  SkillRuntimePort,
  StorageCommitPatch,
  StoragePort,
  StorageSnapshot,
  ToolInvokerPort,
} from '../orchestrator/ports';
import { createMetricsStore } from '../orchestrator/metrics';

const BASE = new Date('2026-10-15T08:00:00.000Z');
const day = (n: number) => new Date(BASE.getTime() + n * 86_400_000);
const at = (ms: number) => new Date(BASE.getTime() + ms);

// ── 测试数据工厂 ─────────────────────────────────────────────────

function makeAlu(id: string, prereq: string[] = [], moduleId = 'm1'): Alu {
  return createAlu({
    id, subjectId: 'psy', moduleId, kind: 'concept',
    front: `${id} 正题？`, back: `${id} 背面`,
    prereq, difficulty: 2,
    source: { docId: 'doc-1', docTitle: '样例', locator: { kind: 'span', start: 0, end: 10 }, text: '原句' },
  });
}

/** 到期复习卡：同 elapsed 不同 stability → R 可比（低 stability → 低 R）。 */
function dueCard(stability: number): Card {
  return {
    due: day(-1), stability, difficulty: 5, elapsed_days: 20, scheduled_days: 20,
    learning_steps: 0, reps: 6, lapses: 0, state: State.Review, last_review: day(-21),
  };
}

function stateOf(aluId: string, card: Card, lastWrongToday = false): AluUserState {
  return {
    aluId, status: 'learned_once', fromMode: 'standard', fsrs: card,
    lastAnswers: lastWrongToday
      ? [{ aluId, grade: 'wrong' as const, latencyMs: 4000, skill: 'review' as const, at: BASE.toISOString() }]
      : [],
    createdAt: BASE.toISOString(), updatedAt: BASE.toISOString(),
  };
}

/** 两张到期卡（R 升序：r-low 先）+ 一张未见卡。 */
function reviewStorage(): StorageSnapshot {
  return {
    alus: { 'r-low': makeAlu('r-low'), 'r-high': makeAlu('r-high'), fresh: makeAlu('fresh') },
    aluStates: { 'r-low': stateOf('r-low', dueCard(5)), 'r-high': stateOf('r-high', dueCard(20)) },
    profile: null,
  };
}

/** 有历史会话记录（非首启）、无欠账、两张未见卡。 */
function newLearnStorage(): StorageSnapshot {
  const profile = createEmptyProfile();
  profile.sessionSummaries = [{
    sessionId: 's-0', skill: 'standard-learning', at: '2026-10-10T08:00:00.000Z',
    whatHappened: '旧会话', stuckAt: [], nextSuggestion: '继续',
  }];
  return { alus: { n1: makeAlu('n1'), n2: makeAlu('n2') }, aluStates: {}, profile };
}

// ── fake ports ───────────────────────────────────────────────────

const MANIFESTS: Record<SkillName | 'remediation', SkillManifestPort> = {
  'quick-learning': {
    name: 'quick-learning', description: '快速过一遍，建立认知地图', version: '1.0.0', mode: 'pattern',
    promptTemplate: 'quick 模板：ConceptCard/MapView 拼地图，上滑揭晓自检',
    components: ['ConceptCard', 'MapView', 'RevealCard'], params: { goal: 'map', cardGeneration: false }, tools: [],
  },
  review: {
    name: 'review', description: '复习到期卡，提取练习', version: '1.0.0', mode: 'pattern',
    promptTemplate: 'review 模板：出卡-判定-反馈',
    components: ['QuestionCard', 'FeedbackBar'], params: { cardGeneration: false }, tools: [],
  },
  'standard-learning': {
    name: 'standard-learning', description: '标准档：讲完即问', version: '1.0.0', mode: 'pattern',
    promptTemplate: 'standard 模板：讲解+自检+出卡',
    components: ['ExplainStep', 'QuestionCard', 'FeedbackBar'], params: { cardGeneration: true }, tools: [],
  },
  'deep-learning': {
    name: 'deep-learning', description: '深挖吃透，费曼式', version: '1.0.0', mode: 'pattern',
    promptTemplate: 'deep 模板：深挖+变式',
    components: ['ExplainStep', 'QuestionCard', 'ProgressRing'], params: { cardGeneration: true }, tools: [],
  },
  // 'remediation' 不是档位：90 秒补讲用 standard 档技能包（F7）
  remediation: {
    name: 'standard-learning', description: '90 秒补讲', version: '1.0.0', mode: 'pattern',
    promptTemplate: '补讲模板：把卡讲透再回主流程',
    components: ['ExplainStep'], params: { cardGeneration: false }, tools: [],
  },
};

function fakeSkills(): SkillRuntimePort {
  return {
    getActiveSkill: (mode) => MANIFESTS[mode],
    getBody: (name) => MANIFESTS[name as SkillName],
    listSummaries: () => Object.values(MANIFESTS).map((m) => ({ name: m.name, description: m.description })),
  };
}

function surface(names: string[]): string {
  return JSON.stringify({
    surfaceUpdate: { components: names.map((n, i) => ({ id: `c-${String(i)}`, name: n })) },
  });
}

/** wrap_up 也要命中档位签名组件（validator 先查签名再查 SessionEndCard）。 */
const WRAP_SIG: Record<string, string> = {
  'quick-learning': 'ConceptCard',
  review: 'FeedbackBar',
  'standard-learning': 'ExplainStep',
  'deep-learning': 'ExplainStep',
  remediation: 'ExplainStep',
};

/** 默认应答脚本：按 mode/aluIds 路由产出可通过 validator 的 JSONL。 */
function defaultScript(request: CloudTurnRequest): string[] {
  if (request.taskInstruction.aluIds.length === 0) {
    return [surface(['SessionEndCard', WRAP_SIG[request.mode] ?? 'ExplainStep'])];
  }
  if (request.mode === 'review') return [surface(['QuestionCard', 'FeedbackBar'])];
  if (request.mode === 'quick-learning') return [surface(['ConceptCard', 'RevealCard', 'FeedbackBar'])];
  if (request.mode === 'remediation') return [surface(['ExplainStep'])];
  return [surface(['ExplainStep', 'QuestionCard', 'FeedbackBar'])];
}

type ScriptFn = (request: CloudTurnRequest, callIndex: number) => string[];

class FakeCloud implements CloudClientPort {
  requests: CloudTurnRequest[] = [];
  escalateCalls: { request: EscalationRequest; signal: EscalationSignal }[] = [];
  script: ScriptFn;
  constructor(script: ScriptFn = defaultScript) {
    this.script = script;
  }
  stream(request: CloudTurnRequest, callbacks: CloudStreamCallbacks): void {
    this.requests.push(request);
    for (const line of this.script(request, this.requests.length - 1)) callbacks.onChunk(line);
    callbacks.onDone({ usage: { promptTokens: 100, completionTokens: 50, cacheHit: true }, modelUsed: 'flash' });
  }
  async escalate(request: EscalationRequest, signal: EscalationSignal): Promise<EscalationResult> {
    this.escalateCalls.push({ request, signal });
    return { nextStep: '按技能模板结构重写本回合输出', loggedToFacts: true };
  }
}

class FakeTools implements ToolInvokerPort {
  calls: { name: string; args: unknown }[] = [];
  handlers: Record<string, (args: unknown) => unknown> = {
    tts_speak: () => undefined,
    search: () => ({ snippet: '搜索结果摘要' }),
  };
  async callTool(name: string, args: unknown): Promise<unknown> {
    this.calls.push({ name, args });
    const handler = this.handlers[name];
    if (!handler) throw new Error(`no tool: ${name}`);
    return handler(args);
  }
}

class FakeStorage implements StoragePort {
  commits: StorageCommitPatch[] = [];
  reviewLog: AnswerRecord[] = [];
  events: SessionEvent[] = [];
  constructor(public data: StorageSnapshot) {}
  async loadSnapshot(): Promise<StorageSnapshot> {
    return {
      alus: { ...this.data.alus },
      aluStates: { ...this.data.aluStates },
      profile: this.data.profile === null ? null : { ...this.data.profile },
    };
  }
  async commit(patch: StorageCommitPatch): Promise<void> {
    this.commits.push(patch);
    if (patch.aluStates !== undefined) this.data.aluStates = patch.aluStates;
    if (patch.profile !== undefined) this.data.profile = patch.profile;
    if (patch.reviewLogAppend !== undefined) this.reviewLog.push(...patch.reviewLogAppend);
    if (patch.events !== undefined) this.events.push(...patch.events);
  }
}

function makeOrch(data: StorageSnapshot, script?: ScriptFn) {
  const cloud = new FakeCloud(script);
  const emitter: A2UiEmitterPort & { emitted: string[]; flushes: number } = {
    emitted: [],
    flushes: 0,
    emit(chunk) { this.emitted.push(chunk); },
    flush() { this.flushes += 1; },
  };
  const tools = new FakeTools();
  const storage = new FakeStorage(data);
  const ports: OrchestratorPorts = { skills: fakeSkills(), cloud, emitter, tools, storage };
  const orchestrator = new Orchestrator(ports, { now: () => BASE });
  return { orchestrator, cloud, emitter, tools, storage };
}

const lastRequest = (cloud: FakeCloud) => cloud.requests[cloud.requests.length - 1];

// ── [AppStart]→[TodayDecision]→[SkillActivation]：端侧确定性，零模型调用 ──

describe('boot：首启判定 + 今日决策 + 确定性激活', () => {
  test('首启分支：空库 → first_run → quick 档（硬规则1 强制禁卡），全程零云调用', async () => {
    const { orchestrator, cloud } = makeOrch({ alus: {}, aluStates: {}, profile: null });
    const boot = await orchestrator.boot(BASE);
    expect(boot.decision.kind).toBe('first_run');
    expect(boot.isFirstRun).toBe(true);
    expect(boot.activation.skill).toBe('quick-learning');
    expect(boot.activation.params.cardGeneration).toBe(false);
    expect(boot.activation.source).toBe('deterministic');
    expect(boot.boundedLine).toBe('地图骨架就绪，明天再来拼下一块');
    expect(cloud.requests.length).toBe(0); // 确定性激活：不经模型
    expect(cloud.escalateCalls.length).toBe(0);
    const session = orchestrator.openSession(BASE);
    expect(session.params.cardGeneration).toBe(false); // domain 层双保险
    expect(cloud.requests.length).toBe(0); // 开表同样零模型调用
  });

  test('回访复习决策：到期卡 R 升序进批次，埋点记 hit', async () => {
    const { orchestrator, cloud } = makeOrch(reviewStorage());
    const boot = await orchestrator.boot(BASE);
    expect(boot.decision.kind).toBe('review');
    if (boot.decision.kind !== 'review') throw new Error('unreachable');
    expect(boot.decision.batch.map((q) => q.aluId)).toEqual(['r-low', 'r-high']); // R 升序
    expect(boot.activation.skill).toBe('review');
    expect(boot.activation.aluIds).toEqual(['r-low', 'r-high']);
    expect(boot.boundedLine).toBe('再 2 张清完今天');
    expect(cloud.requests.length).toBe(0);
    const samples = orchestrator.metrics.activationSamples();
    expect(samples.some((s) => s.scenario === 'decision:review' && s.outcome === 'hit' && s.source === 'deterministic')).toBe(true);
  });

  test('当日补讲决策：今天答错未补 → standard 档 90 秒补讲参数', async () => {
    const data: StorageSnapshot = {
      alus: { x1: makeAlu('x1') },
      aluStates: { x1: stateOf('x1', { ...dueCard(20), due: day(1) }, true) }, // 未到期但今天答错
      profile: null,
    };
    const { orchestrator } = makeOrch(data);
    const boot = await orchestrator.boot(BASE);
    expect(boot.decision.kind).toBe('remediation');
    expect(boot.activation.skill).toBe('standard-learning');
    expect(boot.activation.mode).toBe('remediation');
    expect(boot.activation.params.cardGeneration).toBe(false);
    expect(boot.activation.params.budgetMinutes).toEqual([1, 2]);
  });

  test('新学决策：无欠账有记录 → new_learn → standard 档可出卡', async () => {
    const { orchestrator } = makeOrch(newLearnStorage());
    const boot = await orchestrator.boot(BASE);
    expect(boot.decision.kind).toBe('new_learn');
    if (boot.decision.kind !== 'new_learn') throw new Error('unreachable');
    expect(boot.decision.suggestion.aluId).toBe('n1');
    expect(boot.isFirstRun).toBe(false);
    expect(boot.activation.skill).toBe('standard-learning');
    expect(boot.activation.params.cardGeneration).toBe(true);
    expect(boot.activation.aluIds).toEqual(['n1']);
  });
});

describe('点名直连（§7.8②③：确定性路由，不经模型）', () => {
  test('复习点名接今日到期批次；深挖接新学候选；无命中返回 null 不硬凑；会话中点名不换档', async () => {
    const { orchestrator, cloud } = makeOrch(reviewStorage());
    const review = await orchestrator.activateByMention('帮我复习一下', BASE);
    expect(review?.skill).toBe('review');
    expect(review?.source).toBe('named');
    expect(review?.aluIds).toEqual(['r-low', 'r-high']);
    expect(cloud.requests.length).toBe(0); // 点名直连同样零模型调用

    const deep = await orchestrator.activateByMention('深挖一下这块', BASE);
    expect(deep?.skill).toBe('deep-learning');
    expect(deep?.aluIds).toEqual(['fresh']); // 新学候选

    expect(await orchestrator.activateByMention('随便聊聊', BASE)).toBe(null); // 不硬凑

    orchestrator.openSession(BASE);
    expect(await orchestrator.activateByMention('再复习一下', BASE)).toBe(null); // 会话中点名不直连
  });
});

// ── [SessionLoop] 会话循环 ───────────────────────────────────────

describe('会话循环：有界话术 / 批次推进 / action 分派', () => {
  test('复习档：开场注入"再 N 张清完今天"，答对推进下一张且写 FSRS', async () => {
    const { orchestrator, cloud, emitter } = makeOrch(reviewStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    const open = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(open.ok).toBe(true);
    expect(open.phase).toBe('present');
    expect(open.components.some((c) => c.name === 'QuestionCard')).toBe(true);
    expect(open.directives[0].includes('会话有界：再 2 张清完今天')).toBe(true);
    expect(lastRequest(cloud).taskInstruction.aluIds).toEqual(['r-low']);
    expect(emitter.emitted.length).toBeGreaterThan(0); // A2UI 行渐进下发
    expect(emitter.emitted.every((c) => c.includes('surfaceUpdate'))).toBe(true); // 机器级行不下发 UI

    const answered = await orchestrator.runTurn(
      { kind: 'answer', aluId: 'r-low', grade: 'correct', latencyMs: 30_000 }, BASE,
    );
    expect(answered.judged?.fsrsApplied).toBe(true); // review 档写 FSRS
    expect(lastRequest(cloud).taskInstruction.aluIds).toEqual(['r-high']); // 推进下一张
  });

  test('工具与 TTS 分派：tts_speak/search 被调用，工具结果进入下一回合 ⑧ 段', async () => {
    const script: ScriptFn = (request) => {
      if (request.taskInstruction.aluIds.length === 0) return [surface(['SessionEndCard', 'ExplainStep'])];
      return [
        surface(['ExplainStep', 'QuestionCard', 'FeedbackBar']),
        JSON.stringify({ tts: { text: '我们开始讲这个概念' } }),
        JSON.stringify({ tool_call: { name: 'search', args: { q: '正强化' } } }),
      ];
    };
    const { orchestrator, cloud, tools, emitter } = makeOrch(newLearnStorage(), script);
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    const turn = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(turn.ok).toBe(true);
    expect(tools.calls.map((c) => c.name)).toEqual(['tts_speak', 'search']);
    expect(emitter.emitted.every((c) => c.includes('surfaceUpdate'))).toBe(true); // tts 行不下发 UI

    await orchestrator.runTurn({ kind: 'advance' }, BASE);
    const retrieved = lastRequest(cloud).retrieved; // ⑧ 段：上一回合工具结果 just-in-time 进请求
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].kind).toBe('search_digest');
    expect(retrieved[0].digest.includes('搜索结果摘要')).toBe(true);
  });

  test('工具连续失败 ≥2 次 → tool_failures 升级信号，回合不中断', async () => {
    const script: ScriptFn = (request) => {
      const lines = defaultScript(request);
      if (request.taskInstruction.aluIds.length > 0) {
        lines.push(JSON.stringify({ tool_call: { name: 'search', args: {} } }));
      }
      return lines;
    };
    const { orchestrator, cloud, tools, storage } = makeOrch(newLearnStorage(), script);
    tools.handlers.search = () => { throw new Error('网络不可用'); };
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    const t1 = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(t1.ok).toBe(true); // 工具失败不阻塞主流程
    expect(cloud.escalateCalls.length).toBe(0);
    const t2 = await orchestrator.runTurn({ kind: 'advance' }, BASE);
    expect(t2.ok).toBe(true);
    expect(cloud.escalateCalls.length).toBe(1);
    expect(cloud.escalateCalls[0].signal.type).toBe('tool_failures');
    await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(storage.events.some((e) => e.type === 'skill_escalation' && e.signal.type === 'tool_failures')).toBe(true);
  });
});

// ── 难度调节（§10.1③/④）────────────────────────────────────────

describe('实时难度调节', () => {
  test('standard 卡住：down 事件 + 脚手架话术，不判错（无作答记录）', async () => {
    const { orchestrator, storage } = makeOrch(newLearnStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    const stuck = await orchestrator.runTurn({ kind: 'stuck' }, BASE);
    expect(stuck.directives.some((d) => d.includes('难度指令（down）'))).toBe(true);
    expect(stuck.directives.some((d) => d.includes('先把台阶垫低一点'))).toBe(true);
    const end = await orchestrator.notifySessionEnd({ saidGoodbye: true }, BASE);
    expect(end?.persisted.reviewLogAppend.length).toBe(0); // stuck 不判错：无作答
    expect(storage.events.some((e) => e.type === 'difficulty_adjust' && e.direction === 'down')).toBe(true);
  });

  test('review 卡住：只调节拍（pace_down）不发难度事件（§10.1④）', async () => {
    const { orchestrator, storage } = makeOrch(reviewStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    const stuck = await orchestrator.runTurn({ kind: 'stuck' }, BASE);
    expect(stuck.directives.some((d) => d.includes('难度指令（pace_down）'))).toBe(true);
    await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(storage.events.some((e) => e.type === 'difficulty_adjust')).toBe(false); // 复习档不调难度
  });

  test('deep 答得快又对：up 事件 + 变式复问同一 ALU，不双推进不双出卡', async () => {
    const { orchestrator, cloud, storage } = makeOrch(newLearnStorage());
    await orchestrator.activateByMention('深挖一下', BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    const fast = await orchestrator.runTurn({ kind: 'answer', aluId: 'n1', grade: 'correct', latencyMs: 5_000 }, BASE);
    expect(fast.directives.some((d) => d.includes('升难度给变式'))).toBe(true);
    expect(fast.judged?.fsrsApplied).toBe(false); // deep 自检不写 FSRS

    const variant = await orchestrator.runTurn({ kind: 'advance' }, BASE);
    expect(variant.phase).toBe('variant');
    expect(lastRequest(cloud).taskInstruction.aluIds).toEqual(['n1']); // 同一 ALU 换问法

    await orchestrator.runTurn({ kind: 'answer', aluId: 'n1', grade: 'correct', latencyMs: 8_000 }, BASE);
    const wrap = await orchestrator.runTurn({ kind: 'advance' }, BASE);
    expect(wrap.phase).toBe('wrap_up'); // 变式回合不二次推进，批次已尽收尾
    await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    const events = storage.events;
    expect(events.filter((e) => e.type === 'card_generated').length).toBe(1); // 变式回合不双出卡
    expect(events.some((e) => e.type === 'difficulty_adjust' && e.direction === 'up')).toBe(true);
  });
});

// ── validator 纠偏回路（§7.8③）───────────────────────────────────

describe('validator：后置校验 + 纠偏上限 + 升级信号', () => {
  test('缺自检/判定条 → 强制纠偏重发 → 通过；记 miss 样本（source=corrected）', async () => {
    const script: ScriptFn = (request, callIndex) => {
      if (request.taskInstruction.aluIds.length === 0) return [surface(['SessionEndCard', 'ExplainStep'])];
      return callIndex === 0
        ? [surface(['ExplainStep'])] // 首答缺自检、缺判定条
        : [surface(['ExplainStep', 'QuestionCard', 'FeedbackBar'])];
    };
    const { orchestrator, cloud } = makeOrch(newLearnStorage(), script);
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    const turn = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(turn.attempts).toBe(2);
    expect(turn.ok).toBe(true);
    expect(turn.issues.length).toBe(0);
    expect(cloud.requests[1].directives.some((d) => d.includes('强制要求'))).toBe(true);
    expect(orchestrator.metrics.activationSamples()
      .some((s) => s.source === 'corrected' && s.outcome === 'miss')).toBe(true);
  });

  test('纠偏超限 → 单次升级（output_deviation）→ 升级后仍不达标则放行（负例留存）', async () => {
    const script: ScriptFn = () => [surface(['ConceptCard'])]; // 恒不命中 standard 签名
    const { orchestrator, cloud, storage } = makeOrch(newLearnStorage(), script);
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    const turn = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(turn.attempts).toBe(4); // 初答 + 2 次纠偏 + 升级后再试
    expect(turn.escalated).toBe(true);
    expect(turn.ok).toBe(false);
    expect(turn.issues.some((i) => i.code === 'skill_not_used')).toBe(true);
    expect(cloud.escalateCalls.length).toBe(1); // 单次升级
    expect(cloud.escalateCalls[0].signal.type).toBe('output_deviation');
    expect(cloud.requests[3].directives.some((d) => d.includes('升级指导'))).toBe(true);
    await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(storage.events.some((e) => e.type === 'skill_escalation')).toBe(true);
  });
});

// ── 三条硬规则（代码强制，§7.9）──────────────────────────────────

describe('硬规则1：quick 档禁用卡片生成', () => {
  test('quick 会话 requestCardGeneration 抛错；答对后无 card_generated 事件', async () => {
    const { orchestrator, storage } = makeOrch({
      alus: { fresh: makeAlu('fresh') }, aluStates: {}, profile: null,
    });
    await orchestrator.activateByMention('快速过一遍', BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    await orchestrator.runTurn({ kind: 'answer', aluId: 'fresh', grade: 'correct', latencyMs: 6_000 }, BASE);
    expect(() => orchestrator.requestCardGeneration(['fresh'], BASE)).toThrow(/硬规则1/);
    await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(storage.events.some((e) => e.type === 'card_generated')).toBe(false);
  });
});

describe('硬规则2：card_generated 仅 standard/deep 可发', () => {
  test('standard 讲完自检答对 → 自动出卡入队（due=T+1）；review 会话直调抛错', async () => {
    const { orchestrator, storage } = makeOrch(newLearnStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    const turn = await orchestrator.runTurn({ kind: 'answer', aluId: 'n1', grade: 'correct', latencyMs: 20_000 }, BASE);
    expect(turn.directives.some((d) => d.includes('已出卡：讲完并自检过'))).toBe(true);
    await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    const committed = storage.commits[storage.commits.length - 1];
    const cardEvents = (committed.events ?? []).filter((e) => e.type === 'card_generated');
    expect(cardEvents.length).toBe(1);
    const enqueued = committed.aluStates?.n1;
    expect(enqueued?.fsrs.state).toBe(State.New);
    expect(enqueued?.fsrs.due.getTime()).toBe(day(1).getTime()); // 学过一轮入队 T+1

    const review = makeOrch(reviewStorage());
    await review.orchestrator.boot(BASE);
    review.orchestrator.openSession(BASE);
    expect(() => review.orchestrator.requestCardGeneration(['r-low'], BASE)).toThrow(/硬规则2/);
  });
});

describe('硬规则3：复习失败自动拉起 90 秒补讲，补完重新入队', () => {
  test('wrong → 补讲子会话（90 秒）；补讲期作答不写 FSRS、不推进主批次；补完 requeued 回主流程', async () => {
    const { orchestrator, cloud, storage } = makeOrch(reviewStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    const wrong = await orchestrator.runTurn({ kind: 'answer', aluId: 'r-low', grade: 'wrong', latencyMs: 8_000 }, BASE);
    expect(wrong.remediationStarted).toBe(true);
    expect(wrong.judged?.fsrsApplied).toBe(true); // wrong 本身按答错写 FSRS（Relearning）
    expect(wrong.directives.some((d) => d.includes('复习失败自动补讲'))).toBe(true);

    const sub = await orchestrator.runTurn({ kind: 'open' }, BASE); // 无新作答 → 补讲回合
    expect(sub.phase).toBe('remediation');
    expect(lastRequest(cloud).mode).toBe('remediation');
    expect(lastRequest(cloud).taskInstruction.aluIds).toEqual(['r-low']);

    const check = await orchestrator.runTurn({ kind: 'answer', aluId: 'r-low', grade: 'correct', latencyMs: 15_000 }, BASE);
    expect(check.judged?.fsrsApplied).toBe(false); // 补讲期不写 FSRS（间隔按答错处理）

    const done = await orchestrator.runTurn({ kind: 'remediation_done' }, BASE);
    expect(done.phase).toBe('present');
    expect(done.directives.some((d) => d.includes('已重新入队'))).toBe(true);
    expect(lastRequest(cloud).taskInstruction.aluIds).toEqual(['r-high']); // 主批次未被补讲自检吞掉

    await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(storage.events.filter((e) => e.type === 'remediation_done').every((e) => e.type === 'remediation_done' && e.requeued)).toBe(true);
    const card = storage.data.aluStates['r-low']?.fsrs;
    expect(card?.state).toBe(State.Relearning); // 间隔按答错处理
    expect(card?.lapses).toBe(1);
  });

  test('补讲 90 秒预算耗尽：同样按答错间隔重新入队，回主流程', async () => {
    const { orchestrator, cloud } = makeOrch(reviewStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    await orchestrator.runTurn({ kind: 'answer', aluId: 'r-low', grade: 'wrong', latencyMs: 8_000 }, BASE);
    const expired = await orchestrator.runTurn({ kind: 'advance' }, at(91_000));
    expect(expired.directives.some((d) => d.includes('补讲 90 秒预算耗尽'))).toBe(true);
    expect(expired.phase).toBe('present'); // 主批次在 wrong 判定时已推进 → 回到下一张
    expect(lastRequest(cloud).taskInstruction.aluIds).toEqual(['r-high']);
  });
});

describe('fuzzy 处置（D8：模糊不记账）', () => {
  test('fuzzy 不写 FSRS/不拉补讲/本轮稍后重现/再讲一遍指令；review_log 不含 fuzzy', async () => {
    const { orchestrator, cloud, storage } = makeOrch(reviewStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    const fuzzy = await orchestrator.runTurn({ kind: 'answer', aluId: 'r-low', grade: 'fuzzy', latencyMs: 9_000 }, BASE);
    expect(fuzzy.judged?.fsrsApplied).toBe(false);
    expect(fuzzy.remediationStarted).toBe(false);
    expect(fuzzy.directives.some((d) => d.includes('再讲一遍'))).toBe(true);

    const again = await orchestrator.runTurn({ kind: 'open' }, BASE);
    expect(again.phase).toBe('present');
    expect(lastRequest(cloud).taskInstruction.aluIds).toEqual(['r-low']); // 稍后重现，不推进

    const win = await orchestrator.runTurn({ kind: 'answer', aluId: 'r-low', grade: 'correct', latencyMs: 25_000 }, BASE);
    expect(win.judged?.fsrsApplied).toBe(true);
    await orchestrator.runTurn({ kind: 'answer', aluId: 'r-high', grade: 'correct', latencyMs: 25_000 }, BASE);

    await orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(storage.reviewLog.length).toBe(2); // fuzzy 不落 review_log
    expect(storage.reviewLog[0].struggleWin).toBe(true); // fuzzy→correct 高价值正反馈
    expect(storage.reviewLog.every((r) => r.grade !== 'fuzzy')).toBe(true);
    expect(storage.events.some((e) => e.type === 'judge' && e.grade === 'fuzzy' && !e.fsrsApplied)).toBe(true);
    expect(storage.events.some((e) => e.type === 'remediation_start')).toBe(false);
  });
});

// ── [SessionEnd] 四触发 → 分析三产出 → 落盘 → 回 [TodayDecision] ──

describe('会话结束：四触发', () => {
  test('goodbye：正向峰值收尾卡 + 分析三产出落盘；结束后 runTurn 抛错、重复结束返回 null', async () => {
    const { orchestrator, storage } = makeOrch(newLearnStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE); // 会话中途主动再见（峰值收尾，§10.2）
    const end = await orchestrator.notifySessionEnd({ saidGoodbye: true }, BASE);
    expect(end?.trigger).toBe('goodbye');
    expect(end?.wrapUp?.components.some((c) => c.name === 'SessionEndCard')).toBe(true);
    expect(end?.analysis.mindState.text.length).toBeGreaterThan(0);
    expect(new Date(end!.analysis.mindState.expiresAt).getTime()).toBe(at(24 * 3_600_000).getTime());
    expect(end?.analysis.nextAdjustment.length).toBeGreaterThan(0);
    const committed = storage.commits[0];
    expect(committed.sessionSummary?.skill).toBe('standard-learning');
    expect(committed.sessionSummary?.mindState?.text).toBe(end?.analysis.mindState.text);
    expect((committed.events ?? []).some((e) => e.type === 'session_end')).toBe(true);
    await expect(orchestrator.runTurn({ kind: 'open' }, BASE)).rejects.toThrow(/no active session/);
    expect(await orchestrator.notifySessionEnd({ saidGoodbye: true }, BASE)).toBe(null);
  });

  test('idle_90s / enter_background：静默结束（无收尾卡）；skip_twice：收尾卡', async () => {
    const idle = makeOrch(reviewStorage());
    await idle.orchestrator.boot(BASE);
    idle.orchestrator.openSession(BASE);
    await idle.orchestrator.runTurn({ kind: 'open' }, BASE);
    const idleEnd = await idle.orchestrator.notifySessionEnd({ idleMs: 95_000 }, BASE);
    expect(idleEnd?.trigger).toBe('idle_90s');
    expect(idleEnd?.wrapUp).toBe(null);

    const bg = makeOrch(reviewStorage());
    await bg.orchestrator.boot(BASE);
    bg.orchestrator.openSession(BASE);
    await bg.orchestrator.runTurn({ kind: 'open' }, BASE);
    const bgEnd = await bg.orchestrator.notifySessionEnd({ enteredBackground: true }, BASE);
    expect(bgEnd?.trigger).toBe('enter_background');
    expect(bgEnd?.wrapUp).toBe(null);

    const skip = makeOrch(newLearnStorage()); // standard 档跳过不推进批次 → 会话未自然收尾
    await skip.orchestrator.boot(BASE);
    skip.orchestrator.openSession(BASE);
    await skip.orchestrator.runTurn({ kind: 'open' }, BASE);
    await skip.orchestrator.runTurn({ kind: 'skip' }, BASE);
    await skip.orchestrator.runTurn({ kind: 'skip' }, BASE);
    const skipEnd = await skip.orchestrator.notifySessionEnd({}, BASE);
    expect(skipEnd?.trigger).toBe('skip_twice');
    expect(skipEnd?.wrapUp?.components.some((c) => c.name === 'SessionEndCard')).toBe(true);
    expect(skipEnd?.analysis.mindState.text.includes('节奏偏散')).toBe(true);
  });
});

describe('回合边界落盘与回环 [TodayDecision]', () => {
  test('结束后状态已持久化：再 boot 依据新状态决策（学过的卡不再当新学）', async () => {
    const data = newLearnStorage();
    const { orchestrator, storage } = makeOrch(data);
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    await orchestrator.runTurn({ kind: 'open' }, BASE);
    await orchestrator.runTurn({ kind: 'answer', aluId: 'n1', grade: 'correct', latencyMs: 20_000 }, BASE);
    await orchestrator.notifySessionEnd({ saidGoodbye: true }, BASE);
    expect(storage.data.aluStates.n1).toBeDefined(); // 出卡入队已落盘

    const second = await orchestrator.boot(BASE); // 回 [TodayDecision]
    expect(second.decision.kind).toBe('new_learn');
    if (second.decision.kind !== 'new_learn') throw new Error('unreachable');
    expect(second.decision.suggestion.aluId).toBe('n2'); // n1 已学过一轮（due T+1 未到期）
    expect(second.isFirstRun).toBe(false);
  });

  test('偏好边界：明确声明即时落库；观察到 ≥2 次才落库（防噪音）', async () => {
    const { orchestrator, storage } = makeOrch(reviewStorage());
    await orchestrator.boot(BASE);
    orchestrator.openSession(BASE);
    orchestrator.declarePreference('别用太多类比', BASE);
    const once = orchestrator.observePreference('不喜欢被问听懂了吗', BASE);
    expect(once.shouldPersist).toBe(false); // 第一次不落库
    const twice = orchestrator.observePreference('不喜欢被问听懂了吗', BASE);
    expect(twice.shouldPersist).toBe(true); // ≥2 次落库
    await orchestrator.notifySessionEnd({ saidGoodbye: true }, BASE);
    const boundaries = storage.data.profile?.preferences.boundaries ?? [];
    expect(boundaries.some((b) => b.text === '别用太多类比' && b.source === 'declared')).toBe(true);
    expect(boundaries.some((b) => b.text === '不喜欢被问听懂了吗' && b.source === 'observed')).toBe(true);
  });
});

// ── 度量层（§7.8④）──────────────────────────────────────────────

describe('metrics：调用率埋点 + 评测集导出（含负例标注）', () => {
  test('callRate = hit/(hit+miss)；误触发与负例标注计数；升级留痕同构', async () => {
    const store = createMetricsStore();
    store.recordActivation({ at: BASE.toISOString(), scenario: 'a', expectedSkill: 'review', activatedSkill: 'review', source: 'deterministic', outcome: 'hit', negativeExample: false });
    store.recordActivation({ at: BASE.toISOString(), scenario: 'b', expectedSkill: 'review', activatedSkill: 'review', source: 'corrected', outcome: 'miss', negativeExample: false });
    store.recordFalsePositive('闲聊误触发', 'deep-learning');
    const exported = store.exportEvaluationSet(BASE);
    expect(exported.callRate).toBe(0.5);
    expect(exported.falsePositiveCount).toBe(1);
    expect(exported.negativeExampleCount).toBe(1); // 误触发天然是负例
    expect(exported.samples.some((s) => s.expectedSkill === 'none' && s.outcome === 'false_positive')).toBe(true);

    const { orchestrator } = makeOrch(reviewStorage());
    await orchestrator.boot(BASE);
    const boot = orchestrator.metrics.exportEvaluationSet(BASE);
    expect(boot.callRate).toBe(1); // 确定性激活恒 hit
    expect(boot.samples[0].scenario).toBe('decision:review');
    expect(boot.samples[0].negativeExample).toBe(false);
  });
});
