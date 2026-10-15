/**
 * 到期复习队列（CONTRACTS §2 / PRD §4.6②/§4.6③，D11）：
 * R 升序底序；同日到期 bookmarked > isPriority > 普通（仅排序、不改间隔策略）；
 * 交错抽取同板块至多 2 张；当日预算截断；一次只还 3~6 张。
 */
import type { FSRS, Card } from 'ts-fsrs';
import { State } from 'ts-fsrs';
import type { Alu, AluUserState } from './alu';
import type { AluId, ISODate, ModuleId } from './types';

/** 复习队列条目（CONTRACTS §2，逐字一致） */
export interface QueueItem {
  aluId: AluId;
  due: ISODate;
  retrievability: number;   // R 值（0~1），首页欠账排序用（§4.6③）
  moduleId: ModuleId;       // 交错抽取按板块去同（§4.6②）
  isPriority: boolean;      // 重点卡优先（§4.5 高质量档自动升级；间隔更保守）
  bookmarked: boolean;      // 用户收藏（D11）：仅抽取优先级加分，不改间隔策略
}

/** 当日预算（§4.6②）。V1 固定默认值，学习节奏画像可调（§5.1 B） */
export interface DailyBudget { newCards: number; reviewCards: number }

/** V1 默认当日预算（固定默认值；学习节奏画像可调，§5.1 B）。 */
export const DEFAULT_DAILY_BUDGET: DailyBudget = { newCards: 5, reviewCards: 20 };

/** 一次只还 3~6 张（§2 欠账牵引）：批次上限 6（候选/预算不足时自然更少，不强凑下限）。 */
export const MAX_BATCH_PER_ROUND = 6;
/** 交错抽取：同板块至多 2 张（§4.6② 节奏编织）。 */
export const MAX_PER_MODULE = 2;

function dayOf(iso: ISODate): string {
  return iso.slice(0, 10);
}

/** 抽取优先级：bookmarked(2) > isPriority(1) > 普通(0)（用户主动 > 系统自动，D11）。 */
function priorityRank(item: QueueItem): number {
  if (item.bookmarked) return 2;
  if (item.isPriority) return 1;
  return 0;
}

function compareQueueItems(a: QueueItem, b: QueueItem): number {
  const sameDay = dayOf(a.due) === dayOf(b.due);
  if (sameDay) {
    const rankDiff = priorityRank(b) - priorityRank(a);
    if (rankDiff !== 0) return rankDiff; // 同日到期：bookmarked > isPriority > 普通
  }
  if (a.retrievability !== b.retrievability) {
    return a.retrievability - b.retrievability; // R 升序为底序（§4.6③）
  }
  const rankDiff = priorityRank(b) - priorityRank(a);
  if (rankDiff !== 0) return rankDiff;
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  return a.aluId < b.aluId ? -1 : 1;
}

/**
 * 一轮抽取：跨板块抽 5~8 张、按当日预算截断（§4.6② 节奏编织）。
 * 算法：R 升序为底序 → 同日到期时 bookmarked > isPriority > 普通（用户主动 > 系统自动，D11）
 * → 同板块至多 2 张 → 截断到 budget → 一次只还 3~6 张（§2 欠账牵引）。
 */
export function pickReviewBatch(
  items: QueueItem[],
  budget: number,
  opts: { maxPerModule?: number; maxBatch?: number } = {},
): QueueItem[] {
  const maxPerModule = opts.maxPerModule ?? MAX_PER_MODULE;
  const maxBatch = opts.maxBatch ?? MAX_BATCH_PER_ROUND;
  const limit = Math.max(0, Math.min(budget, maxBatch));
  const sorted = [...items].sort(compareQueueItems);
  const perModule = new Map<ModuleId, number>();
  const batch: QueueItem[] = [];
  for (const item of sorted) {
    if (batch.length >= limit) break;
    const count = perModule.get(item.moduleId) ?? 0;
    if (count >= maxPerModule) continue;
    perModule.set(item.moduleId, count + 1);
    batch.push(item);
  }
  return batch;
}

/** 组装 QueueItem：R 值由调度器按当前时刻算（New/未见卡 R=0，不入到期队列，由调用方过滤）。 */
export function queueItemFrom(
  alu: Alu,
  state: AluUserState,
  now: Date,
  scheduler: FSRS,
): QueueItem {
  const card: Card = state.fsrs;
  const retrievability =
    card.state === State.New || !card.last_review
      ? 0
      : scheduler.get_retrievability(card, now, false);
  return {
    aluId: alu.id,
    due: card.due.toISOString(),
    retrievability,
    moduleId: alu.moduleId,
    isPriority: alu.isPriority === true,
    bookmarked: state.bookmarked === true,
  };
}

/** 到期过滤：due ≤ now 且非 New 态（见过不入队，硬规则1）。
 *  M7 集成验收修正：硬规则2 出卡入队的首复卡（createEnqueuedState → New，due=T+1）
 *  此前被"非 New"一刀切排除，T+1 永不到期——已入队（learned_once）的 New 卡按 due
 *  正常进入复习决策；未入队（unseen/seen）状态仍不产生欠账，硬规则1 语义不变。 */
export function isDue(state: AluUserState, now: Date): boolean {
  const enqueued = state.fsrs.state !== State.New || state.status === 'learned_once';
  return enqueued && state.fsrs.due.getTime() <= now.getTime();
}
