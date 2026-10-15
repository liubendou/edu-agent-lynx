/**
 * 成本护栏（M2c，CONTRACTS §7 / ARCHITECTURE §7 / PRD §7.6）。
 * token 日预算计数 + 升级配额 + 闲时调度队列（非实时任务登记与出队：批量切卡/批量评审走这里）。
 * 持久化经 storage/repos（import 域层仓库，BudgetState 暂置于 repos/collections.ts，
 * M2-int 统一迁移，此处只 import 不移动）。跨日自动重置计数。
 */
import type { ISODate } from '../domain/types';
import type { BudgetState } from '../storage/repos';
import { Repositories } from '../storage/repos';

/** 默认 token 日预算（V1 固定默认值，参数化可调）。 */
export const DEFAULT_DAILY_TOKEN_LIMIT = 1_000_000;
/** 默认升级配额（每日 pro 升级次数上限）。 */
export const DEFAULT_ESCALATION_LIMIT = 10;

/** 闲时任务登记项（非实时任务：批量切卡 batch_split / 批量评审 batch_review 等）。 */
export interface IdleTask {
  id: string;
  kind: 'batch_split' | 'batch_review' | (string & {});
  payload: unknown;
  enqueuedAt: ISODate;
}

export type IdleTaskInput = Omit<IdleTask, 'id' | 'enqueuedAt'> & { id?: string };

/** 闲时队列 KV key（独立于 9 集合；repos.kv 公共桥直接存取）。 */
const IDLE_QUEUE_KEY = 'edu:cloud:idle_queue';

export interface BudgetGuardDeps {
  repos: Repositories;
  now?: () => Date;
  defaults?: { dailyTokenLimit?: number; escalationLimit?: number };
}

function toDateKey(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

/** 成本护栏：日预算计数（持久化）+ 升级配额 + 闲时调度队列。 */
export class BudgetGuard {
  private readonly repos: Repositories;
  private readonly now: () => Date;
  private readonly defaults: { dailyTokenLimit: number; escalationLimit: number };
  private idleSeq = 0;

  constructor(deps: BudgetGuardDeps) {
    this.repos = deps.repos;
    this.now = deps.now ?? (() => new Date());
    this.defaults = {
      dailyTokenLimit: deps.defaults?.dailyTokenLimit ?? DEFAULT_DAILY_TOKEN_LIMIT,
      escalationLimit: deps.defaults?.escalationLimit ?? DEFAULT_ESCALATION_LIMIT,
    };
  }

  /** 当前状态（跨日自动重置并落盘）。 */
  async getState(): Promise<BudgetState> {
    const today = toDateKey(this.now());
    const saved = await this.repos.loadBudget();
    if (saved === null || saved.date !== today) {
      const fresh: BudgetState = {
        date: today,
        dailyTokenUsed: 0,
        dailyTokenLimit: this.defaults.dailyTokenLimit,
        escalationsUsed: 0,
        escalationLimit: this.defaults.escalationLimit,
      };
      await this.repos.saveBudget(fresh);
      return fresh;
    }
    return saved;
  }

  /** 记录 token 消耗（超预算仍如实计数，是否继续由调用方查 isOverBudget）。 */
  async recordUsage(tokens: number): Promise<BudgetState> {
    const state = await this.getState();
    const next: BudgetState = { ...state, dailyTokenUsed: state.dailyTokenUsed + tokens };
    await this.repos.saveBudget(next);
    return next;
  }

  /** 是否超日预算。 */
  isOverBudget(state: BudgetState): boolean {
    return state.dailyTokenUsed > state.dailyTokenLimit;
  }

  /** 日预算剩余额度。 */
  remainingTokens(state: BudgetState): number {
    return Math.max(0, state.dailyTokenLimit - state.dailyTokenUsed);
  }

  /** 升级配额是否还有余量。 */
  async canEscalate(): Promise<boolean> {
    const state = await this.getState();
    return state.escalationsUsed < state.escalationLimit;
  }

  /**
   * 消耗一次升级配额：有余量则 +1 落盘并返回新状态；配额尽返回 null（护栏生效，不升级）。
   */
  async recordEscalation(): Promise<BudgetState | null> {
    const state = await this.getState();
    if (state.escalationsUsed >= state.escalationLimit) return null;
    const next: BudgetState = { ...state, escalationsUsed: state.escalationsUsed + 1 };
    await this.repos.saveBudget(next);
    return next;
  }

  // ── 闲时调度队列（非实时任务登记与出队；sampler/批量切卡挂这里） ──

  private async readQueue(): Promise<IdleTask[]> {
    const raw = await this.repos.kv.get(IDLE_QUEUE_KEY);
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as IdleTask[]) : [];
    } catch {
      return [];
    }
  }

  private async writeQueue(tasks: IdleTask[]): Promise<void> {
    await this.repos.kv.set(IDLE_QUEUE_KEY, JSON.stringify(tasks));
  }

  /** 登记闲时任务（FIFO）。 */
  async enqueueIdle(task: IdleTaskInput): Promise<IdleTask> {
    const queue = await this.readQueue();
    const enqueued: IdleTask = {
      id: task.id ?? `idle-${toDateKey(this.now())}-${this.idleSeq++}`,
      kind: task.kind,
      payload: task.payload,
      enqueuedAt: this.now().toISOString(),
    };
    await this.writeQueue([...queue, enqueued]);
    return enqueued;
  }

  /** 出队最多 n 条（FIFO；默认全部）。 */
  async dequeueIdle(n?: number): Promise<IdleTask[]> {
    const queue = await this.readQueue();
    const count = n === undefined ? queue.length : Math.max(0, n);
    const [out, rest] = [queue.slice(0, count), queue.slice(count)];
    await this.writeQueue(rest);
    return out;
  }

  /** 查看队首任务（不出队）。 */
  async peekIdle(): Promise<IdleTask[]> {
    return this.readQueue();
  }

  /** 队列长度。 */
  async idleQueueSize(): Promise<number> {
    return (await this.readQueue()).length;
  }
}
