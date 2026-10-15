// M5 内容管线·抽样评审测试（PRD §4.3 / CONTRACTS §8；ARCHITECTURE §1 pipeline/sampler.ts）。
// 重点：分层抽样规模与覆盖、闲时队列 batch_review 登记/消费（§7.6）、规则评审基线、全链路过闸。
import { expect, test } from '@rstest/core';

import type { Alu } from '../domain/alu';
import { createMemoryKVStore } from '../storage/kv';
import { Repositories } from '../storage/repos';
import { BudgetGuard } from '../cloud/budget';
import { splitToAlus, type SourceDoc, type SplitCandidate } from '../pipeline/splitter';
import { checkGate, checkTraceability } from '../pipeline/gate';
import {
  dequeueSampleReviews, drawStratifiedSample, enqueueSampleReview, hashSeed, mulberry32,
  runSampleReview, SAMPLE_MAX, heuristicSampleReviewer, type SampleReviewResult,
} from '../pipeline/sampler';

/* ───────────── fixture ───────────── */

const DOC: SourceDoc = {
  docId: 'doc-1',
  docTitle: '档1·资源清单节选',
  sentenceTexts: ['p 值到底在说什么？效应量和 CI 为什么更该看？', '把复习打散到多天，而非一次性堆。'],
};

function candidate(id: string, module: string, type = '概念'): SplitCandidate {
  return {
    id, type, module,
    front: `卡片 ${id} 在说什么？`,
    back: `${id} 的标准答案，用于抽样合成批量。`,
    difficulty: 2,
    anchorText: DOC.sentenceTexts[0],
  };
}

/** 合成一批只含锚点合法的知识卡（分层用：kind × moduleId）。 */
function synthBatch(n: number): Alu[] {
  const candidates: SplitCandidate[] = [];
  for (let i = 0; i < n; i++) {
    const kind = ['概念', '判据', '过程'][i % 3];
    const module = `模块${i % 5}`;
    candidates.push(candidate(`syn-${String(i).padStart(3, '0')}`, module, kind));
  }
  const out = splitToAlus('batch-synth', 'subj', DOC, candidates);
  return out.knowledgeAlus;
}

/* ───────────── A. 分层抽样 ───────────── */

test('A1 大批（300>上限）抽 200，层间按比例覆盖、无重复', () => {
  const batch = synthBatch(300); // 3 kind × 5 module = 15 层
  const plan = drawStratifiedSample('batch-synth', batch);
  expect(SAMPLE_MAX).toBe(200);
  expect(plan.sampleSize).toBe(200);
  expect(plan.totalKnowledge).toBe(300);
  expect(plan.sampleAluIds).toHaveLength(new Set(plan.sampleAluIds).size); // 无重复
  // 15 层每层应至少分到名额（300/15=20 层均大，200/300 比例下每层 floor(200*20/300)=13）
  expect(plan.layerCount).toBe(15);
  const byModule = new Map<string, number>();
  for (const id of plan.sampleAluIds) {
    const mod = batch.find((a) => a.id === id)!.moduleId;
    byModule.set(mod, (byModule.get(mod) ?? 0) + 1);
  }
  expect([...byModule.values()].every((n) => n >= 39)).toBe(true); // 每模块（3 层合计）≥ 200*60/300=40 上下，留比例余量
});

test('A2 小批（<上限）全量抽取；manual 子集为 ≥20% 且 ⊆ 样本', () => {
  const batch = synthBatch(9);
  const plan = drawStratifiedSample('batch-small', batch);
  expect(plan.sampleSize).toBe(9);
  expect(plan.sampleAluIds.sort()).toEqual(batch.map((a) => a.id).sort());
  expect(plan.manualSampleIds).toHaveLength(Math.ceil(9 * 0.2));
  for (const id of plan.manualSampleIds) expect(plan.sampleAluIds).toContain(id);
});

test('A3 确定性可复现：同 batchId 同结果；rng 注入生效', () => {
  const batch = synthBatch(300);
  const p1 = drawStratifiedSample('same-seed', batch);
  const p2 = drawStratifiedSample('same-seed', batch);
  expect(p1.sampleAluIds).toEqual(p2.sampleAluIds);
  // 显式 rng：恒 0.5 与恒 0 产生不同排列
  const p3 = drawStratifiedSample('x', batch, { rng: () => 0.5 });
  const p4 = drawStratifiedSample('x', batch, { rng: () => 0.0 });
  expect(p3.sampleAluIds).not.toEqual(p4.sampleAluIds);
});

test('A4 hashSeed/mulberry32：确定性与值域', () => {
  expect(hashSeed('abc')).toBe(hashSeed('abc'));
  expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  const rng = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const v = rng();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

/* ───────────── B. 闲时队列（§7.6 batch_review） ───────────── */

test('B1 登记抽样评审闲时任务并消费执行；非本类任务原样回队', async () => {
  const repos = new Repositories(createMemoryKVStore());
  const budget = new BudgetGuard({ repos });

  const plan = drawStratifiedSample('batch-idle', synthBatch(30), { max: 10 });
  const task = await enqueueSampleReview(budget, plan);
  expect(task.kind).toBe('batch_review');
  expect(await budget.idleQueueSize()).toBe(1);

  // 混入一个其他类闲时任务
  await budget.enqueueIdle({ kind: 'batch_split', payload: { docId: 'd' } });
  expect(await budget.idleQueueSize()).toBe(2);

  const executed: string[] = [];
  const summary = await dequeueSampleReviews(budget, (p) => { executed.push(p.batchId); });
  expect(summary).toEqual({ executed: 1, deferred: 1 });
  expect(executed).toEqual(['batch-idle']);
  // batch_split 原样回队（id 保留、保序）
  const remaining = await budget.peekIdle();
  expect(remaining).toHaveLength(1);
  expect(remaining[0].kind).toBe('batch_split');
  expect(remaining[0].id).not.toBe(task.id);
});

test('B2 坏 payload 的 batch_review 任务跳过不崩、计 deferred', async () => {
  const repos = new Repositories(createMemoryKVStore());
  const budget = new BudgetGuard({ repos });
  await budget.enqueueIdle({ kind: 'batch_review', payload: { nonsense: true } });
  const summary = await dequeueSampleReviews(budget, () => { throw new Error('不应执行'); });
  expect(summary).toEqual({ executed: 0, deferred: 1 });
});

/* ───────────── C. 规则评审基线 ───────────── */

test('C1 启发式评审：种子式好卡全过，敷衍/复读/超长卡判负', async () => {
  const batch = synthBatch(6);
  const result = await runSampleReview(batch);
  expect(result.judgeableRate).toBe(1);
  expect(result.granularityRate).toBe(1);
  expect(result.llmReview).toBe(false);

  const bad = await runSampleReview([
    splitToAlus('b', 's', DOC, [{ ...candidate('vague-1', '模块0'), back: '见课本' }]).knowledgeAlus[0], // 背面敷衍
    splitToAlus('b', 's', DOC, [{ ...candidate('echo-1', '模块0'), back: '卡片 echo-1 在说什么？' }]).knowledgeAlus[0], // 背面复读正面
    splitToAlus('b', 's', DOC, [{ ...candidate('wide-1', '模块0'), front: `${'超宽题干'.repeat(30)}？` }]).knowledgeAlus[0], // 一次答不完
  ]);
  expect(bad.perAlu.filter((v) => !v.judgeable).map((v) => v.aluId).sort()).toEqual(['echo-1', 'vague-1']);
  expect(bad.perAlu.filter((v) => !v.granularity).map((v) => v.aluId).sort()).toEqual(['vague-1', 'wide-1']);
});

test('C2 LLM 评审器协议注入：llmReview 标志随评审器 kind', async () => {
  const batch = synthBatch(3);
  const result = await runSampleReview(batch, { kind: 'llm', review: () => ({ judgeable: true, granularity: false }) });
  expect(result.llmReview).toBe(true);
  expect(result.judgeableRate).toBe(1);
  expect(result.granularityRate).toBe(0);
});

/* ───────────── D. 全链路：切分 → 闸 → 抽样 → 闲时评审 → 盖章 pass ───────────── */

test('D1 splitter→gate→sampler→budget→gate 全链路（小批全量评审）', async () => {
  const batch = synthBatch(40);
  const trace = checkTraceability(batch, { 'doc-1': DOC });
  expect(trace.rate).toBe(1);

  const plan = drawStratifiedSample('batch-e2e', trace.passed, { max: 200 });
  expect(plan.sampleSize).toBe(40);

  const repos = new Repositories(createMemoryKVStore());
  const budget = new BudgetGuard({ repos });
  await enqueueSampleReview(budget, plan);

  let review: SampleReviewResult | null = null;
  await dequeueSampleReviews(budget, async (p) => {
    const sampleAlus = trace.passed.filter((a) => p.sampleAluIds.includes(a.id));
    review = await runSampleReview(sampleAlus, heuristicSampleReviewer, { manualRatio: 0.2 });
  });
  expect(await budget.idleQueueSize()).toBe(0); // 评审消费完毕
  expect(review).not.toBeNull();

  const report = checkGate({
    batchId: 'batch-e2e',
    alus: batch,
    sentenceTables: { 'doc-1': DOC },
    sample: review!,
  });
  expect(report.verdict).toBe('pass');
  await expect((async () => {
    await repos.putGateReport(report);
    return repos.getGateReport('batch-e2e');
  })()).resolves.toMatchObject({ batchId: 'batch-e2e', verdict: 'pass' });
});
