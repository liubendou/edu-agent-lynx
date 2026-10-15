/**
 * 会话状态机（ARCHITECTURE §4 / PRD §4.5/§4.6/§10.2）。
 * 三条硬规则代码强制（§7.9"能硬约束就别用软提示"）：
 *  1. 快速档不产生复习欠账（judge 不写 FSRS、card_generation 禁用）；
 *  2. card_generated 仅 standard/deep 可发（事件工厂类型+运行时双重强制）；
 *  3. 复习失败自动拉起 90 秒补讲子会话，补完重新入队（间隔按答错处理）。
 * fuzzy 处置（D8）：触发"再讲一遍"、本轮稍后重现、不写 FSRS、不产生新欠账。
 * struggleWin：fuzzy→correct 高价值正反馈；"比上次错得少"派生信号。
 */
import type { Card, FSRS } from 'ts-fsrs';
import type { AnswerRecord, PrereqGraph } from './alu';
import type { AluId, Grade, ISODate, SkillName } from './types';
import type { SkillParams } from './types';
import { canTransition, tracePrereqSuspects } from './alu';
import { deriveStatus, scheduleReview } from './fsrs';
import {
  createAluStatusEvent,
  createAnswerEvent,
  createCardGeneratedEvent,
  createJudgeEvent,
  createRemediationDone,
  createRemediationStart,
  createSessionEndEvent,
  createSessionStart,
  type SessionEvent,
} from './events';
import type { SessionEndAnalysis, SessionEndTrigger, SessionSummary } from './profile';

/** 补讲子会话时长（硬规则3：标准档 90 秒）。 */
export const REMEDIATION_DURATION_MS = 90_000;

/** 硬规则2：card_generated 唯一入口 = standard/deep 讲完并自检过。 */
export function allowsCardGeneration(skill: SkillName): boolean {
  return skill === 'standard-learning' || skill === 'deep-learning';
}

export interface RemediationSubSession {
  aluId: AluId;
  startedAt: ISODate;
  /** 90 秒预算的到期时刻（ISODate） */
  deadline: ISODate;
}

export interface SessionState {
  sessionId: string;
  skill: SkillName;
  aluIds: AluId[];
  params: SkillParams;
  startedAt: ISODate;
  /** 会话内全部作答记录（含 fuzzy，D8；撤销标 revoked） */
  records: AnswerRecord[];
  /** fuzzy 卡"本轮稍后重现"队列（不产生新欠账，D8） */
  fuzzyRequeue: AluId[];
  /** 活跃补讲子会话（复习失败自动拉起；一次至多一个，F7 生命周期挂主会话） */
  activeRemediation: RemediationSubSession | null;
  /** 已完成补讲（requeued=补完重新入队，间隔按答错处理） */
  completedRemediations: { aluId: AluId; requeued: boolean }[];
  /** 会话内 FSRS 卡（review 档 judge 写入；key=aluId） */
  cards: Record<AluId, Card>;
  /** 已发出的领域事件（埋点同源，§7.8④） */
  events: SessionEvent[];
  /** 每卡最近一次可撤销写入的回滚信息（1s 撤销窗口，UID §三） */
  revocable: Record<AluId, { prevCard?: Card; record: AnswerRecord }>;
  ended: boolean;
}

export interface StartSessionInput {
  sessionId: string;
  skill: SkillName;
  aluIds: AluId[];
  params: SkillParams;
  now: Date;
  /** 复习档会话需传入当前各卡 FSRS 状态（key=aluId） */
  cards?: Record<AluId, Card>;
}

export function startSession(input: StartSessionInput): SessionState {
  const params: SkillParams = input.skill === 'quick-learning'
    ? { ...input.params, cardGeneration: false } // 硬规则1：快速档不产生复习欠账
    : input.params;
  const state: SessionState = {
    sessionId: input.sessionId,
    skill: input.skill,
    aluIds: [...input.aluIds],
    params,
    startedAt: input.now.toISOString(),
    records: [],
    fuzzyRequeue: [],
    activeRemediation: null,
    completedRemediations: [],
    cards: { ...input.cards },
    events: [createSessionStart({
      sessionId: input.sessionId,
      skill: input.skill,
      aluIds: [...input.aluIds],
      params,
      at: input.now.toISOString(),
    })],
    revocable: {},
    ended: false,
  };
  return state;
}

export interface JudgeInput {
  aluId: AluId;
  grade: Grade;
  latencyMs: number;
  now: Date;
  /** 依赖图（wrong 时前置归因用；缺省不追溯） */
  prereqGraph?: PrereqGraph;
  scheduler?: FSRS;
  /** 覆盖"写 FSRS 的档位"判定：默认仅 review 档写（standard/deep 插问与补讲子会话不写） */
  applyFsrs?: boolean;
}

export interface JudgeOutput {
  state: SessionState;
  record: AnswerRecord;
  events: SessionEvent[];        // 本次判定新增事件（含 answer/judge/状态跃迁/remediation_start）
  fsrsApplied: boolean;
  prereqSuspect: AluId[] | null; // wrong 时的前置嫌疑（§4.6②，F1）
  remediationStarted: boolean;   // 是否自动拉起 90 秒补讲（硬规则3）
}

/** 会话内该卡此前是否有未撤销的 fuzzy（struggleWin 判定依据，D8）。 */
function hasSessionFuzzy(records: AnswerRecord[], aluId: AluId): boolean {
  return records.some((r) => r.aluId === aluId && r.grade === 'fuzzy' && !r.revoked);
}

/**
 * 判定三档。写 FSRS 的口径：仅 review 档到期卡的 correct/wrong（fuzzy 恒不写，D8；
 * quick 建立地图不产生欠账——硬规则1；standard/deep 插问与补讲子会话不写 FSRS）。
 */
export function judgeAnswer(state: SessionState, input: JudgeInput): JudgeOutput {
  if (state.ended) throw new Error('session already ended');
  const { aluId, grade, latencyMs, now } = input;
  const at = now.toISOString();
  const events: SessionEvent[] = [];

  const shouldApplyFsrs = input.applyFsrs ?? (state.skill === 'review');
  const fsrsApplied = grade !== 'fuzzy' && shouldApplyFsrs;

  // 1) 作答记录（fuzzy 也会话内留存，D8；correct 且此前有 fuzzy → struggleWin，§10.2）
  const record: AnswerRecord = {
    aluId,
    grade,
    latencyMs,
    skill: state.skill,
    at,
    ...(grade === 'correct' && hasSessionFuzzy(state.records, aluId) ? { struggleWin: true } : {}),
  };
  events.push(createAnswerEvent(record));

  // 2) FSRS 更新（仅 review 档 correct/wrong）
  let newCard: Card | undefined;
  let prevCard: Card | undefined;
  if (fsrsApplied) {
    const current = state.cards[aluId];
    if (!current) throw new Error(`judge: no FSRS card for ${aluId} in review session`);
    prevCard = current;
    newCard = scheduleReview(current, grade, now, input.scheduler ? { scheduler: input.scheduler } : {})
      .card;
  }

  // 3) 前置归因（wrong 时沿依赖图上游追溯，§4.6②/F1）
  let prereqSuspect: AluId[] | null = null;
  if (grade === 'wrong' && input.prereqGraph) {
    prereqSuspect = tracePrereqSuspects(aluId, input.prereqGraph);
  }

  events.push(createJudgeEvent({
    aluId, grade, fsrsApplied,
    ...(prereqSuspect !== null ? { prereqSuspect } : {}),
    at,
  }));

  // 4) 硬规则3：review 档 wrong → 自动拉起 90 秒补讲子会话（不重复拉起）
  let remediationStarted = false;
  const inRemediationQueue = state.activeRemediation?.aluId === aluId
    || state.completedRemediations.some((r) => r.aluId === aluId);
  if (grade === 'wrong' && state.skill === 'review' && !inRemediationQueue) {
    remediationStarted = true;
    events.push(createRemediationStart(aluId));
  }

  // 5) fuzzy 处置（D8）：本轮稍后重现、不产生新欠账（不写 FSRS、不拉补讲）
  const fuzzyRequeue = [...state.fuzzyRequeue];
  if (grade === 'fuzzy' && !fuzzyRequeue.includes(aluId)) fuzzyRequeue.push(aluId);
  // 同卡其后答对/答错 → 不再要求重现
  if (grade !== 'fuzzy') {
    const idx = fuzzyRequeue.indexOf(aluId);
    if (idx >= 0) fuzzyRequeue.splice(idx, 1);
  }

  // 6) 状态跃迁事件（Review 卡 FSRS 更新后按映射刷新）
  if (newCard) {
    const nextStatus = deriveStatus(newCard, { lastGrade: grade });
    const prevStatus = deriveStatus(prevCard!);
    if (prevStatus !== nextStatus && canTransition(prevStatus, nextStatus)) {
      events.push(createAluStatusEvent(aluId, prevStatus, nextStatus));
    }
  }

  const next: SessionState = {
    ...state,
    records: [...state.records, record],
    fuzzyRequeue,
    cards: newCard ? { ...state.cards, [aluId]: newCard } : state.cards,
    activeRemediation: remediationStarted
      ? {
          aluId,
          startedAt: at,
          deadline: new Date(now.getTime() + REMEDIATION_DURATION_MS).toISOString(),
        }
      : state.activeRemediation,
    revocable: { ...state.revocable, [aluId]: { ...(prevCard !== undefined ? { prevCard } : {}), record } },
    events: [...state.events, ...events],
  };
  return { state: next, record, events, fsrsApplied, prereqSuspect, remediationStarted };
}

/** fuzzy"本轮稍后重现"：取出下一张待重现卡（无则 null）。 */
export function popFuzzyRequeue(state: SessionState): AluId | null {
  if (state.fuzzyRequeue.length === 0) return null;
  return state.fuzzyRequeue[0];
}

/** 补讲子会话完成：补完重新入队（间隔已按答错处理——wrong 时 FSRS Again 已写入），发 remediation_done。 */
export function completeRemediation(state: SessionState, aluId: AluId): SessionState {
  if (state.activeRemediation?.aluId !== aluId) return state;
  const event = createRemediationDone(aluId, true); // requeued=true：间隔按答错处理（硬规则3）
  return {
    ...state,
    activeRemediation: null,
    completedRemediations: [...state.completedRemediations, { aluId, requeued: true }],
    events: [...state.events, event],
  };
}

/** 补讲超时（90 秒预算耗尽）：同样按答错间隔重新入队。 */
export function expireRemediation(state: SessionState, now: Date): SessionState {
  const sub = state.activeRemediation;
  if (!sub) return state;
  if (new Date(sub.deadline).getTime() > now.getTime()) return state; // 未到 90 秒不强制结束
  return {
    ...state,
    activeRemediation: null,
    completedRemediations: [...state.completedRemediations, { aluId: sub.aluId, requeued: true }],
    events: [...state.events, createRemediationDone(sub.aluId, true)],
  };
}

/**
 * 硬规则2 代码强制入口：standard/deep 讲完并自检过 → 生成复习卡。
 * quick/review 档调用即抛错。事件同时进会话事件流。
 */
export function emitCardGenerated(
  state: SessionState,
  aluIds: AluId[],
  sourceChunkId: string,
): { state: SessionState; event: SessionEvent } {
  if (!allowsCardGeneration(state.skill)) {
    throw new Error(`card_generated forbidden in skill '${state.skill}' (硬规则2：仅 standard/deep 可发)`);
  }
  const event = createCardGeneratedEvent({ aluIds, sourceChunkId, skill: state.skill as 'standard-learning' | 'deep-learning' });
  return { state: { ...state, events: [...state.events, event] }, event };
}

/** 1 秒撤销窗口（UID §三）：撤销该卡最近一次作答——记录标 revoked、FSRS 卡回滚；撤销不计入 FSRS/日志。 */
export function revokeAnswer(state: SessionState, aluId: AluId): { state: SessionState; record: AnswerRecord | null } {
  const entry = state.revocable[aluId];
  if (!entry) return { state, record: null };
  const records = state.records.map((r) => (r === entry.record ? { ...r, revoked: true } : r));
  const cards = entry.prevCard !== undefined
    ? { ...state.cards, [aluId]: entry.prevCard }
    : state.cards;
  const revocable = { ...state.revocable };
  delete revocable[aluId];
  return {
    state: { ...state, records, cards, revocable },
    record: { ...entry.record, revoked: true },
  };
}

/** 会话结束（触发见 §5.2；分析三产出见 §5.3）。 */
export function endSession(
  state: SessionState,
  trigger: SessionEndTrigger,
  analysis: SessionEndAnalysis,
  now: Date,
): SessionState {
  const event = createSessionEndEvent({
    sessionId: state.sessionId,
    trigger,
    analysis,
    at: now.toISOString(),
  });
  return { ...state, ended: true, events: [...state.events, event] };
}

/** "比上次错得少"派生信号（§10.2 信号2）：同卡最近一条 correct 且其前一条 wrong。 */
export function improvedSinceLastWrong(records: AnswerRecord[], aluId: AluId): boolean {
  const cardRecords = records.filter((r) => r.aluId === aluId && !r.revoked);
  if (cardRecords.length < 2) return false;
  const last = cardRecords[cardRecords.length - 1];
  const prev = cardRecords[cardRecords.length - 2];
  return last.grade === 'correct' && prev.grade === 'wrong';
}

/** 构建会话摘要（§5.1 D 层）：stuckAt = 答错（含补讲）的卡去重。 */
export function buildSessionSummary(
  state: SessionState,
  opts: { whatHappened: string; nextSuggestion: string; mindState?: SessionSummary['mindState'] },
  now: Date,
): SessionSummary {
  const stuckAt: AluId[] = [];
  for (const r of state.records) {
    if (r.grade === 'wrong' && !r.revoked && !stuckAt.includes(r.aluId)) stuckAt.push(r.aluId);
  }
  return {
    sessionId: state.sessionId,
    skill: state.skill,
    at: now.toISOString(),
    whatHappened: opts.whatHappened,
    stuckAt,
    nextSuggestion: opts.nextSuggestion,
    ...(opts.mindState !== undefined ? { mindState: opts.mindState } : {}),
  };
}
