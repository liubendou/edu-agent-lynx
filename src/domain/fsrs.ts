/**
 * FSRS 封装（CONTRACTS §2）：判定→Rating 唯一映射（D8）、目标保持率 0.9、
 * 冷启动骨架 1-2-4-7-15（D6：FSRS 默认参数 + 骨架 due 覆盖）、
 * 产品 status 与 FSRS State 映射（D5：已稳固 scheduled_days≥21 参数化）。
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type FSRS,
  type Grade as FsrsGrade,
} from 'ts-fsrs';
import type { AluStatus, AnswerRecord, AluUserState } from './alu';
import type { FromMode, ISODate, AluId } from './types';

/** 判定 → FSRS Rating 映射（唯一映射表，全工程只用这一处；用户裁决 D8，总控 §0.1）：
 *  correct→Good(3)  wrong→Again(1)。fuzzy 不映射、不写 FSRS、不进 review_log
 *  （UID §5.4"模糊不记账"口径胜出，取代 PRD §4.5/§4.6① 中"模糊→间隔↓"的表述）。
 *  fuzzy 处置：触发"再讲一遍"脚手架；该卡本轮稍后重现、不产生新欠账；AnswerRecord 仅会话内留存。
 *  Easy(4) 不暴露给用户。 */
export function gradeToRating(g: 'correct' | 'wrong'): Rating {
  return g === 'correct' ? Rating.Good : Rating.Again;
}

/** 调度器实例：目标保持率 0.9（§4.6①"按目标保持率反解下次到期日"） */
export function createScheduler(requestRetention = 0.9): FSRS {
  return fsrs(generatorParameters({ request_retention: requestRetention }));
}

/** 艾宾浩斯冷启动骨架（天）：入队 T+1，其后答对间隔 2/4/7/15，骨架用尽交还 FSRS（D6）。 */
export const EBINGHAUS_SKELETON: readonly number[] = [1, 2, 4, 7, 15];

function addDays(now: Date, days: number): Date {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * 冷启动：新卡 createEmptyCard + 默认 w；初次入队 due=T+1（§4.5/§4.6①）。
 * 艾宾浩斯 1-2-4-7-15 为骨架参照（V1 共用默认参数演进——D6 已裁决；个人参数优化列 V1.x）。
 */
export function newCardForQueue(now: Date): Card {
  const card = createEmptyCard(now);
  card.due = addDays(now, 1); // 骨架[0]=1：初次入队 due=T+1
  card.scheduled_days = 1;
  return card;
}

export interface ScheduleResult {
  /** 更新后的 FSRS 卡（新对象，不改入参） */
  card: Card;
  /** 本次是否应用了骨架 due 覆盖（冷启动期 correct 时为 true） */
  skeletonApplied: boolean;
}

/**
 * 复习作答调度（correct/wrong；fuzzy 永不进入本函数——D8）。
 * correct：FSRS 默认参数演进 + 冷启动期骨架 due 覆盖（第 n 次作答后间隔 = 骨架[n]，n=1..4；
 *          入队时的骨架[0]=1 已由 newCardForQueue 落定）。
 * wrong：交 FSRS Again（lapse、进 Relearning、短间隔）——"间隔按答错处理"。
 */
export function scheduleReview(
  card: Card,
  grade: 'correct' | 'wrong',
  now: Date,
  opts: { scheduler?: FSRS } = {},
): ScheduleResult {
  const scheduler = opts.scheduler ?? createScheduler();
  const rating = gradeToRating(grade) as FsrsGrade; // Again/Good 恒在 FsrsGrade 内
  const next = scheduler.next(card, now, rating).card;
  if (grade === 'correct') {
    // 冷启动：前 4 次复习答对按骨架 2/4/7/15 覆盖（骨架[0]=1 已用于入队）
    if (next.reps >= 1 && next.reps < EBINGHAUS_SKELETON.length) {
      const intervalDays = EBINGHAUS_SKELETON[next.reps];
      return {
        card: { ...next, due: addDays(now, intervalDays), scheduled_days: intervalDays },
        skeletonApplied: true,
      };
    }
  }
  return { card: next, skeletonApplied: false };
}

/** 已稳固阈值（D5：技术默认 scheduled_days≥21，参数化可调）。 */
export const CONSOLIDATED_DAYS = 21;

/**
 * FSRS Card → 产品 status（CONTRACTS §1 映射注）：
 * 未见/见过=New（见过不入队，硬规则1——未入队卡由调用方直接给 'unseen'/'seen'，不经本函数）；
 * 学过一轮=入队 Learning→Review；暂记=Review 且近期 lapse（最近一次作答 wrong，或 Relearning）；
 * 已稳固=Review 且 scheduled_days ≥ consolidatedDays（D5）。
 */
export function deriveStatus(
  card: Card,
  opts: { consolidatedDays?: number; lastGrade?: AnswerRecord['grade'] } = {},
): AluStatus {
  const consolidatedDays = opts.consolidatedDays ?? CONSOLIDATED_DAYS;
  if (card.state === State.New || card.state === State.Learning) return 'learned_once';
  if (card.state === State.Relearning) return 'retaining';
  // State.Review
  if (card.scheduled_days >= consolidatedDays) return 'consolidated';
  if (opts.lastGrade === 'wrong') return 'retaining';
  return 'learned_once';
}

/** "学过一轮"入队工厂：standard/deep 讲完自检过（硬规则2 唯一入口）后建用户状态。 */
export function createEnqueuedState(
  aluId: AluId,
  now: Date,
  fromMode: FromMode,
  base?: Pick<AluUserState, 'bookmarked'>,
): AluUserState {
  const iso: ISODate = now.toISOString();
  return {
    aluId,
    status: 'learned_once',
    fromMode,
    fsrs: newCardForQueue(now),
    lastAnswers: [],
    createdAt: iso,
    updatedAt: iso,
    ...(base?.bookmarked !== undefined ? { bookmarked: base.bookmarked } : {}),
  };
}

export { Rating, State, createEmptyCard, fsrs, generatorParameters };
export type { Card, FSRS };
