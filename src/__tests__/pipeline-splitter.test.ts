// M5 内容管线·切分器测试（PRD §4.3 / CONTRACTS §8；ARCHITECTURE §1 pipeline/splitter.ts）。
// 重点：两层分流正确性、出处 span 坐标、锚句不命中 100% 拒收。
import { expect, test } from '@rstest/core';

import {
  buildSourceDoc, findNormalizedRange, locateSpan, splitSentences, splitToAlus,
  type SplitCandidate,
} from '../pipeline/splitter';

const DOC_TEXT = [
  'p 值到底在说什么？效应量和 CI 为什么更该看？',
  '差异：实验 vs 相关 vs 准实验；自变量/因变量/混淆变量',
  'StatQuest 视频总索引（Josh Starmer，一个概念一个短片） https://statquest.org/video_index.html',
  '把复习打散到多天，而非一次性堆。',
  '---',
].join('\n');

const DOC = buildSourceDoc('doc-1', '档1·资源清单节选', DOC_TEXT);

/* ───────────── A. 句切分与句表 ───────────── */

test('A1 句切分：以原文条目行为句（回链最小单位），剥空白行与纯符号行', () => {
  const sentences = DOC.sentenceTexts;
  expect(sentences[0]).toBe('p 值到底在说什么？效应量和 CI 为什么更该看？');
  expect(sentences[1]).toBe('差异：实验 vs 相关 vs 准实验；自变量/因变量/混淆变量');
  // 行内不做标点二次切分：URL、分号不破坏条目行
  expect(sentences[2]).toBe('StatQuest 视频总索引（Josh Starmer，一个概念一个短片） https://statquest.org/video_index.html');
  expect(sentences).toContain('把复习打散到多天，而非一次性堆。');
  expect(sentences.some((s) => s === '---')).toBe(false); // 纯符号不成句
});

test('A2 buildSourceDoc 保留 docId/docTitle（回链校验依据）', () => {
  expect(DOC.docId).toBe('doc-1');
  expect(DOC.docTitle).toBe('档1·资源清单节选');
});

/* ───────────── B. span 定位 ───────────── */

test('B1 findNormalizedRange：句内片段锚返回原句坐标（含端点）', () => {
  const sentence = 'Dunlosky 评级：高效；一周后回忆率约 80% vs 重复阅读约 35%';
  const [start, end] = findNormalizedRange(sentence, '一周后回忆率约 80% vs 重复阅读约 35%')!;
  expect(sentence.slice(start, end + 1)).toBe('一周后回忆率约 80% vs 重复阅读约 35%');
  // 整句锚
  const [s2, e2] = findNormalizedRange(sentence, sentence)!;
  expect([s2, e2]).toEqual([0, sentence.length - 1]);
  // 改写不命中
  expect(findNormalizedRange(sentence, '一周后回忆率约百分之八十')).toBeNull();
  expect(findNormalizedRange(sentence, '   ')).toBeNull();
});

test('B2 findNormalizedRange：空白差异不破坏命中，映射回原句坐标', () => {
  const sentence = '预注册是什么、为什么能防  p-hacking'; // 双空格
  const [start, end] = findNormalizedRange(sentence, '预注册是什么、为什么能防 p-hacking')!;
  expect(sentence.slice(start, end + 1)).toBe(sentence);
});

test('B3 locateSpan：hintIndex 优先、未命中回落全表扫描、全不命中返回 null', () => {
  const table = ['第一句话。', '第二句话，含锚点词。', '第三句话。'];
  expect(locateSpan(table, '含锚点词')!.sentenceIndex).toBe(1);
  expect(locateSpan(table, '第二句话，含锚点词。', 1)!.sentenceIndex).toBe(1);
  // hint 落空 → 扫全表仍命中
  expect(locateSpan(table, '第三句话', 0)!.sentenceIndex).toBe(2);
  // 无处命中
  expect(locateSpan(table, '不存在的原句')).toBeNull();
});

/* ───────────── C. 两层分流 ───────────── */

const KNOWLEDGE: SplitCandidate = {
  id: 'psy-001', type: '概念', module: '统计推断',
  front: 'p 值说的是什么？',
  back: "在 H0 成立前提下，观测到当前或更极端结果的概率；不是'结论为真的概率'。",
  variants: ['p=0.03 是否意味结论有 97% 概率为真？为什么不是？'],
  prereq: [],
  difficulty: 3,
  anchorText: 'p 值到底在说什么？效应量和 CI 为什么更该看？',
};
const RESOURCE: SplitCandidate = {
  id: 'res-001', type: '资源', module: '统计入门',
  front: 'StatQuest：均值/标准差入门短片（入口卡）',
  back: '入口 https://statquest.org/video_index.html',
  variants: [], prereq: [], difficulty: 0,
  anchorText: 'StatQuest 视频总索引（Josh Starmer，一个概念一个短片）',
  url: 'https://statquest.org/video_index.html',
};

test('C1 知识型 → knowledgeAlus：中文 type 映射、TextSpan 句内坐标、module 前缀规范', () => {
  const out = splitToAlus('batch-1', 'psy-methods', DOC, [KNOWLEDGE]);
  expect(out.batchId).toBe('batch-1');
  expect(out.knowledgeAlus).toHaveLength(1);
  expect(out.resourceEntries).toHaveLength(0);

  const alu = out.knowledgeAlus[0];
  expect(alu.kind).toBe('concept'); // 概念 → concept
  expect(alu.moduleId).toBe('psy-methods.统计推断'); // §4.2 Subject──Module──ALU
  expect(alu.source.docId).toBe('doc-1');
  expect(alu.source.locator.kind).toBe('span');
  const loc = alu.source.locator as { kind: 'span'; start: number; end: number; sentenceIndex?: number };
  const anchorSentence = DOC.sentenceTexts[loc.sentenceIndex!];
  expect(anchorSentence.slice(loc.start, loc.end + 1)).toBe('p 值到底在说什么？效应量和 CI 为什么更该看？');
  expect(alu.source.text).toBe('p 值到底在说什么？效应量和 CI 为什么更该看？');
});

test('C2 资源型 → resourceEntries：入口卡 kind=resource、UrlLocator、难度 0', () => {
  const out = splitToAlus('batch-1', 'psy-methods', DOC, [RESOURCE]);
  expect(out.resourceEntries).toHaveLength(1);
  expect(out.knowledgeAlus).toHaveLength(0);

  const alu = out.resourceEntries[0];
  expect(alu.kind).toBe('resource');
  expect(alu.difficulty).toBe(0); // 资源型占位
  expect(alu.source.locator).toEqual({ kind: 'url', url: 'https://statquest.org/video_index.html' });
  expect(out.sourceDoc).toEqual(DOC); // 原文句表随批携带（回链校验依据）
});

test('C3 判据/过程/英文 type 同样映射；无链接资源卡回落句内 span', () => {
  const out = splitToAlus('b', 's', DOC, [
    { ...KNOWLEDGE, id: 'psy-x', type: 'criterion', anchorText: '差异：实验 vs 相关 vs 准实验' },
    { ...KNOWLEDGE, id: 'psy-y', type: '过程' },
    { ...RESOURCE, id: 'res-x', url: undefined }, // 无入口链接 → span 出处
  ]);
  expect(out.knowledgeAlus.map((a) => a.kind)).toEqual(['criterion', 'procedure']);
  const fallback = out.resourceEntries[0];
  expect(fallback.source.locator.kind).toBe('span');
});

/* ───────────── D. 坏候选 100% 拒收 ───────────── */

test('D1 锚句改写（原文不可命中）→ 拒收不出卡', () => {
  const bad: SplitCandidate = { ...KNOWLEDGE, id: 'psy-bad', anchorText: 'p 值大概就是显著性吧（改写句）' };
  const out = splitToAlus('b', 's', DOC, [bad]);
  expect(out.knowledgeAlus).toHaveLength(0);
  expect(out.resourceEntries).toHaveLength(0);
});

test('D2 未知 type / id 重复 / 最小完备性失败 → 全部拒收', () => {
  const out = splitToAlus('b', 's', DOC, [
    { ...KNOWLEDGE, id: 'psy-1', type: '填空题' }, // 未知原语
    { ...KNOWLEDGE, id: 'psy-2' },
    { ...KNOWLEDGE, id: 'psy-2' }, // id 重复 → 后者丢弃
    { ...KNOWLEDGE, id: 'psy-3', front: '   ' }, // 空正题（createAlu 拒）
    { ...KNOWLEDGE, id: 'psy-4', prereq: ['psy-4'] }, // prereq 自环（createAlu 拒）
    { ...KNOWLEDGE, id: 'psy-5', difficulty: 9 }, // 刻度越界（createAlu 拒）
  ]);
  const ids = out.knowledgeAlus.map((a) => a.id);
  expect(ids).toEqual(['psy-2']); // 仅合法候选出卡，坏候选 0 混入
});
