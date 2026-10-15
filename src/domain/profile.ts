/**
 * 画像四层与触发（CONTRACTS §4 / PRD §5，逐字一致）+ 防噪音/截尾/TTL 辅助。
 */
import type { Alu, AluUserState, AnswerRecord } from './alu';
import { deriveStatus } from './fsrs';
import { State } from 'ts-fsrs';
import type { AluId, ISODate, ModuleId, SkillName } from './types';

/** A. 学习事实层（原子级，§5.1） */
export interface LearningFacts {
  answerEvents: AnswerRecord[];            // 逐条原子级（§5.4）
  gradeEvents: GradeEvent[];               // 成绩事件（入口=拍照解析，D4：tools/grade-entry.ts；解析失败兜底手动录入）
  goals: Goal[];                           // 目标+期限+预估投入
}
/** 成绩事件（§5.1 A：科目、时间、总分、分项、错因四分类）。
 *  D4 入口链路：拍照 → 识图链路解析（tools/grade-entry.ts，M6）→ 端侧只存结构化数字
 *  （§5.5 不存原图、不用于训练）→ GradeEvent 入库（ProfilePage 入口）；解析失败 → 手动录入兜底。 */
export interface GradeEvent {
  id: string; subject: string; at: ISODate;
  total: number; sections: { name: string; score: number; full: number }[];
  errorCauses: ErrorCauseDistribution;     // 错因四分类
}
export type ErrorCause = 'unknown' | 'misapplied' | 'misread' | 'calculation'; // 不会/会用错/审题/计算
export type ErrorCauseDistribution = Record<ErrorCause, number>;
export interface Goal { text: string; deadline?: ISODate; estimatedHours?: number; createdAt: ISODate }

/** B. 能力画像层（派生，§5.1） */
export interface AbilityProfile {
  moduleMastery: Record<ModuleId, { avgStability: number; avgDifficulty: number; consolidatedRatio: number }>; // 板块 ALU 的 S/D 聚合
  errorCauseDistribution: ErrorCauseDistribution;   // 错因分布 → 定向补漏专项（§5.6）
  rhythm: { preferredDurationMin: number; activeHours: number[]; acceptableDifficulty: number }; // 学习节奏画像
}

/** C. 偏好与边界层（§5.1：硬约束，写入所有 Skill 输出约束） */
export interface Preferences {
  boundaries: PreferenceBoundary[];  // "介意/不喜欢"，硬约束
  traits: StableTraits;              // 零散但稳定
  tts: { rate: number; voice: string }; // 语速/音色偏好（§7.3 接画像）
}
export interface PreferenceBoundary {
  id: string; text: string;          // 如 "别用太多类比"/"不喜欢被问'听懂了吗'"
  source: 'declared' | 'observed';   // 明确声明 或 出现≥2次（§5.3 防噪音）
  observedCount: number; createdAt: ISODate;
}
export interface StableTraits { locale: string; grade?: string; profession?: string; isExamPrep?: boolean; notes: string[] }

/** D. 会话摘要层（§5.1/§5.3） */
export interface SessionSummary {
  sessionId: string; skill: SkillName; at: ISODate;
  whatHappened: string;             // 做了什么
  stuckAt: AluId[];                 // 卡在哪
  nextSuggestion: string;           // 下次建议
  mindState?: MindState;            // 一句心理状态推断（短期带 TTL）
}
export interface MindState { text: string; expiresAt: ISODate } // TTL 过期即弃（§5.4/§5.5）

/** 画像根（storage/repos/profile 持久化单元） */
export interface LearnerProfile {
  facts: LearningFacts;
  ability: AbilityProfile;
  preferences: Preferences;
  sessionSummaries: SessionSummary[]; // 截尾保留最近 N=50
  version: number;
}

/** 触发规则（§5.2 三类）——领域事件定义 */
export type ProfileTrigger =
  | { type: 'event'; event: AnswerRecord | GradeEvent | 'mode_switch' | 'skip' | 'long_stay' | 'abandon' | 'boundary_declared' } // 即时、轻量、本地
  | { type: 'periodic'; reason: 'session_10min' | 'interactions_8' }   // 会话内刷新能力画像层
  | { type: 'session_end'; trigger: SessionEndTrigger };                // 会话尾主动分析

export type SessionEndTrigger = 'idle_90s' | 'enter_background' | 'skip_twice' | 'goodbye'; // §5.2

/** 会话结束分析三产出（§5.3） */
export interface SessionEndAnalysis {
  mindState: MindState;                        // ① 心理状态推断（短期带 TTL）
  preferenceUpdates: PreferenceUpdate[];       // ② 仅"明确声明或≥2次"落库（防噪音）
  nextAdjustment: string;                      // ③ 对下次交互的一条具体调整建议
}
export type PreferenceUpdate = { op: 'add' | 'revise'; boundary: PreferenceBoundary };

// AnswerRecord 从 ./alu re-export（CONTRACTS §1 定义、§4/§9 引用）
export type { AnswerRecord } from './alu';

// ── 画像辅助（纯函数） ────────────────────────────────

/** 会话摘要截尾上限（CONTRACTS §4：截尾保留最近 N=50）。 */
export const MAX_SESSION_SUMMARIES = 50;

export const EMPTY_ERROR_CAUSE_DISTRIBUTION: ErrorCauseDistribution = {
  unknown: 0, misapplied: 0, misread: 0, calculation: 0,
};

export function createEmptyProfile(): LearnerProfile {
  return {
    facts: { answerEvents: [], gradeEvents: [], goals: [] },
    ability: {
      moduleMastery: {},
      errorCauseDistribution: { ...EMPTY_ERROR_CAUSE_DISTRIBUTION },
      rhythm: { preferredDurationMin: 10, activeHours: [], acceptableDifficulty: 3 },
    },
    preferences: {
      boundaries: [],
      traits: { locale: 'zh-CN', notes: [] },
      tts: { rate: 1, voice: 'default' },
    },
    sessionSummaries: [],
    version: 1,
  };
}

/**
 * 偏好防噪音（§5.3/§5.4）：观察到的边界仅出现 ≥2 次才落库；
 * 明确声明的（source='declared'）直接落库。返回更新后的边界与是否应持久化。
 */
export function observeBoundary(
  preferences: Preferences,
  text: string,
  now: Date,
): { boundary: PreferenceBoundary; shouldPersist: boolean } {
  const iso = now.toISOString();
  const existing = preferences.boundaries.find((b) => b.text === text);
  if (existing) {
    const boundary: PreferenceBoundary = { ...existing, observedCount: existing.observedCount + 1 };
    return { boundary, shouldPersist: existing.source === 'declared' || boundary.observedCount >= 2 };
  }
  return {
    boundary: { id: `pb-${now.getTime()}`, text, source: 'observed', observedCount: 1, createdAt: iso },
    shouldPersist: false, // 第一次观察：不落库（防噪音）
  };
}

/** 明确声明的边界（即时落库）。 */
export function declareBoundary(
  preferences: Preferences,
  text: string,
  now: Date,
): PreferenceBoundary {
  const iso = now.toISOString();
  const existing = preferences.boundaries.find((b) => b.text === text);
  if (existing) {
    return { ...existing, source: 'declared' };
  }
  return { id: `pb-${now.getTime()}`, text, source: 'declared', observedCount: 1, createdAt: iso };
}

/** 心理状态 TTL：过期即弃（§5.4/§5.5）。 */
export function isMindStateExpired(mindState: MindState, now: Date): boolean {
  return new Date(mindState.expiresAt).getTime() <= now.getTime();
}

/** 追加会话摘要（截尾保留最近 50 条）。 */
export function appendSessionSummary(profile: LearnerProfile, summary: SessionSummary): LearnerProfile {
  return {
    ...profile,
    sessionSummaries: [...profile.sessionSummaries, summary].slice(-MAX_SESSION_SUMMARIES),
  };
}

/** 周期触发判定（§5.2：会话 ≥10 分钟 或 交互 ≥8 次）。 */
export function shouldTriggerPeriodic(
  sessionMinutes: number,
  interactionCount: number,
): ProfileTrigger | null {
  if (sessionMinutes >= 10) return { type: 'periodic', reason: 'session_10min' };
  if (interactionCount >= 8) return { type: 'periodic', reason: 'interactions_8' };
  return null;
}

/** 会话结束触发判定（§5.2：空闲>90s | 退后台 | 连续 2 次跳过 | 主动再见）。 */
export function detectSessionEndTrigger(signals: {
  idleMs?: number; enteredBackground?: boolean; consecutiveSkips?: number; saidGoodbye?: boolean;
}): SessionEndTrigger | null {
  if (signals.saidGoodbye) return 'goodbye';
  if (signals.enteredBackground) return 'enter_background';
  if ((signals.consecutiveSkips ?? 0) >= 2) return 'skip_twice';
  if ((signals.idleMs ?? 0) > 90_000) return 'idle_90s';
  return null;
}

/**
 * 周期触发时刷新能力画像层（§5.1 B：派生）：
 * moduleMastery = 该板块入队 ALU 的 S/D 聚合 + 已稳固占比（D5 阈值）；
 * errorCauseDistribution = 成绩事件错因聚合。
 */
export function deriveAbilityProfile(
  profile: LearnerProfile,
  alus: Alu[],
  states: AluUserState[],
  opts: { consolidatedDays?: number } = {},
): AbilityProfile {
  const mastery: AbilityProfile['moduleMastery'] = {};
  const byModule = new Map<ModuleId, { s: number; d: number; consolidated: number; total: number }>();
  const stateByAlu = new Map<AluId, AluUserState>();
  for (const s of states) stateByAlu.set(s.aluId, s);
  for (const alu of alus) {
    const state = stateByAlu.get(alu.id);
    if (!state || state.fsrs.state === State.New /* 未入队不计 */) continue;
    const entry = byModule.get(alu.moduleId) ?? { s: 0, d: 0, consolidated: 0, total: 0 };
    entry.s += state.fsrs.stability;
    entry.d += alu.difficulty;
    entry.total += 1;
    if (deriveStatus(state.fsrs, opts) === 'consolidated') entry.consolidated += 1;
    byModule.set(alu.moduleId, entry);
  }
  byModule.forEach((e, moduleId) => {
    mastery[moduleId] = {
      avgStability: e.total > 0 ? e.s / e.total : 0,
      avgDifficulty: e.total > 0 ? e.d / e.total : 0,
      consolidatedRatio: e.total > 0 ? e.consolidated / e.total : 0,
    };
  });
  const errorCauses: ErrorCauseDistribution = { ...EMPTY_ERROR_CAUSE_DISTRIBUTION };
  for (const ev of profile.facts.gradeEvents) {
    for (const key of Object.keys(errorCauses) as ErrorCause[]) {
      errorCauses[key] += ev.errorCauses[key] ?? 0;
    }
  }
  return { ...profile.ability, moduleMastery: mastery, errorCauseDistribution: errorCauses };
}
