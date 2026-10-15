/**
 * 抽样评审编排（M5，PRD §4.3 / CONTRACTS §8）。
 *
 * 每批从通过可追溯校验的卡中分层抽样 100~200 张（批小于下限时全量），
 * LLM 评审规则 + ≥20% 人工抽检；批量评审属非实时任务，登记与消费走 §7.6 闲时调度队列
 * （cloud/budget.ts BudgetGuard，kind='batch_review'）。
 * V1 内置规则评审基线（heuristicSampleReviewer，供阈值校准与测试），LLM 评审器按同协议注入。
 */
import type { AluId } from '../domain/types';
import type { Alu } from '../domain/alu';
import { BudgetGuard, type IdleTask } from '../cloud/budget';
import { MANUAL_REVIEW_RATIO } from './gate';

/** 抽样规模上限（PRD §4.3：每批分层抽 100~200 张的 200；批不足时全量抽取）。 */
export const SAMPLE_MAX = 200;

/** 抽样计划（闲时任务 payload）。 */
export interface SamplePlan {
  batchId: string;
  sampleAluIds: AluId[];
  sampleSize: number;
  totalKnowledge: number;
  /** 人工抽检子集（抽样集的 ≥20%，层间交错后取前段，天然跨层） */
  manualSampleIds: AluId[];
  layerCount: number;
}

// ── 确定性洗牌（可复现抽样；同 seed 同结果） ──

/** FNV-1a 字符串哈希（rng 种子）。 */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：无依赖小 RNG。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface DrawSampleOptions {
  /** 抽样上限（PRD §4.3 每批 100~200 张的 200；批不足上限时全量抽取） */
  max?: number;
  /** rng 注入（缺省按 batchId 确定性派生，抽样可复现） */
  rng?: () => number;
}

/**
 * 分层抽样：层 = kind × moduleId，层内洗牌后按层占比分配名额（大数比例法，
 * 余数名额给大层），跨层拼接构成样本。批 ≤ 上限时全量（退化为逐层洗牌拼接）。
 */
export function drawStratifiedSample(batchId: string, knowledgeAlus: readonly Alu[], opts: DrawSampleOptions = {}): SamplePlan {
  const max = opts.max ?? SAMPLE_MAX;
  const total = knowledgeAlus.length;
  const target = Math.min(total, Math.max(0, max));

  // 分层：kind × moduleId
  const layers = new Map<string, Alu[]>();
  for (const alu of knowledgeAlus) {
    const key = `${alu.kind}/${alu.moduleId}`;
    const bucket = layers.get(key);
    if (bucket === undefined) layers.set(key, [alu]);
    else bucket.push(alu);
  }

  const rng = opts.rng ?? mulberry32(hashSeed(`sample:${batchId}`));
  const keys = [...layers.keys()].sort(); // 层序确定化
  const picked: Alu[] = [];
  const allocated = new Map<string, number>();
  let allocatedSum = 0;
  for (const key of keys) {
    const size = layers.get(key)!.length;
    const quota = total === 0 ? 0 : Math.floor((target * size) / total);
    allocated.set(key, quota);
    allocatedSum += quota;
  }
  // 余数名额：按层大小降序补齐（大层优先），只补到 target 且不超过层容量
  let rest = target - allocatedSum;
  const bySize = [...keys].sort((a, b) => layers.get(b)!.length - layers.get(a)!.length);
  for (let round = 0; rest > 0 && round < keys.length; round++) {
    for (const key of bySize) {
      if (rest === 0) break;
      const quota = allocated.get(key)!;
      if (quota < layers.get(key)!.length) {
        allocated.set(key, quota + 1);
        rest--;
      }
    }
  }
  for (const key of keys) {
    const bucket = shuffled(layers.get(key)!, rng);
    picked.push(...bucket.slice(0, allocated.get(key)));
  }

  const manualCount = Math.ceil(picked.length * MANUAL_REVIEW_RATIO);
  return {
    batchId,
    sampleAluIds: picked.map((a) => a.id),
    sampleSize: picked.length,
    totalKnowledge: total,
    manualSampleIds: picked.slice(0, manualCount).map((a) => a.id),
    layerCount: layers.size,
  };
}

// ── 闲时队列登记与消费（§7.6 非实时任务） ──

/** 登记批量评审闲时任务（FIFO append）。 */
export function enqueueSampleReview(budget: BudgetGuard, plan: SamplePlan): Promise<IdleTask> {
  return budget.enqueueIdle({ kind: 'batch_review', payload: plan });
}

/** 闲时队列内 batch_review 任务的 payload 形状护栏（坏 payload 跳过不崩）。 */
function asSamplePlan(payload: unknown): SamplePlan | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<SamplePlan>;
  return typeof p.batchId === 'string' && Array.isArray(p.sampleAluIds) ? (payload as SamplePlan) : null;
}

/**
 * 消费闲时队列中的批量评审任务：逐条出队执行 run(plan)；
 * 非 batch_review 任务原样回队（保序，延迟到下一轮闲时）。
 * 返回执行/延后条数。
 */
export async function dequeueSampleReviews(
  budget: BudgetGuard,
  run: (plan: SamplePlan) => Promise<void> | void,
): Promise<{ executed: number; deferred: number }> {
  let executed = 0;
  let deferred = 0;
  const deferredTasks: IdleTask[] = [];
  // 队列规模有限（每批一个任务），逐条出队即可；防坏任务死循环设上限
  for (let guard = 0, size = await budget.idleQueueSize(); guard < size; guard++) {
    const [task] = await budget.dequeueIdle(1);
    if (task === undefined) break;
    const plan = task.kind === 'batch_review' ? asSamplePlan(task.payload) : null;
    if (plan === null) {
      deferredTasks.push(task);
      deferred++;
      continue;
    }
    await run(plan);
    executed++;
  }
  for (const task of deferredTasks) {
    await budget.enqueueIdle({ id: task.id, kind: task.kind, payload: task.payload });
  }
  return { executed, deferred };
}

// ── 评审协议与规则基线 ──

export interface SampleReviewer {
  /** 评审器类别：heuristic=规则基线（V1 内置）/ llm=云侧 LLM 评审 */
  kind: 'heuristic' | 'llm';
  review(alu: Alu): { judgeable: boolean; granularity: boolean } | Promise<{ judgeable: boolean; granularity: boolean }>;
}

/** 单卡评审结果明细。 */
export interface SampleVerdict {
  aluId: AluId;
  judgeable: boolean;
  granularity: boolean;
}

export interface SampleReviewResult {
  /** 可判对错率（≥0.9 门槛，gate 判定） */
  judgeableRate: number;
  /** 颗粒度合格率（≥0.85 门槛） */
  granularityRate: number;
  sampleSize: number;
  llmReview: boolean;
  /** 实际人工抽检占比（由调用方回填；≥0.2 为 §4.3 口径） */
  manualRatio: number;
  perAlu: SampleVerdict[];
}

const QUESTION_HINTS = ['？', '?', '哪', '什么', '为何', '为什么', '如何', '怎样', '哪个', '哪些', '是否', '何时', '标准步骤', '何时用'];

/** 去空白长度（中文口径按字符数）。 */
const compactLength = (s: string): number => s.replace(/\s+/g, '').length;

/**
 * 规则评审基线（V1 内置；PRD §4.3 阈值用前两批真实切分校准，之后接 LLM 评审器）：
 * - 可判对错：正面含疑问标记/判据式提问提示词，背面非敷衍（去空白 ≥8 字符）且非复读正面；
 * - 颗粒度：正面 5~80、背面 8~220 去空白字符（"一次能答完、不宽不碎"的程序化近似）。
 */
export const heuristicSampleReviewer: SampleReviewer = {
  kind: 'heuristic',
  review(alu: Alu): { judgeable: boolean; granularity: boolean } {
    const front = alu.front.trim();
    const back = alu.back.trim();
    const hasQuestionMark = front.includes('？') || front.includes('?');
    const hasHint = QUESTION_HINTS.some((h) => front.includes(h));
    const judgeable = (hasQuestionMark || hasHint) && compactLength(back) >= 8 && front !== back;
    const granularity =
      compactLength(front) >= 5 && compactLength(front) <= 80 &&
      compactLength(back) >= 8 && compactLength(back) <= 220 &&
      alu.variants.every((v) => compactLength(v) <= 120);
    return { judgeable, granularity };
  },
};

/**
 * 执行抽样评审：对样本逐卡跑评审器，汇总三指标所需的 rate/llmReview。
 * 评审对象 = 知识型 ALU（可测卡）；资源入口卡不进复习队列、无"判对错"语义，
 * 自动排除（其质量由可追溯校验 + UrlLocator 白名单兜底）。
 * manualRatio 由调用方按实际人工抽检完成度回填（缺省 0 = 尚未人工抽检）。
 */
export async function runSampleReview(
  sampleAlus: readonly Alu[],
  reviewer: SampleReviewer = heuristicSampleReviewer,
  opts: { manualRatio?: number } = {},
): Promise<SampleReviewResult> {
  const perAlu: SampleVerdict[] = [];
  for (const alu of sampleAlus) {
    if (alu.kind === 'resource') continue;
    const verdict = await reviewer.review(alu);
    perAlu.push({ aluId: alu.id, ...verdict });
  }
  const size = perAlu.length;
  const count = (key: 'judgeable' | 'granularity') => perAlu.filter((v) => v[key]).length;
  return {
    judgeableRate: size === 0 ? 0 : count('judgeable') / size,
    granularityRate: size === 0 ? 0 : count('granularity') / size,
    sampleSize: size,
    llmReview: reviewer.kind === 'llm',
    manualRatio: opts.manualRatio ?? 0,
    perAlu,
  };
}
