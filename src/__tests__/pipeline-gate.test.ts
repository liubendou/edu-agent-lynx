// M5 内容管线·验收闸测试（PRD §4.3 / CONTRACTS §8；ARCHITECTURE §1 pipeline/gate.ts）。
// 重点：可追溯率 100% 程序化硬门槛（坏卡 100% 拒收证明）、三指标 verdict、灰度判定。
import { expect, test } from '@rstest/core';

import { createAlu, type Alu, type SourceRef } from '../domain/alu';
import type { SourceDoc, SplitterOutput } from '../pipeline/splitter';
import { splitToAlus, type SplitCandidate } from '../pipeline/splitter';
import { checkGate, checkTraceability, diagnoseTraceability, GATE_THRESHOLDS, updateGrayscale } from '../pipeline/gate';
import { createMemoryKVStore } from '../storage/kv';
import { Repositories } from '../storage/repos';

/* ───────────── fixture：切一批好卡 + 一张坏卡构造器 ───────────── */

const DOC: SourceDoc = {
  docId: 'doc-1',
  docTitle: '档1·资源清单节选',
  sentenceTexts: [
    'p 值到底在说什么？效应量和 CI 为什么更该看？',
    '差异：实验 vs 相关 vs 准实验；自变量/因变量/混淆变量',
    'StatQuest 视频总索引（Josh Starmer，一个概念一个短片）',
  ],
};

const CANDIDATES: SplitCandidate[] = [
  {
    id: 'psy-001', type: '概念', module: '统计推断',
    front: 'p 值说的是什么？',
    back: "在 H0 成立前提下，观测到当前或更极端结果的概率；不是'结论为真的概率'。",
    difficulty: 3,
    anchorText: 'p 值到底在说什么？效应量和 CI 为什么更该看？',
  },
  {
    id: 'psy-002', type: '判据', module: '研究设计',
    front: '实验 / 相关 / 准实验，哪个能支持因果？',
    back: '只有实验（随机分配）能支持因果；相关与准实验无法排除混淆变量。',
    prereq: ['psy-001'],
    difficulty: 3,
    anchorText: '差异：实验 vs 相关 vs 准实验',
  },
  {
    id: 'res-001', type: '资源', module: '统计入门',
    front: 'StatQuest：均值/标准差入门短片（入口卡）',
    back: '入口 https://statquest.org/video_index.html',
    difficulty: 0,
    anchorText: 'StatQuest 视频总索引（Josh Starmer，一个概念一个短片）',
    url: 'https://statquest.org/video_index.html',
  },
];

const BATCH: SplitterOutput = splitToAlus('batch-good', 'psy-methods', DOC, CANDIDATES);

/** 手工构造一张可任意破坏出处的卡（绕过 createAlu 校验，直接改对象——闸不信任创建方）。 */
function brokenCard(id: string, patch: (alu: Alu) => void): Alu {
  const alu = structuredClone(BATCH.knowledgeAlus[0]);
  alu.id = id;
  patch(alu);
  return alu;
}

/* ───────────── A. 可追溯率程序化逐卡校验 ───────────── */

test('A1 全好批（splitter 产物 + 句表注入）→ rate=1、零隔离、verdict 含坏卡路径外的 pass 前提', () => {
  const result = checkTraceability([...BATCH.knowledgeAlus, ...BATCH.resourceEntries], { 'doc-1': DOC });
  expect(result.rate).toBe(1);
  expect(result.isolatedAluIds).toEqual([]);
  expect(result.passed).toHaveLength(3); // 2 知识卡 + 1 资源入口卡同标准
});

test('A2 坏卡逐类 100% 拒收：句表强校验（span 越界/坐标不匹配/句不存在）', () => {
  const outOfRange = brokenCard('bad-1', (a) => {
    const loc = a.source.locator as { kind: 'span'; sentenceIndex?: number };
    loc.sentenceIndex = 99;
  });
  const wrongCoords = brokenCard('bad-2', (a) => {
    const loc = a.source.locator as { kind: 'span'; start: number; end: number };
    loc.start = 2; loc.end = 5; // span 与 text 实际位置不符
  });
  const forgedText = brokenCard('bad-3', (a) => { a.source.text = '这句原文里根本没有'; });

  const result = checkTraceability([outOfRange, wrongCoords, forgedText], { 'doc-1': DOC });
  // 坏卡 100% 拒收：一个不漏全部进隔离名单
  expect(result.isolatedAluIds).toEqual(['bad-1', 'bad-2', 'bad-3']);
  expect(result.rate).toBe(0);
  expect(result.passed).toHaveLength(0);
  // 拒收原因可诊断
  const reasons = diagnoseTraceability([outOfRange, wrongCoords, forgedText], { 'doc-1': DOC }).map((i) => i.reason);
  expect(reasons.some((r) => r.includes('sentenceIndex out of range'))).toBe(true);
  expect(reasons.filter((r) => r.includes('原文不可命中'))).toHaveLength(2);
});

test('A3 坏卡逐类 100% 拒收：UrlLocator 非法协议、缺失字段、未知 locator', () => {
  const badUrl = brokenCard('bad-url', (a) => { a.source.locator = { kind: 'url', url: 'ftp://x' }; });
  const noDocId = brokenCard('bad-docid', (a) => { a.source = { ...a.source, docId: '  ' }; });
  const noText = brokenCard('bad-text', (a) => { a.source = { ...a.source, text: '' }; });
  const noTitle = brokenCard('bad-title', (a) => { a.source = { ...a.source, docTitle: '' }; });
  const badKind = brokenCard('bad-kind', (a) => { a.source.locator = { kind: 'mystery' } as unknown as SourceRef['locator']; });
  const noSource = brokenCard('bad-src', (a) => { (a as { source?: SourceRef }).source = undefined; });

  const bads = [badUrl, noDocId, noText, noTitle, badKind, noSource];
  const result = checkTraceability(bads, { 'doc-1': DOC });
  expect(result.isolatedAluIds).toEqual(bads.map((b) => b.id)); // 6/6 全拒，无一放行
  expect(result.rate).toBe(0);
});

test('A4 无句表旁路：结构合法的 span 卡过弱校验（正式批次必须注入句表）', () => {
  const good = BATCH.knowledgeAlus[0];
  const result = checkTraceability([good], {}); // 不注入句表
  expect(result.isolatedAluIds).toEqual([]);
  expect(result.rate).toBe(1);
});

test('A5 空批 rate=1（无卡可坏不等于有坏卡）', () => {
  expect(checkTraceability([], { 'doc-1': DOC }).rate).toBe(1);
});

/* ───────────── B. 三指标 verdict ───────────── */

const SAMPLE_PASS = { judgeableRate: 0.95, granularityRate: 0.9, sampleSize: 120, llmReview: true, manualRatio: 0.25 };

test('B1 可追溯 100% + 抽样双达标 → pass', () => {
  const report = checkGate({
    batchId: 'batch-good',
    alus: [...BATCH.knowledgeAlus, ...BATCH.resourceEntries],
    sentenceTables: { 'doc-1': DOC },
    sample: SAMPLE_PASS,
  });
  expect(report.verdict).toBe('pass');
  expect(report.traceability.rate).toBe(1);
  expect(report.judgeable).toMatchObject({ rate: 0.95, sampleSize: 120, llmReview: true, manualRatio: 0.25 });
  expect(report.granularity).toMatchObject({ rate: 0.9, sampleSize: 120 });
  expect(report.createdAt).toBeTruthy();
});

test('B2 抽样指标边界：恰在门槛上过（≥0.9 / ≥0.85），线下即 fail', () => {
  const base = { batchId: 'b', alus: BATCH.knowledgeAlus, sentenceTables: { 'doc-1': DOC } };
  expect(checkGate({ ...base, sample: { ...SAMPLE_PASS, judgeableRate: GATE_THRESHOLDS.judgeable, granularityRate: GATE_THRESHOLDS.granularity } }).verdict).toBe('pass');
  expect(checkGate({ ...base, sample: { ...SAMPLE_PASS, judgeableRate: 0.899 } }).verdict).toBe('fail');
  expect(checkGate({ ...base, sample: { ...SAMPLE_PASS, granularityRate: 0.849 } }).verdict).toBe('fail');
});

test('B3 未抽样 → pending_sample（rate/sampleSize 置 0）；trace fail 优先于 pending', () => {
  const pending = checkGate({ batchId: 'b', alus: BATCH.knowledgeAlus, sentenceTables: { 'doc-1': DOC } });
  expect(pending.verdict).toBe('pending_sample');
  expect(pending.judgeable).toMatchObject({ rate: 0, sampleSize: 0, llmReview: false });

  // 坏卡混入即使未抽样也直接 fail（硬门槛不等抽样）
  const bad = brokenCard('bad-x', (a) => { a.source.text = '原文不存在的句子'; });
  const failed = checkGate({ batchId: 'b', alus: [...BATCH.knowledgeAlus, bad], sentenceTables: { 'doc-1': DOC } });
  expect(failed.verdict).toBe('fail');
  expect(failed.traceability.isolatedAluIds).toEqual(['bad-x']);
});

/* ───────────── C. 灰度判定 ───────────── */

test('C1 连续两批 pass → auto_split；单批 pass 保持 seed', () => {
  let state = updateGrayscale({ consecutivePasses: 0, mode: 'seed' }, 'pass');
  expect(state).toEqual({ consecutivePasses: 1, mode: 'seed' });
  state = updateGrayscale(state, 'pass');
  expect(state).toEqual({ consecutivePasses: 2, mode: 'auto_split' });
});

test('C2 任一 fail → 归零退回种子模式；pending 不推进不清零', () => {
  const hot = updateGrayscale(updateGrayscale({ consecutivePasses: 0, mode: 'seed' }, 'pass'), 'pass');
  expect(updateGrayscale(hot, 'fail')).toEqual({ consecutivePasses: 0, mode: 'seed' });

  const midway = updateGrayscale({ consecutivePasses: 0, mode: 'seed' }, 'pass');
  expect(updateGrayscale(midway, 'pending_sample')).toBe(midway); // 原样不动
  // 灰度扩大后 fail 同样退回
  expect(updateGrayscale(hot, 'fail').mode).toBe('seed');
});

test('C3 pass→fail→pass 不构成连续两批', () => {
  const s1 = updateGrayscale({ consecutivePasses: 0, mode: 'seed' }, 'pass');
  const s2 = updateGrayscale(s1, 'fail');
  const s3 = updateGrayscale(s2, 'pass');
  expect(s3).toEqual({ consecutivePasses: 1, mode: 'seed' });
});

/* ───────────── D. 与仓库层兼容（CONTRACTS §10 gate_reports 集合） ───────────── */

test('D1 GateReport 落盘往返（storage/repos 同构类型）', async () => {
  const repos = new Repositories(createMemoryKVStore());
  const report = checkGate({
    batchId: 'batch-persist',
    alus: BATCH.knowledgeAlus,
    sentenceTables: { 'doc-1': DOC },
    sample: SAMPLE_PASS,
    now: () => new Date('2026-10-15T08:00:00Z'),
  });
  await repos.putGateReport(report);
  const loaded = await repos.getGateReport('batch-persist');
  expect(loaded).toEqual(report);
  expect(loaded!.createdAt).toBe('2026-10-15T08:00:00.000Z');

  // 灰度持久化
  await repos.saveGrayscale(updateGrayscale({ consecutivePasses: 0, mode: 'seed' }, 'pass'));
  expect(await repos.loadGrayscale()).toEqual({ consecutivePasses: 1, mode: 'seed' });
});

/* ───────────── E. 与 createAlu 直接构造的卡互通（gate 不挑创建方） ───────────── */

test('E1 createAlu 构造卡 + 种子式句表注入同样可校验', () => {
  const sentence = DOC.sentenceTexts[0];
  const alu = createAlu({
    id: 'manual-1', subjectId: 's', moduleId: 's.m', kind: 'concept',
    front: '手工卡？', back: '是。',
    source: { docId: 'doc-1', docTitle: '档1·资源清单节选', locator: { kind: 'span', start: 0, end: sentence.length - 1, sentenceIndex: 0 }, text: sentence },
  });
  expect(checkTraceability([alu], { 'doc-1': DOC }).rate).toBe(1); // span 坐标命中
});
