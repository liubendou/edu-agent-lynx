/**
 * 实时难度调节（PRD §10.1③/§10.1④，ARCHITECTURE §4 SessionLoop 内 difficulty 钩子）。
 *  - 答得快又对 → 立刻升难度 / 给变式；
 *  - 卡住 → 先降难度、给脚手架，不直接判错（"卡住"是独立 observation，不产生 grade）；
 *  - 复习档特殊处理：调节拍速度不调难度（提取练习本就要"难"，§10.1④）。
 *
 * 目标成功率锚点（交互层）：quick 0.9 / review 0.85 / standard 0.8 / deep 0.75。
 * 注意：这是【交互层目标成功率】，与 FSRS 的 0.9【记忆层保持率】是两套独立指标
 * （PRD §10.1③"别混淆两套指标"，F16）；deep 取 PRD"70~80%"区间中点单值、可配置。
 */
import type { Grade, SkillName } from '../domain/types';

/** 四档交互层目标成功率常量（§10.1③；deep 取中可配）。与 FLOW_PARAMS.targetSuccessRate 同源。 */
export const TARGET_SUCCESS_RATE: Readonly<Record<SkillName, number>> = {
  'quick-learning': 0.9,
  review: 0.85,
  'standard-learning': 0.8,
  'deep-learning': 0.75, // 70~80% 中点；V1 固定默认，参数化可调（F16）
};

/** "答得快"阈值：correct 且 latency < 此值 → 升难度/给变式（§10.1③）。 */
export const FAST_CORRECT_MS = 10_000;
/** "卡住"阈值：作答前停留超时/主动求助 → 降难度给脚手架、不判错。 */
export const STUCK_LATENCY_MS = 45_000;
/** 成功率锚点带宽：偏离目标 ±0.05 以上才动手调节（防抖动）。 */
export const SUCCESS_BAND = 0.05;

/** 难度/节拍指令（并入回合 directives；up/down 另发 difficulty_adjust 领域事件）。 */
export interface DifficultyDirective {
  kind: 'up' | 'down' | 'pace_up' | 'pace_down' | 'hold';
  reason: string;
  /** 给用户的脚手架话术（down 时给出） */
  message?: string;
}

export interface DifficultyContext {
  skill: SkillName;
  /** 本次作答档位（有作答才有；stuck 无 grade） */
  grade?: Grade;
  latencyMs?: number;
  /** 用户卡住（求助/超时 observation）——尚未判错 */
  stuck: boolean;
  /** 会话内近期作答（不含 revoked/fuzzy 也可含，按 correct 计成功） */
  recentGrades: Grade[];
}

/** 会话内成功率（correct / 非 fuzzy 作答数）。 */
export function successRateOf(recentGrades: Grade[]): number {
  const graded = recentGrades.filter((g) => g !== 'fuzzy');
  if (graded.length === 0) return 1; // 无作答不触发调节
  return graded.filter((g) => g === 'correct').length / graded.length;
}

/**
 * 评估本回合难度/节拍指令。优先级：stuck > 快对 > 成功率锚点 > hold。
 * 复习档（§10.1④）：只调节拍（pace_up/pace_down），不产生难度事件——
 * 由调用方负责 up/down 才发 difficulty_adjust 事件、pace 类不发。
 */
export function assessDifficulty(ctx: DifficultyContext): DifficultyDirective {
  const isReview = ctx.skill === 'review';

  // ① 卡住 → 先降难度、给脚手架，不直接判错（§10.1③；down 事件 + 脚手架话术）
  if (ctx.stuck) {
    return isReview
      ? {
          kind: 'pace_down',
          reason: '复习档卡住：节拍放慢，先给提取线索再等作答（不判错，§10.1④）',
          message: '不着急，先看一眼提示再答',
        }
      : {
          kind: 'down',
          reason: '卡住：先降难度、给脚手架，不直接判错（§10.1③）',
          message: '先把台阶垫低一点：从一个小问题开始',
        };
  }

  // ② 答得快又对 → 立刻升难度/给变式（§10.1③）
  if (ctx.grade === 'correct' && (ctx.latencyMs ?? Infinity) < FAST_CORRECT_MS) {
    return isReview
      ? { kind: 'pace_up', reason: '复习档答得快又对：节拍加快，直接下一张（§10.1④）' }
      : { kind: 'up', reason: `答得快又对（${String(ctx.latencyMs)}ms < ${String(FAST_CORRECT_MS)}ms）：立刻升难度/给变式` };
  }

  // ③ 成功率锚点（交互层指标；复习档映射为节拍快慢）
  const rate = successRateOf(ctx.recentGrades);
  const target = TARGET_SUCCESS_RATE[ctx.skill];
  if (rate > target + SUCCESS_BAND) {
    return isReview
      ? { kind: 'pace_up', reason: `成功率 ${rate.toFixed(2)} 高于锚点 ${target}：节拍加快（§10.1④）` }
      : { kind: 'up', reason: `成功率 ${rate.toFixed(2)} 高于目标 ${target}：升难度` };
  }
  if (rate < target - SUCCESS_BAND) {
    return isReview
      ? { kind: 'pace_down', reason: `成功率 ${rate.toFixed(2)} 低于锚点 ${target}：节拍放慢，先易后难热身（§10.1④）` }
      : {
          kind: 'down',
          reason: `成功率 ${rate.toFixed(2)} 低于目标 ${target}：降难度`,
          message: '换个更小的切入点',
        };
  }

  return { kind: 'hold', reason: '难度匹配，维持当前节奏' };
}

/** 是否应发 difficulty_adjust 领域事件（复习档 pace 不调难度 → 不发，§10.1④）。 */
export function emitsDifficultyEvent(directive: DifficultyDirective): boolean {
  return directive.kind === 'up' || directive.kind === 'down';
}
