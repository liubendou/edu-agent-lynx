/**
 * Orchestrator 主状态机（ARCHITECTURE §4 逐句落实；PRD §5.6/§7.2/§7.7/§10.1）。
 *
 *   [AppStart] 首启判定（无任何待办与记录→first_run）/回访
 *      → [TodayDecision] domain/decision（D10：复习 R 升序 > 补讲 > 新学；端侧离线）
 *      → [SkillActivation] activator 确定性激活（决策已定档→直连，不经模型；点名同直连）
 *      → [SessionLoop] 每回合 thought→action→observation：
 *            action 分派（A2UI 下发 / 工具调用 / TTS 指令），
 *            observation 回收（作答 / 工具结果）驱动下一回合；
 *            每回合过 validator（该用 Skill 没用→强制纠偏重发，超限→升级信号上报），
 *            difficulty（答快对升/卡住先降给脚手架不判错；复习档调节拍不调难度）。
 *      → [SessionEnd] 四触发（空闲>90s/退后台/连续2次跳过/主动再见）
 *            → 会话结束分析三产出（心理状态 TTL/偏好防噪音修正/下次建议，§5.3 静默不弹窗）
 *            → 回合边界落盘 → 回 [TodayDecision]。
 *
 * 会话有界（§10.1①）：开场注入"再 N 张清完今天"，不做开放结尾。
 * 补讲子会话（硬规则3，F7）：挂主会话，仅 remediation_start/remediation_done 两个事件；
 * 补讲期不写 FSRS——重新入队间隔按答错处理（wrong 时 Again 已落）。
 */
import type { Card, FSRS } from 'ts-fsrs';
import type { TodayDecision, TodayResult } from '../domain/decision';
import { decideToday } from '../domain/decision';
import type { Alu, AluUserState, AnswerRecord } from '../domain/alu';
import { buildPrereqGraph, pushAnswerRecord } from '../domain/alu';
import type { SessionEvent } from '../domain/events';
import { FLOW_PARAMS, createDifficultyAdjustEvent, createSkillEscalationEvent } from '../domain/events';
import { createScheduler, createEnqueuedState } from '../domain/fsrs';
import {
  allowsCardGeneration,
  completeRemediation,
  emitCardGenerated,
  endSession,
  expireRemediation,
  judgeAnswer,
  startSession,
  buildSessionSummary,
  type SessionState,
} from '../domain/session';
import {
  appendSessionSummary,
  createEmptyProfile,
  declareBoundary,
  detectSessionEndTrigger,
  isMindStateExpired,
  observeBoundary,
  type LearnerProfile,
  type MindState,
  type PreferenceBoundary,
  type PreferenceUpdate,
  type Preferences,
  type SessionEndAnalysis,
  type SessionEndTrigger,
  type SessionSummary,
} from '../domain/profile';
import { DEFAULT_DAILY_BUDGET, isDue, pickReviewBatch, queueItemFrom } from '../domain/queue';
import type { AluId, Grade, SkillName } from '../domain/types';
import type { ChatTurn, CloudTurnRequest, OrchestratorPorts, RetrievedChunk } from './ports';
import {
  activateByMention,
  activateForDecision,
  asCardGeneratingSkill,
  assertActionAllowed,
  type ActivationResult,
} from './activator';
import { assessDifficulty, emitsDifficultyEvent, type DifficultyDirective } from './difficulty';
import { createMetricsStore, type SkillMetrics } from './metrics';
import {
  MAX_CORRECTIONS_PER_TURN,
  deviationEscalationSignal,
  parseTurnOutput,
  validateTurnOutput,
  type TurnExpectation,
  type TurnOutput,
  type TurnPhase,
  type ValidationIssue,
} from './validator';

/** 心理状态 TTL：会话级一条，24 小时过期即弃（§5.4/§5.5）。 */
export const MIND_STATE_TTL_MS = 24 * 3_600_000;
/** 连续工具失败 ≥2 → 卡死升级 tool_failures 信号（§7.6 五类之一）。 */
const TOOL_FAILURE_ESCALATION_THRESHOLD = 2;

/** 回合 observation（用户作答/工具结果/推进/跳过/卡住/点名，§7.7②）。 */
export type Observation =
  | { kind: 'open' } // 会话首回合（开场注入有界话术）
  | { kind: 'answer'; aluId: AluId; grade: Grade; latencyMs: number }
  | { kind: 'advance' } // 上滑/继续：地图推进、讲解下一步
  | { kind: 'stuck' } // 卡住/求助：先降难度给脚手架，不判错（§10.1③）
  | { kind: 'skip' } // 跳过（连续 2 次 → 会话结束触发）
  | { kind: 'user_text'; text: string }
  | { kind: 'remediation_done' } // 补讲子会话完成（补完重新入队）
  | { kind: 'tool_result'; name: string; result: unknown };

export interface BootOutcome {
  decision: TodayDecision;
  reason: string;
  /** 首启分支信号（方案 D 元课程小课，PRD §6） */
  isFirstRun: boolean;
  activation: ActivationResult;
  /** 有界会话开场话术预览（"再 N 张清完今天"，§10.1①） */
  boundedLine: string;
}

export interface TurnOutcome {
  ok: boolean; // validator 终态通过
  components: { id: string; name: string }[];
  issues: ValidationIssue[]; // 终态未解决项（ok=false 时非空）
  attempts: number;
  escalated: boolean;
  phase: TurnPhase;
  judged?: { aluId: AluId; grade: Grade; fsrsApplied: boolean };
  remediationStarted: boolean;
  /** 本回合注入的 directives 原文（观测/调试位） */
  directives: string[];
}

export interface SessionEndOutcome {
  trigger: SessionEndTrigger;
  analysis: SessionEndAnalysis;
  summary: SessionSummary;
  /** 收尾卡产物（仅 goodbye/skip_twice 且未收过尾时产出；正向峰值收尾 §10.2） */
  wrapUp: TurnOutput | null;
  persisted: { reviewLogAppend: AnswerRecord[]; eventCount: number };
}

export interface OrchestratorOptions {
  /** validator 单回合纠偏上限（超出→升级信号上报，§7.8③） */
  maxCorrectionsPerTurn?: number;
  /** 时钟注入（测试） */
  now?: () => Date;
}

type MachinePhase = 'idle' | 'booted' | 'in_session' | 'ended';

/** Orchestrator：产品的大脑（跑后台线程；依赖全部经 ports 注入）。 */
export class Orchestrator {
  readonly metrics: SkillMetrics;

  private readonly ports: OrchestratorPorts;
  private readonly maxCorrections: number;
  private readonly clock: () => Date;
  private sessionCounter = 0;

  private phase: MachinePhase = 'idle';
  private alus: Record<AluId, Alu> = {};
  private states: Record<AluId, AluUserState> = {};
  private profile: LearnerProfile = createEmptyProfile();
  private scheduler: FSRS = createScheduler();
  private decision: TodayResult | null = null;
  private activation: ActivationResult | null = null;
  private session: SessionState | null = null;

  private queue: AluId[] = [];
  private cursor = 0;
  private fuzzyPresented = new Set<AluId>();
  private currentAlu: AluId | null = null;
  private variantDone = new Set<AluId>();
  private pendingVariant = false;
  private consecutiveSkips = 0;
  private consecutiveToolFailures = 0;
  private history: ChatTurn[] = [];
  private pendingRetrieved: RetrievedChunk[] = [];
  private pendingBoundaries: { boundary: PreferenceBoundary; op: 'add' | 'revise' }[] = [];
  /** 观察到但未确认（<2 次）的边界暂存：不进画像、不下发约束、不落盘（§5.3 防噪音）。 */
  private observedBoundaries: PreferenceBoundary[] = [];
  private boundedInjected = false;
  private wrapUpDone = false;

  constructor(ports: OrchestratorPorts, opts: OrchestratorOptions = {}) {
    this.ports = ports;
    this.maxCorrections = opts.maxCorrectionsPerTurn ?? MAX_CORRECTIONS_PER_TURN;
    this.clock = opts.now ?? (() => new Date());
    this.metrics = createMetricsStore();
  }

  // ── [AppStart] → [TodayDecision] → [SkillActivation] ──────────────

  /** 首启判定 + 今日决策 + 确定性激活（端侧、离线、零网络）。 */
  async boot(now: Date = this.clock()): Promise<BootOutcome> {
    if (this.phase === 'in_session') throw new Error('boot: 会话进行中，不可重新决策');
    const snap = await this.ports.storage.loadSnapshot();
    this.alus = snap.alus;
    this.states = snap.aluStates;
    this.profile = snap.profile ?? createEmptyProfile();
    this.scheduler = createScheduler();

    const dueItems = this.dueQueueItems(now);
    const remediationAluIds = this.remediationAluIds(now);
    // 首启 = 无任何待办与记录（无 ALU 用户状态、无作答事件、无会话摘要）
    const hasAnyRecord =
      Object.keys(this.states).length > 0
      || this.profile.facts.answerEvents.length > 0
      || this.profile.sessionSummaries.length > 0;
    const isFirstRun = !hasAnyRecord && dueItems.length === 0 && remediationAluIds.length === 0;

    const newSuggestionAlu = this.newLearnCandidate();
    const result = decideToday({
      dueItems,
      budget: DEFAULT_DAILY_BUDGET,
      remediationAluIds,
      ...(newSuggestionAlu !== null ? { newSuggestion: { aluId: newSuggestionAlu } } : {}),
      goals: this.profile.facts.goals,
      ...(isFirstRun ? { isFirstRun: true } : {}),
      now,
    });
    this.decision = result;
    this.activation = activateForDecision(result.decision, this.ports.skills);
    this.recordActivationSample(
      `decision:${result.decision.kind}`,
      this.activation.skill,
      'deterministic',
      'hit',
      false,
      result.reason,
    );
    this.phase = 'booted';
    this.resetSessionScratch();
    return {
      decision: result.decision,
      reason: result.reason,
      isFirstRun,
      activation: this.activation,
      boundedLine: this.boundedLineFor(this.activation.skill, this.activation.aluIds.length),
    };
  }

  /** 用户点名/主动入口（"复习一下"）→ 同样直连激活（§7.8②③；不经模型）。
   *  点名同样端侧补齐操作对象（确定性、离线）：复习点名接今日到期批次（R 升序），
   *  其余档接新学候选；会话中的换档走 user_text/会话结束流程，不在此直连。 */
  async activateByMention(text: string, now: Date = this.clock()): Promise<ActivationResult | null> {
    if (this.phase === 'in_session') return null; // 会话中点名不换档（§7.7②：换档走重新激活流程）
    const hit = activateByMention(text, this.ports.skills);
    if (!hit) return null;
    if (this.phase === 'idle') {
      const snap = await this.ports.storage.loadSnapshot();
      this.alus = snap.alus;
      this.states = snap.aluStates;
      this.profile = snap.profile ?? createEmptyProfile();
    }
    if (hit.skill === 'review') {
      hit.aluIds = pickReviewBatch(this.dueQueueItems(now), DEFAULT_DAILY_BUDGET.reviewCards).map((q) => q.aluId);
    } else {
      const candidate = this.newLearnCandidate();
      hit.aluIds = candidate !== null ? [candidate] : [];
    }
    this.activation = hit;
    this.phase = 'booted';
    this.recordActivationSample(`mention:${text.slice(0, 24)}`, hit.skill, 'named', 'hit', false, hit.reason);
    this.resetSessionScratch();
    return hit;
  }

  // ── [SessionLoop] 会话生命周期 ─────────────────────────────────────

  /** 激活后开表：domain 会话状态机启动（quick 档 params.cardGeneration 由 domain 强制 false）。 */
  openSession(now: Date = this.clock()): SessionState {
    if (this.phase !== 'booted' || !this.activation) {
      throw new Error('openSession: 需先 boot/activateByMention 完成激活');
    }
    const cards: Record<AluId, Card> = {};
    if (this.activation.skill === 'review') {
      for (const aluId of this.activation.aluIds) {
        const st = this.states[aluId];
        if (st) cards[aluId] = st.fsrs;
      }
    }
    this.sessionCounter += 1;
    this.session = startSession({
      sessionId: `s-${now.getTime()}-${this.sessionCounter}`,
      skill: this.activation.skill,
      aluIds: this.activation.aluIds,
      params: this.activation.params,
      now,
      cards,
    });
    this.queue = [...this.activation.aluIds];
    this.cursor = 0;
    this.history = [];
    this.pendingRetrieved = [];
    this.pendingBoundaries = [];
    this.boundedInjected = false;
    this.wrapUpDone = false;
    this.fuzzyPresented = new Set();
    this.variantDone = new Set();
    this.pendingVariant = false;
    this.consecutiveSkips = 0;
    this.consecutiveToolFailures = 0;
    this.currentAlu = null;
    this.phase = 'in_session';
    return this.session;
  }

  /** 每回合：observation 回收 → 域计算/难度调节 → thought（组请求）→ action（流式下发+纠偏）。 */
  async runTurn(observation: Observation, now: Date = this.clock()): Promise<TurnOutcome> {
    // in_session ⇒ activation 非空（openSession 仅在激活后置 in_session）：守卫一并收窄，
    // 否则下方 this.activation.mode 不可达地报 possibly-null。
    if (this.phase !== 'in_session' || !this.session || !this.activation || this.session.ended) {
      throw new Error('runTurn: no active session');
    }
    const directives: string[] = [];

    // ① observation 回收（域计算 + 指令收集），驱动下一回合
    const processed = this.processObservation(observation, directives, now);

    // ② 补讲 90 秒预算耗尽检查（domain.expireRemediation：补完同样按答错重新入队）
    const sub = this.session.activeRemediation;
    if (sub && new Date(sub.deadline).getTime() <= now.getTime()) {
      this.session = expireRemediation(this.session, now);
      directives.push('补讲 90 秒预算耗尽：该卡已按答错间隔重新入队，回到主流程');
    }

    // ③ 决定本回合目标与阶段（补讲优先 → fuzzy 重现 → 批次序列 → 收尾）
    const target = this.pickTarget();
    const phase = this.currentPhase(target);
    const aluIds: AluId[] = target !== null ? [target] : [];

    // ④ 开场有界话术注入（§10.1①：会话有界，不做开放结尾）
    if (!this.boundedInjected) {
      this.boundedInjected = true;
      const remaining = Math.max(0, this.queue.length - this.cursor);
      directives.unshift(
        `会话有界：${this.boundedLineFor(this.session.skill, remaining)}——本回合只做眼前这一张，做完就有可见终点`,
      );
    }

    // ⑤ thought → 组请求 → action 分派（A2UI 下发/工具/TTS；validator 纠偏回路在内）
    const mode = this.session.activeRemediation !== null ? 'remediation' : this.activation.mode;
    const expectationSkill: SkillName = phase === 'remediation' ? 'standard-learning' : this.session.skill;
    const expectation: TurnExpectation = {
      skill: expectationSkill,
      phase,
      cardGeneration: this.session.params.cardGeneration && allowsCardGeneration(this.session.skill),
    };
    const baseRequest: CloudTurnRequest = {
      mode,
      skillTemplate: this.ports.skills.getActiveSkill(mode).promptTemplate,
      profileFragment: this.buildProfileFragment(now),
      taskInstruction: {
        aluIds,
        mode,
        params: this.session.params,
        budget: DEFAULT_DAILY_BUDGET,
        boundaries: this.profile.preferences.boundaries.map((b) => b.text),
      },
      history: [...this.history],
      retrieved: [...this.pendingRetrieved],
      directives: [...directives],
    };
    const streamed = await this.streamWithValidator(baseRequest, expectation, now);

    if (phase === 'wrap_up' && streamed.ok) this.wrapUpDone = true;
    this.emitterFlush();
    return {
      ok: streamed.ok,
      components: streamed.output.components,
      issues: streamed.issues,
      attempts: streamed.attempts,
      escalated: streamed.escalated,
      phase,
      ...(processed.judged !== undefined ? { judged: processed.judged } : {}),
      remediationStarted: processed.remediationStarted,
      directives: baseRequest.directives,
    };
  }

  /** 硬规则1/2 代码强制的出卡 action 入口（quick/review 一律拒绝；standard/deep 讲完自检过调用）。 */
  requestCardGeneration(aluIds: AluId[], now: Date = this.clock()): SessionEvent {
    if (!this.session || this.session.ended) throw new Error('requestCardGeneration: no active session');
    const skill = asCardGeneratingSkill(this.session.skill); // 硬规则2：类型级收窄
    if (!skill) {
      // 硬规则1：quick 档白名单没有 card_generation（quick 走白名单报错，归属正确）
      if (this.session.skill === 'quick-learning') assertActionAllowed(this.session.skill, 'card_generation');
      throw new Error(`card_generated forbidden in '${this.session.skill}' (硬规则2：仅 standard/deep 可发)`);
    }
    const out = emitCardGenerated(this.session, aluIds, this.chunkIdOf(aluIds[0])); // domain 运行时双保险
    this.session = out.state;
    for (const id of aluIds) this.ensureEnqueuedState(id, now); // 学过一轮入队，due=T+1
    return out.event;
  }

  // ── 偏好（事件触发：即时、轻量、本地，§5.2）──────────────────────

  /** 明确声明边界（"别用太多类比"）：即时落库（§5.3）。 */
  declarePreference(text: string, now: Date = this.clock()): PreferenceBoundary {
    const boundary = declareBoundary(this.profile.preferences, text, now);
    this.profile = this.withBoundary(boundary);
    this.pendingBoundaries.push({ boundary, op: 'add' });
    return boundary;
  }

  /** 观察到的边界：仅出现 ≥2 次才标记落库（§5.3 防噪音）。
   *  确认前的观察只进会话内暂存（计数留存），不进画像、不下发约束、不落盘。 */
  observePreference(
    text: string,
    now: Date = this.clock(),
  ): { boundary: PreferenceBoundary; shouldPersist: boolean } {
    // 暂存与画像合并后走 domain 计数（declared 边界重复观察 → 即时确认）
    const staging: Preferences = {
      ...this.profile.preferences,
      boundaries: [...this.profile.preferences.boundaries, ...this.observedBoundaries],
    };
    const observed = observeBoundary(staging, text, now);
    if (observed.shouldPersist) {
      this.profile = this.withBoundary(observed.boundary);
      const known = this.pendingBoundaries.some((p) => p.boundary.text === text);
      this.pendingBoundaries.push({ boundary: observed.boundary, op: known ? 'revise' : 'add' });
    } else {
      this.observedBoundaries = [
        ...this.observedBoundaries.filter((b) => b.text !== text),
        observed.boundary,
      ];
    }
    return observed;
  }

  // ── [SessionEnd] 四触发 → 分析三产出 → 落盘 → 回 [TodayDecision] ──

  /** 四触发（空闲>90s/退后台/连续2次跳过/主动再见，§5.2）→ 结束分析 + 回合边界落盘。 */
  async notifySessionEnd(
    signals: { idleMs?: number; enteredBackground?: boolean; saidGoodbye?: boolean },
    now: Date = this.clock(),
  ): Promise<SessionEndOutcome | null> {
    if (this.phase !== 'in_session' || !this.session || this.session.ended) return null;
    const trigger = detectSessionEndTrigger({
      idleMs: signals.idleMs,
      enteredBackground: signals.enteredBackground,
      saidGoodbye: signals.saidGoodbye,
      consecutiveSkips: this.consecutiveSkips,
    });
    if (trigger === null) return null;

    // 会话结束分析三产出（§5.3：静默记录、不弹窗不打断）
    const analysis = this.analyzeSession(trigger, now);
    this.session = endSession(this.session, trigger, analysis, now);

    // SessionEndCard 正向峰值收尾（§10.2）：用户仍在场（goodbye/skip_twice）且尚未收过尾
    let wrapUp: TurnOutput | null = null;
    if ((trigger === 'goodbye' || trigger === 'skip_twice') && !this.wrapUpDone) {
      const request: CloudTurnRequest = {
        mode: this.session.skill,
        skillTemplate: this.ports.skills.getActiveSkill(this.session.skill).promptTemplate,
        profileFragment: this.buildProfileFragment(now),
        taskInstruction: {
          aluIds: [],
          mode: this.session.skill,
          params: this.session.params,
          budget: DEFAULT_DAILY_BUDGET,
          boundaries: this.profile.preferences.boundaries.map((b) => b.text),
        },
        history: [...this.history],
        retrieved: [],
        directives: ['会话收尾：正向峰值收尾，只讲今天变强在哪，不渲染欠账（峰值-终点律，§10.2）'],
      };
      const streamed = await this.streamWithValidator(
        request,
        { skill: this.session.skill, phase: 'wrap_up', cardGeneration: false },
        now,
      );
      wrapUp = streamed.output;
      this.wrapUpDone = true;
      this.emitterFlush();
    }

    // 三产出入画像 + 会话摘要（§5.1 D 层）+ 回合边界批量落盘（§7.7）
    const summary = buildSessionSummary(
      this.session,
      {
        whatHappened: this.describeWhatHappened(),
        nextSuggestion: analysis.nextAdjustment,
        mindState: analysis.mindState,
      },
      now,
    );
    this.profile = appendSessionSummary(this.profile, summary);
    this.applyAnalysisToProfile(analysis);
    this.mergeSessionIntoStates();
    const reviewLogAppend = this.session.records.filter((r) => r.grade !== 'fuzzy' && !r.revoked); // D8
    await this.ports.storage.commit({
      profile: this.profile,
      aluStates: this.states,
      reviewLogAppend,
      sessionSummary: summary,
      events: this.session.events, // 事件落盘（埋点同源，§7.8④）
    });
    this.phase = 'ended';
    return {
      trigger,
      analysis,
      summary,
      wrapUp,
      persisted: { reviewLogAppend, eventCount: this.session.events.length },
    };
  }

  // ── 内部：observation 回收（域计算驱动下一回合）────────────────────

  private processObservation(
    observation: Observation,
    directives: string[],
    now: Date,
  ): { judged?: { aluId: AluId; grade: Grade; fsrsApplied: boolean }; remediationStarted: boolean } {
    // 调用点（runTurn）已判空；方法内再守卫一次并固定到局部变量——
    // this.session 在同方法内被 reassigned（answer 分支），局部变量收窄不受
    // 中间函数调用影响，各分支改读局部值（值与当时的 this.session 相同）。
    const session = this.session;
    if (session === null) throw new Error('processObservation: no active session');
    switch (observation.kind) {
      case 'open':
        return { remediationStarted: false }; // 无域效应，纯开场
      case 'answer': {
        // 补讲子会话内的作答不写 FSRS（重新入队间隔按答错处理——wrong 时 Again 已落，硬规则3）
        const inRemediation = session.activeRemediation?.aluId === observation.aluId;
        const out = judgeAnswer(session, {
          aluId: observation.aluId,
          grade: observation.grade,
          latencyMs: observation.latencyMs,
          now,
          prereqGraph: buildPrereqGraph(Object.values(this.alus)),
          scheduler: this.scheduler,
          ...(inRemediation ? { applyFsrs: false } : {}),
        });
        this.session = out.state;
        this.history.push({
          role: 'user',
          content: `作答 ${observation.aluId}：${observation.grade}（${String(observation.latencyMs)}ms）`,
          at: now.toISOString(),
        });
        const judged = { aluId: observation.aluId, grade: observation.grade, fsrsApplied: out.fsrsApplied };

        // difficulty（§10.1③）：答快对升/卡住先降；复习档只调节拍不调难度（§10.1④）
        const directive = assessDifficulty({
          skill: this.session.skill,
          grade: observation.grade,
          latencyMs: observation.latencyMs,
          stuck: false,
          recentGrades: this.session.records.filter((r) => !r.revoked).map((r) => r.grade),
        });
        this.applyDifficultyDirective(observation.aluId, directive, directives);

        // 变式回合判定（先记录本轮是否已是变式回合，防止重复推进/重复出卡）
        const wasVariantTurn = this.pendingVariant;
        this.pendingVariant = false;

        // 硬规则2 路径：standard/deep 讲完并自检过 → 生成复习卡（quick 白名单/类型/运行时三重拒绝）
        if (
          observation.grade === 'correct'
          && !wasVariantTurn
          && this.currentAlu === observation.aluId
          && allowsCardGeneration(this.session.skill)
          && this.session.params.cardGeneration
        ) {
          this.requestCardGeneration([observation.aluId], now);
          directives.push('已出卡：讲完并自检过，该卡 T+1 进入复习队列');
        }

        // deep 变式（§10.1③ 答得快又对 → 给变式，同一 ALU 换问法再问一次）
        if (
          directive.kind === 'up'
          && this.session.skill === 'deep-learning'
          && this.currentAlu === observation.aluId
          && !this.variantDone.has(observation.aluId)
        ) {
          this.variantDone.add(observation.aluId);
          this.pendingVariant = true;
          directives.push('升难度给变式：同一 ALU 换问法再问一次');
        }

        // 批次推进：review 每卡一判后进下一张（fuzzy 不推进、本轮稍后重现，D8）；
        // standard/deep 自检过进下一 ALU（变式回合不二次推进）。
        // 补讲子会话内的作答不推进主批次——wrong 判定时已推进（硬规则3）。
        const advance = !inRemediation && (
          this.session.skill === 'review'
            ? observation.grade !== 'fuzzy'
            : observation.grade === 'correct' && !wasVariantTurn
        );
        if (advance && this.cursor < this.queue.length) this.cursor += 1;

        // fuzzy（D8）：触发"再讲一遍"脚手架、本轮稍后重现、不产生新欠账
        if (observation.grade === 'fuzzy') {
          directives.push(
            `再讲一遍 ${observation.aluId}：刚才的答案"差不多对"——只重讲判据，稍后这张卡会再出现一次（不记账）`,
          );
        }
        // 硬规则3：review 档 wrong → 自动注入 remediation 子会话（standard 档 90 秒）
        if (out.remediationStarted) {
          directives.push(
            `复习失败自动补讲：接下来 90 秒用标准档把 ${observation.aluId} 讲透，补完按答错间隔重新入队`,
          );
        }
        if (observation.grade === 'wrong' && this.session.skill !== 'review') {
          directives.push('答错不判死：降台阶，换更小的切入点再问');
        }
        this.consecutiveSkips = 0;
        return { judged, remediationStarted: out.remediationStarted };
      }
      case 'advance':
        directives.push('继续推进当前序列的下一步');
        this.consecutiveSkips = 0;
        return { remediationStarted: false };
      case 'stuck': {
        const directive = assessDifficulty({
          skill: session.skill,
          stuck: true,
          recentGrades: session.records.filter((r) => !r.revoked).map((r) => r.grade),
        });
        this.applyDifficultyDirective(this.currentAlu ?? 'unknown', directive, directives);
        directives.push(directive.message ?? '先给脚手架，不直接判错');
        return { remediationStarted: false }; // 不判错：无 judge、无作答记录
      }
      case 'skip':
        this.consecutiveSkips += 1;
        if (session.skill === 'review' && this.cursor < this.queue.length) {
          this.cursor += 1; // 跳过的复习卡不作答、不判分，保持到期等下次
        }
        this.history.push({ role: 'user', content: '跳过', at: now.toISOString() });
        return { remediationStarted: false };
      case 'user_text':
        this.history.push({ role: 'user', content: observation.text, at: now.toISOString() });
        directives.push('响应用户原话；点名优先级最高（§7.8②），换档走重新激活流程');
        return { remediationStarted: false };
      case 'remediation_done': {
        const sub = session.activeRemediation;
        if (sub) {
          this.session = completeRemediation(session, sub.aluId); // requeued=true（间隔按答错处理）
          directives.push(`补讲完成：${sub.aluId} 已重新入队，回到主流程`);
        }
        return { remediationStarted: false };
      }
      case 'tool_result':
        this.pendingRetrieved.push({ kind: 'search_digest', digest: JSON.stringify(observation.result) });
        this.history.push({
          role: 'tool',
          content: `${observation.name} → ${JSON.stringify(observation.result)}`,
          at: now.toISOString(),
        });
        return { remediationStarted: false };
    }
  }

  /** 难度/节拍指令落地：up/down 发 difficulty_adjust 领域事件（复习档 pace 不调难度→不发，§10.1④）。 */
  private applyDifficultyDirective(
    aluId: AluId,
    directive: DifficultyDirective,
    directives: string[],
  ): void {
    if (directive.kind === 'hold') return;
    if (emitsDifficultyEvent(directive)) {
      this.session!.events.push(
        createDifficultyAdjustEvent({ aluId, direction: directive.kind as 'up' | 'down', reason: directive.reason }),
      );
    }
    directives.push(`难度指令（${directive.kind}）：${directive.reason}`);
  }

  // ── 内部：目标选择 / 阶段 / 组请求 ────────────────────────────────

  /** 本回合目标 ALU：补讲优先 → fuzzy 重现 → 批次序列；null = 收尾。 */
  private pickTarget(): AluId | null {
    const session = this.session!;
    let target: AluId | null = null;
    if (session.activeRemediation) {
      target = session.activeRemediation.aluId;
    } else if (session.skill === 'review') {
      const requeued = session.fuzzyRequeue.find((id) => !this.fuzzyPresented.has(id));
      if (requeued !== undefined) {
        this.fuzzyPresented.add(requeued);
        target = requeued;
      } else {
        target = this.cursor < this.queue.length ? this.queue[this.cursor] : null;
      }
    } else if (this.pendingVariant && this.currentAlu !== null) {
      target = this.currentAlu; // 变式回合：同一 ALU 换问法
    } else {
      target = this.cursor < this.queue.length ? this.queue[this.cursor] : null;
    }
    if (target !== null) this.currentAlu = target;
    return target;
  }

  private currentPhase(target: AluId | null): TurnPhase {
    const session = this.session!;
    if (session.activeRemediation) return 'remediation';
    // boot 级补讲会话（决策 kind='remediation'）：整场按 90 秒补讲阶段走
    if (this.activation!.mode === 'remediation') return target !== null ? 'remediation' : 'wrap_up';
    if (session.skill === 'review') return target !== null ? 'present' : 'wrap_up';
    if (this.pendingVariant && target !== null) return 'variant';
    return target !== null ? 'teach' : 'wrap_up'; // standard/deep 讲解+讲完即问；quick 地图构建
  }

  /** ⑤ 段：端侧画像最小片段（绝不发完整画像，§6 端云边界）。 */
  private buildProfileFragment(now: Date): string {
    const parts: string[] = [];
    const boundaries = this.profile.preferences.boundaries.map((b) => b.text);
    if (boundaries.length > 0) parts.push(`偏好边界（硬约束）：${boundaries.join('；')}`);
    const lastMind = this.profile.sessionSummaries[this.profile.sessionSummaries.length - 1]?.mindState;
    if (lastMind && !isMindStateExpired(lastMind, now)) parts.push(`近期状态（TTL 内）：${lastMind.text}`);
    parts.push(`可接受难度：${String(this.profile.ability.rhythm.acceptableDifficulty)}`);
    parts.push(`语速：${String(this.profile.preferences.tts.rate)}`);
    return parts.join('\n');
  }

  private boundedLineFor(skill: SkillName, remaining: number): string {
    if (skill === 'review') return `再 ${String(Math.max(0, remaining))} 张清完今天`;
    return FLOW_PARAMS[skill].boundedSession.closingLine;
  }

  // ── 内部：流式回合 + validator 纠偏回路 + 工具/TTS 分派 ────────────

  private async streamWithValidator(
    baseRequest: CloudTurnRequest,
    expectation: TurnExpectation,
    now: Date,
  ): Promise<{ ok: boolean; output: TurnOutput; issues: ValidationIssue[]; attempts: number; escalated: boolean }> {
    const extra: string[] = [];
    let retries = 0;
    let escalated = false;
    let postEscalationAttempt = false;
    let output: TurnOutput = { components: [], tts: [], toolCalls: [], unparsed: [], raw: [] };
    let issues: ValidationIssue[] = [];
    let attempts = 0;

    for (;;) {
      attempts += 1;
      output = await this.streamOnce({ ...baseRequest, directives: [...baseRequest.directives, ...extra] });
      issues = validateTurnOutput(expectation, output);
      if (issues.length === 0) break;
      if (escalated && postEscalationAttempt) break; // 升级指导后仍不达标 → 放行（负例留存）
      if (retries < this.maxCorrections) {
        retries += 1;
        for (const issue of issues) extra.push(issue.correctiveDirective);
        this.recordActivationSample(
          `turn:${expectation.phase}`,
          expectation.skill,
          'corrected',
          'miss', // 漏触发样本：该用 Skill 没用，被 validator 纠偏救回（§7.8④）
          false,
          issues.map((i) => i.detail).join('; '),
        );
        continue; // 强制纠偏重发
      }
      if (!escalated) {
        escalated = true;
        const signal = deviationEscalationSignal(issues);
        const result = await this.ports.cloud.escalate(
          {
            stuckAt: issues.map((i) => i.detail).join('; '),
            goal: `${expectation.phase} 阶段按 ${expectation.skill} 模板产出`,
            skill: expectation.skill,
          },
          signal,
        );
        this.session!.events.push(createSkillEscalationEvent(signal, result)); // 升级留痕（画像学习事实层）
        this.metrics.recordEscalation(signal, result, now.toISOString());
        extra.push(`升级指导（pro 单次，切回 flash 执行）：${result.nextStep}`);
        postEscalationAttempt = true;
        continue;
      }
      break;
    }

    // ⑧ 段用完即弃（just-in-time）：本回合请求已快照 retrieved，先清空再收集
    // dispatch 产生的工具结果，使其存活到下一回合请求。
    this.pendingRetrieved = [];
    // action 分派：工具调用 / TTS（A2UI 行已在 streamOnce 内渐进下发）
    await this.dispatchMachineActions(output);
    // ⑦ 段只追加（assistant 产出摘要；工具结果在 dispatch 内追加）
    this.history.push({
      role: 'assistant',
      content: `A2UI: ${output.components.map((c) => c.name).join(',').slice(0, 200)}`,
      at: now.toISOString(),
    });
    return { ok: issues.length === 0, output, issues, attempts, escalated };
  }

  private streamOnce(request: CloudTurnRequest): Promise<TurnOutput> {
    return new Promise<TurnOutput>((resolve, reject) => {
      const chunks: string[] = [];
      this.ports.cloud.stream(request, {
        onChunk: (chunk) => {
          chunks.push(chunk);
          // A2UI v0.9 行渐进下发渲染（机器级 tts/tool_call 行不下发，避免降级噪音）
          if (chunk.includes('surfaceUpdate')) this.ports.emitter.emit(chunk);
        },
        onDone: () => resolve(parseTurnOutput(chunks)),
        onError: (error) => reject(error),
      });
    });
  }

  /** 工具调用与 TTS 指令分派（action 三分之一的机器侧；§7.3 白名单由 tools 层管）。 */
  private async dispatchMachineActions(output: TurnOutput): Promise<void> {
    const session = this.session!;
    assertActionAllowed(session.skill, 'tts');
    for (const line of output.tts) {
      try {
        await this.invokeTool('tts_speak', { text: line.text, rate: this.profile.preferences.tts.rate });
      } catch {
        // 已计数/升级留痕，回合继续（工具失败不阻塞主流程）
      }
    }
    assertActionAllowed(session.skill, 'tool_call');
    for (const call of output.toolCalls) {
      try {
        const result = await this.invokeTool(call.name, call.args);
        if (result !== undefined) {
          this.pendingRetrieved.push({ kind: 'search_digest', digest: JSON.stringify(result) });
          this.history.push({ role: 'tool', content: `${call.name} → ${JSON.stringify(result)}`.slice(0, 500) });
        }
      } catch {
        // 同上：连续失败 ≥2 次已在 invokeTool 内触发升级
      }
    }
  }

  private async invokeTool(name: string, args: unknown): Promise<unknown> {
    try {
      const result = await this.ports.tools.callTool(name, args);
      this.consecutiveToolFailures = 0;
      return result;
    } catch (err) {
      this.consecutiveToolFailures += 1;
      if (this.consecutiveToolFailures >= TOOL_FAILURE_ESCALATION_THRESHOLD) {
        const signal = { type: 'tool_failures' as const, consecutive: this.consecutiveToolFailures };
        const result = await this.ports.cloud.escalate(
          {
            stuckAt: `工具 ${name} 连续失败 ${String(this.consecutiveToolFailures)} 次`,
            goal: '完成当前回合',
            skill: this.session!.skill,
          },
          signal,
        );
        this.session!.events.push(createSkillEscalationEvent(signal, result));
        this.consecutiveToolFailures = 0; // 升级后重置计数
      }
      throw err;
    }
  }

  private emitterFlush(): void {
    this.ports.emitter.flush();
  }

  // ── 内部：今日决策输入装配 ────────────────────────────────────────

  private dueQueueItems(now: Date) {
    const items = [];
    for (const alu of Object.values(this.alus)) {
      const state = this.states[alu.id];
      if (state && isDue(state, now)) {
        items.push(queueItemFrom(alu, state, now, this.scheduler));
      }
    }
    return items;
  }

  /** 当日补讲：今天答错且此后未再作答过的卡（复习答错待补）。 */
  private remediationAluIds(now: Date): AluId[] {
    const today = now.toISOString().slice(0, 10);
    const ids: AluId[] = [];
    for (const state of Object.values(this.states)) {
      const last = state.lastAnswers[state.lastAnswers.length - 1];
      if (last && last.grade === 'wrong' && !last.revoked && last.at.slice(0, 10) === today) {
        ids.push(state.aluId);
      }
    }
    return ids.sort();
  }

  private newLearnCandidate(): AluId | null {
    const unseen = Object.values(this.alus)
      .filter((a) => {
        const st = this.states[a.id];
        return st === undefined || st.status === 'unseen' || st.status === 'seen';
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    return unseen[0]?.id ?? null;
  }

  // ── 内部：会话结束分析（三产出，§5.3）与落盘装配 ──────────────────

  private analyzeSession(trigger: SessionEndTrigger, now: Date): SessionEndAnalysis {
    const session = this.session!;
    const records = session.records.filter((r) => !r.revoked);
    const wrongs = records.filter((r) => r.grade === 'wrong').length;
    const corrects = records.filter((r) => r.grade === 'correct').length;
    const struggleWin = records.some((r) => r.struggleWin === true);
    const expiresAt = new Date(now.getTime() + MIND_STATE_TTL_MS).toISOString();

    let mindText: string;
    if (this.consecutiveSkips >= 2) mindText = '今天节奏偏散，可能不想学这块，换个轻一点的入口更好';
    else if (wrongs > 0) mindText = '今天有几处卡壳，不着急，先把这几块垫起来';
    else if (struggleWin) mindText = '有"挣扎后想起来"的好信号，提取练习在起作用';
    else if (corrects >= 2) mindText = '今天状态在线，节奏可以保持';
    else if (records.length === 0 && (trigger === 'idle_90s' || trigger === 'enter_background')) {
      mindText = '今天停留了一会儿但没作答，下次从一张卡开始就行';
    } else mindText = '今天完成了一轮学习，收工不欠账';
    const mindState: MindState = { text: mindText, expiresAt };

    // 偏好修正：仅"明确声明或 ≥2 次"进入 pendingBoundaries（防噪音，§5.3）
    const preferenceUpdates: PreferenceUpdate[] = this.pendingBoundaries.map((p) => ({
      op: p.op,
      boundary: p.boundary,
    }));

    const stuckAt = session.records.filter((r) => r.grade === 'wrong' && !r.revoked).map((r) => r.aluId);
    let nextAdjustment: string;
    if (stuckAt.length > 0) {
      const alu = this.alus[stuckAt[0]];
      nextAdjustment = alu ? `下次先从「${alu.front}」补讲开始（${stuckAt[0]}）` : `下次先补 ${stuckAt[0]}`;
    } else if (struggleWin) nextAdjustment = '保持"先想再翻"的提取节奏，模糊后想起来的最有价值';
    else if (this.consecutiveSkips >= 2) nextAdjustment = '下次先来 90 秒快速唤醒，不直接进重内容';
    else nextAdjustment = '节奏刚好，按今日计划继续';

    return { mindState, preferenceUpdates, nextAdjustment };
  }

  private applyAnalysisToProfile(analysis: SessionEndAnalysis): void {
    for (const update of analysis.preferenceUpdates) {
      this.profile = this.withBoundary(update.boundary);
    }
  }

  private withBoundary(boundary: PreferenceBoundary): LearnerProfile {
    // 以 text 为键去重（与 domain.observeBoundary 的匹配键一致；id 含时间戳存在同刻撞车）
    const boundaries = this.profile.preferences.boundaries.filter((b) => b.text !== boundary.text);
    return {
      ...this.profile,
      preferences: { ...this.profile.preferences, boundaries: [...boundaries, boundary] },
    };
  }

  private describeWhatHappened(): string {
    const session = this.session!;
    const records = session.records.filter((r) => !r.revoked);
    const c = records.filter((r) => r.grade === 'correct').length;
    const f = records.filter((r) => r.grade === 'fuzzy').length;
    const w = records.filter((r) => r.grade === 'wrong').length;
    const rem = session.completedRemediations.length;
    return `${session.skill} 会话：${String(records.length)} 次作答（对 ${String(c)}/模糊 ${String(f)}/错 ${String(w)})${rem > 0 ? `，补讲 ${String(rem)} 次` : ''}`;
  }

  /** 会话内 FSRS 卡与作答记录回合边界合入用户状态（§7.7）。 */
  private mergeSessionIntoStates(): void {
    const session = this.session!;
    const now = this.clock().toISOString();
    for (const [aluId, card] of Object.entries(session.cards) as [AluId, Card][]) {
      const base = this.states[aluId];
      if (base) this.states[aluId] = { ...base, fsrs: card, updatedAt: now };
    }
    for (const record of session.records) {
      const base = this.states[record.aluId];
      if (base) this.states[record.aluId] = { ...pushAnswerRecord(base, record), updatedAt: now };
    }
  }

  private ensureEnqueuedState(aluId: AluId, now: Date): void {
    if (this.states[aluId]) return;
    const fromMode = this.session!.skill === 'deep-learning' ? 'deep' : 'standard';
    this.states[aluId] = createEnqueuedState(aluId, now, fromMode); // 学过一轮入队，due=T+1
  }

  private chunkIdOf(aluId: AluId): string {
    const alu = this.alus[aluId];
    if (!alu) return `unknown:${aluId}`;
    const loc = alu.source.locator;
    return loc.kind === 'span'
      ? `${alu.source.docId}#span-${String(loc.start)}-${String(loc.end)}`
      : `${alu.source.docId}#url`;
  }

  private recordActivationSample(
    scenario: string,
    skill: SkillName,
    source: ActivationResult['source'],
    outcome: 'hit' | 'miss',
    negativeExample: boolean,
    detail: string,
  ): void {
    this.metrics.recordActivation({
      at: new Date().toISOString(),
      scenario,
      expectedSkill: skill,
      activatedSkill: skill,
      source,
      outcome,
      negativeExample,
      detail,
    });
  }

  private resetSessionScratch(): void {
    this.queue = [];
    this.cursor = 0;
    this.currentAlu = null;
    this.fuzzyPresented = new Set();
    this.variantDone = new Set();
    this.pendingVariant = false;
    this.consecutiveSkips = 0;
    this.history = [];
    this.pendingRetrieved = [];
    this.pendingBoundaries = [];
    this.observedBoundaries = [];
    this.boundedInjected = false;
    this.wrapUpDone = false;
  }
}
