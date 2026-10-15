/**
 * 今日决策（CONTRACTS §3 / PRD §5.6/§6）：首页"今天该学的一件事"。
 * 优先级（用户已裁决 D10，总控 §0.1）：到期复习（R 升序）> 当日补讲 > 新学建议。
 * 端侧本地计算、离线即时渲染。保持率催收：目标期限临近 → 调高 requestRetention、压缩新学（§5.6）。
 */
import type { Goal } from './profile';
import { pickReviewBatch } from './queue';
import type { DailyBudget, QueueItem } from './queue';
import type { AluId, ISODate, ModuleId } from './types';

/** 今日决策（CONTRACTS §3，逐字一致）。 */
export type TodayDecision =
  | { kind: 'first_run' }                                          // 首启：方案 D 元课程小课（§6）
  | { kind: 'review'; batch: QueueItem[]; remediationCount: number } // 复习欠账优先
  | { kind: 'remediation'; aluIds: AluId[] }                       // 补讲（复习答错待补）
  | { kind: 'new_learn'; suggestion: { aluId?: AluId; moduleId?: ModuleId }; reason: string }; // 新学建议（含个性化理由，§2 牵引3）

/** 回访第一屏 TodayPlanPanel 数据（UID §2.2：三行、端侧算、零等待）。 */
export interface TodayPlan {
  dueCount: number;          // "复习 N 张到期卡"
  remediationCount: number;  // "补讲 X"
  suggestion: Exclude<TodayDecision, { kind: 'first_run' }>; // "今天建议学的一条"（回访首屏不出现 first_run，F6 收窄）
  generatedAt: ISODate;      // 端侧生成时间（不进云侧前缀，§7.6）
}

// ── 保持率催收（§5.6：复习节奏 = 活跃时段 + 目标期限；临近就调高保持率、压缩新内容） ──

/** 默认催收参数（V1 技术默认值，参数化可调；无产品裁决值，见汇报说明）。 */
export const RETENTION_PRESS = {
  pressDays: 7,      // deadline ≤7 天 → 催收档
  urgentDays: 3,     // deadline ≤3 天 → 紧急档
  pressRetention: 0.92,
  urgentRetention: 0.95,
  baseRetention: 0.9, // §4.6① 默认目标保持率
} as const;

export interface RetentionPressure {
  /** 建议请求保持率（createScheduler 入参）；无期限压力时 = 0.9 */
  requestRetention: number;
  /** 是否压缩新学（§5.6"临近就压缩新内容"） */
  compressNewLearn: boolean;
  /** 最近的目标期限剩余天数（无有效期限为 null） */
  daysToDeadline: number | null;
}

/** 计算保持率催收压力：取未过期目标中最近的 deadline。 */
export function retentionPressure(
  goals: Goal[],
  now: Date,
  opts: Partial<typeof RETENTION_PRESS> = {},
): RetentionPressure {
  const cfg = { ...RETENTION_PRESS, ...opts };
  const deadlines = goals
    .map((g) => g.deadline)
    .filter((d): d is string => typeof d === 'string')
    .map((d) => new Date(d).getTime())
    .filter((t) => Number.isFinite(t) && t >= now.getTime())
    .sort((a, b) => a - b);
  if (deadlines.length === 0) {
    return { requestRetention: cfg.baseRetention, compressNewLearn: false, daysToDeadline: null };
  }
  const daysToDeadline = (deadlines[0] - now.getTime()) / 86_400_000;
  if (daysToDeadline <= cfg.urgentDays) {
    return { requestRetention: cfg.urgentRetention, compressNewLearn: true, daysToDeadline };
  }
  if (daysToDeadline <= cfg.pressDays) {
    return { requestRetention: cfg.pressRetention, compressNewLearn: true, daysToDeadline };
  }
  return { requestRetention: cfg.baseRetention, compressNewLearn: false, daysToDeadline };
}

// ── 决策 ─────────────────────────────────────────────

export interface DecisionInput {
  /** 到期队列候选（R 升序由 pickReviewBatch 内部排序保证） */
  dueItems: QueueItem[];
  budget: DailyBudget;
  /** 当日补讲列表（复习答错待补） */
  remediationAluIds: AluId[];
  /** 新学建议候选（可选） */
  newSuggestion?: { aluId?: AluId; moduleId?: ModuleId };
  /** 目标（用于保持率催收） */
  goals?: Goal[];
  /** 首启（无任何待办与记录） */
  isFirstRun?: boolean;
  now?: Date;
}

/** 决策结果：decision 契约逐字一致；reason 为端侧可解释字段（不进契约类型）。 */
export interface TodayResult {
  decision: TodayDecision;
  /** 一句话理由（可解释性；PRD §2 牵引3"个性化理由"） */
  reason: string;
  pressure: RetentionPressure;
}

/** 今日决策（D10 优先级：到期复习（R 升序）> 当日补讲 > 新学建议）。 */
export function decideToday(input: DecisionInput): TodayResult {
  const now = input.now ?? new Date();
  const pressure = retentionPressure(input.goals ?? [], now);

  if (input.isFirstRun) {
    return {
      decision: { kind: 'first_run' },
      reason: '首启：无任何待办与记录，进入方案 D 元课程小课',
      pressure,
    };
  }

  if (input.dueItems.length > 0) {
    const batch = pickReviewBatch(input.dueItems, input.budget.reviewCards);
    return {
      decision: { kind: 'review', batch, remediationCount: input.remediationAluIds.length },
      reason: `有 ${input.dueItems.length} 张到期卡，先还欠账（R 升序，一次只还 3~6 张）`,
      pressure,
    };
  }

  if (input.remediationAluIds.length > 0) {
    return {
      decision: { kind: 'remediation', aluIds: input.remediationAluIds },
      reason: `无到期复习，有 ${input.remediationAluIds.length} 条当日补讲待完成`,
      pressure,
    };
  }

  const suggestion = input.newSuggestion ?? {};
  const compressNote = pressure.compressNewLearn
    ? `；目标期限临近（剩 ${Math.ceil(pressure.daysToDeadline ?? 0)} 天），新学已压缩、保持率上调至 ${pressure.requestRetention}`
    : '';
  return {
    decision: {
      kind: 'new_learn',
      suggestion: {
        ...(suggestion.aluId !== undefined ? { aluId: suggestion.aluId } : {}),
        ...(suggestion.moduleId !== undefined ? { moduleId: suggestion.moduleId } : {}),
      },
      reason: `无到期复习与补讲，为你准备新内容${compressNote}`,
    },
    reason: `今日无欠账，建议新学${compressNote}`,
    pressure,
  };
}

/** 构建回访第一屏 TodayPlan（端侧生成时间不进云侧前缀，§7.6）。 */
export function buildTodayPlan(input: {
  dueCount: number;
  remediationCount: number;
  suggestion: Exclude<TodayDecision, { kind: 'first_run' }>;
  now?: Date;
}): TodayPlan {
  return {
    dueCount: input.dueCount,
    remediationCount: input.remediationCount,
    suggestion: input.suggestion,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
