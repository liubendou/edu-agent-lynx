// M5 内容管线·种子内容包测试（PRD §0.1①②/§4.3/§4.4、附录样例 / CONTRACTS §8）。
// 重点：包结构齐备、卡面与 PRD 附录逐字一致、出处句表对 /skill/ 只读源保真、全量过验收闸。
import { expect, test } from '@rstest/core';
import { readFileSync } from 'node:fs';

import { SKILL_SRC_ROOT } from './skill-root';
import { checkGate, checkTraceability } from '../pipeline/gate';
import { runSampleReview, heuristicSampleReviewer } from '../pipeline/sampler';
import {
  ALL_SEED_ALUS, SEED_META_COURSE, SEED_PACKS, SEED_PSYCHOLOGY, SEED_SOURCE_DOCS,
} from '../pipeline/seeds';
import { SOURCE_DOC_META } from '../pipeline/seeds/meta-course';
import { SOURCE_DOC_CHECKLIST, SOURCE_DOC_LAKENS, STATQUEST_ENTRY_TEXT } from '../pipeline/seeds/psychology';

const SRC_ROOT = SKILL_SRC_ROOT;
const METHODOLOGY_PATH = `${SRC_ROOT}/score-boost/references/提分方法论_汇总.md`;
const CHECKLIST_PATH = `${SRC_ROOT}/quick-learning/references/资源清单.md`;

/* ───────────── A. 包结构（CONTRACTS §8 SeedContentPack） ───────────── */

test('A1 两包齐备：packId/version/layer 正确，V1 内置 = 元课程 + 真实学科', () => {
  expect(SEED_PACKS).toHaveLength(2);
  expect(SEED_META_COURSE).toMatchObject({ packId: 'seed-meta-course', version: '1.0.0', layer: 'meta_course' });
  expect(SEED_PSYCHOLOGY).toMatchObject({ packId: 'seed-psychology', version: '1.0.0', layer: 'real_subject' });
  expect(SEED_META_COURSE.alus).toHaveLength(3); // 元课程 3 卡
  expect(SEED_PSYCHOLOGY.alus).toHaveLength(6); // 5 知识卡 + 1 资源入口卡
  expect(SEED_PSYCHOLOGY.alus.filter((a) => a.kind === 'resource')).toHaveLength(1);
  expect(ALL_SEED_ALUS).toHaveLength(9);
});

test('A2 Subject ──< Module ──< ALU 引用闭合（§4.2）：互指一致、aluOrder 对齐、module 前缀同 subject', () => {
  for (const pack of SEED_PACKS) {
    const subjectIds = new Set(pack.subjects.map((s) => s.id));
    expect(subjectIds.size).toBe(pack.subjects.length);
    for (const subject of pack.subjects) {
      for (const moduleId of subject.moduleIds) {
        const module = pack.modules.find((m) => m.id === moduleId);
        expect(module).toBeDefined();
        expect(module!.subjectId).toBe(subject.id); // module 回指 subject
      }
    }
    for (const module of pack.modules) {
      expect(subjectIds.has(module.subjectId)).toBe(true);
      expect(module.id.startsWith(`${module.subjectId}.`)).toBe(true);
      for (const aluId of module.aluOrder) {
        const alu = pack.alus.find((a) => a.id === aluId);
        expect(alu).toBeDefined();
        expect(alu!.moduleId).toBe(module.id);
        expect(alu!.subjectId).toBe(module.subjectId);
      }
    }
    for (const alu of pack.alus) {
      expect(pack.modules.some((m) => m.id === alu.moduleId)).toBe(true);
      // aluOrder 覆盖包内全部 ALU（无孤儿卡）
      const inOrder = pack.modules.flatMap((m) => m.aluOrder);
      expect(new Set(inOrder).size).toBe(pack.alus.length);
    }
  }
});

/* ───────────── B. 卡面与 PRD 附录逐字一致（TRACEABILITY 附录行：数据格式依据） ───────────── */

/** PRD 附录样例（通用学习教育Agent_产品方案.md 附录 JSON，逐字；difficulty 为旧刻度）。 */
const APPENDIX = {
  'meta-001': {
    front: "为什么'合上资料自测'比重复阅读有效？",
    back: '检索练习制造 desirable difficulty；一周后回忆率约 80% vs 重复阅读约 35%。',
    variants: ['重读三遍 vs 合书自测一遍，一周后哪个记得多？为什么？'],
    prereq: [] as string[],
    oldDifficulty: 1,
  },
  'meta-002': {
    front: '错题按哪四类归因？最该优先救哪类？',
    back: "不会 / 会用错 / 审题 / 计算；优先救'会用错'（会一半），粗心类只记一行考前扫。",
    variants: ["一道题'思路对但公式用错'属于哪类？该进错题本吗？"],
    prereq: [] as string[],
    oldDifficulty: 1,
  },
  'psy-001': {
    front: 'p 值说的是什么？',
    back: "在 H0 成立前提下，观测到当前或更极端结果的概率；不是'结论为真的概率'。",
    variants: ['p=0.03 是否意味结论有 97% 概率为真？为什么不是？'],
    prereq: [] as string[],
    oldDifficulty: 2,
  },
  'psy-002': {
    front: '实验 / 相关 / 准实验，哪个能支持因果？',
    back: '只有实验（随机分配）能支持因果；相关与准实验无法排除混淆变量。',
    variants: ['按成绩分组比较两种教学法属于哪种设计？能说因果吗？'],
    prereq: ['psy-001'],
    oldDifficulty: 2,
  },
  'psy-003': {
    front: '为什么更该看效应量与 CI，而不只看 p？',
    back: "p 只答'有没有差异'；效应量答'差异多大、是否实用'；CI 给出估计的不确定范围。",
    variants: ['两个都显著的研究，效应量一个 0.2 一个 0.8，你怎么解读？'],
    prereq: ['psy-001'],
    oldDifficulty: 3,
  },
  'psy-004': {
    front: '预注册是什么？它防的是什么？',
    back: '研究开始前公开登记假设与分析计划；防事后按结果改假设（p-hacking / HARKing）。',
    variants: ["'先看数据再定假设'属于哪种问题？预注册怎么阻断它？"],
    prereq: [] as string[],
    oldDifficulty: 2,
  },
  'psy-006': {
    front: '假设检验的标准步骤？',
    back: '①提 H0/H1 ②选 α 与检验统计量 ③算统计量 ④定临界值/p ⑤结论（结合效应量与 CI）。',
    variants: ["把第 ⑤ 步只说成'p<0.05 则显著'会漏掉什么？"],
    prereq: ['psy-001', 'psy-003'],
    oldDifficulty: 2,
  },
  'res-001': {
    front: 'StatQuest：均值/标准差入门短片（入口卡）',
    back: '入口 https://statquest.org/video_index.html',
    variants: [] as string[],
    prereq: [] as string[],
    oldDifficulty: 0,
  },
};

test('B1 附录样例卡 front/back/variants/prereq 逐字一致；难度按 F9 旧 n→新 n+1（资源占位 0）', () => {
  for (const [id, expected] of Object.entries(APPENDIX)) {
    const alu = ALL_SEED_ALUS.find((a) => a.id === id);
    expect(alu, `种子缺附录卡 ${id}`).toBeDefined();
    expect(alu!.front).toBe(expected.front);
    expect(alu!.back).toBe(expected.back);
    expect(alu!.variants).toEqual(expected.variants);
    expect(alu!.prereq).toEqual(expected.prereq);
    expect(alu!.difficulty).toBe(id === 'res-001' ? 0 : expected.oldDifficulty + 1);
  }
});

test('B2 kind 与附录 type 对应；资源卡不进复习队列语义（difficulty 0、无 variants）', () => {
  const byId = Object.fromEntries(ALL_SEED_ALUS.map((a) => [a.id, a]));
  expect(byId['meta-001'].kind).toBe('concept');
  expect(byId['meta-002'].kind).toBe('criterion');
  expect(byId['psy-002'].kind).toBe('criterion');
  expect(byId['psy-006'].kind).toBe('procedure');
  const res = byId['res-001'];
  expect(res.kind).toBe('resource');
  expect(res.difficulty).toBe(0);
  expect(res.variants).toEqual([]);
});

/* ───────────── C. 出处句表对 /skill/ 只读源保真（剥 markdown 结构符后逐字在原文） ───────────── */

/**
 * 剥 markdown 结构字符与空白（两侧同口径），用于"原句存在于源文档"的子串断言。
 * 全角冒号一并剥除：源文档表格行的列间没有冒号，句表把表格两列拼为一句时补的 "：" 两侧同剥。
 */
function stripSource(text: string): string {
  return text.replace(/[\s*|>#\-\`\[\].\/:：]/g, '');
}

test('C1 种子句表逐字来自提分方法论_汇总.md（score-boost references 只读源）', () => {
  const source = stripSource(readFileSync(METHODOLOGY_PATH, 'utf8'));
  for (const sentence of SOURCE_DOC_META.sentenceTexts) {
    expect(source.includes(stripSource(sentence)), `句不在方法论原文：${sentence}`).toBe(true);
  }
});

test('C2 种子句表逐字来自资源清单.md（quick-learning references 只读源）', () => {
  const source = stripSource(readFileSync(CHECKLIST_PATH, 'utf8'));
  for (const sentence of [...SOURCE_DOC_LAKENS.sentenceTexts, ...SOURCE_DOC_CHECKLIST.sentenceTexts]) {
    expect(source.includes(stripSource(sentence)), `句不在资源清单原文：${sentence}`).toBe(true);
  }
  expect(source.includes(stripSource(STATQUEST_ENTRY_TEXT))).toBe(true);
});

/* ───────────── D. 全量过验收闸（§4.3：硬门槛 + 抽样指标） ───────────── */

test('D1 可追溯率 100% 硬门槛：全部种子卡逐卡命中句表，零隔离', () => {
  const result = checkTraceability(ALL_SEED_ALUS, SEED_SOURCE_DOCS);
  expect(result.rate).toBe(1);
  expect(result.isolatedAluIds).toEqual([]);
  expect(result.passed).toHaveLength(ALL_SEED_ALUS.length);
});

test('D2 抽样评审全过 + 白名单齐备 → checkGate verdict=pass', async () => {
  const review = await runSampleReview(ALL_SEED_ALUS, heuristicSampleReviewer, { manualRatio: 1 });
  expect(review.judgeableRate).toBe(1);
  expect(review.granularityRate).toBe(1);
  expect(review.manualRatio).toBeGreaterThanOrEqual(0.2);

  const report = checkGate({
    batchId: 'seed-pack',
    alus: ALL_SEED_ALUS,
    sentenceTables: SEED_SOURCE_DOCS,
    sample: {
      judgeableRate: review.judgeableRate,
      granularityRate: review.granularityRate,
      sampleSize: review.sampleSize,
      llmReview: review.llmReview,
      manualRatio: review.manualRatio,
    },
  });
  expect(report.verdict).toBe('pass');
});

test('D3 reviewWhitelist = 搜索起始白名单（§4.4）：含种子卡引用的全部外部 host', () => {
  expect(SEED_PSYCHOLOGY.reviewWhitelist.length).toBeGreaterThanOrEqual(18);
  expect(SEED_META_COURSE.reviewWhitelist).toEqual([]); // 元课程无外部链接
  for (const alu of SEED_PSYCHOLOGY.alus) {
    if (alu.source.locator.kind === 'url') {
      const host = new URL(alu.source.locator.url).hostname;
      expect(SEED_PSYCHOLOGY.reviewWhitelist).toContain(host);
    }
  }
});

test('D4 出处字段齐备：docId/docTitle/text 非空、span 坐标在句内、知识卡引用句表 docId', () => {
  for (const alu of ALL_SEED_ALUS) {
    expect(alu.source.docId.trim().length).toBeGreaterThan(0);
    expect(alu.source.docTitle.trim().length).toBeGreaterThan(0);
    expect(alu.source.text.trim().length).toBeGreaterThan(0);
    if (alu.source.locator.kind === 'span') {
      const sentence = SEED_SOURCE_DOCS[alu.source.docId].sentenceTexts[alu.source.locator.sentenceIndex!];
      expect(sentence).toBeDefined();
      expect(alu.source.locator.end).toBeLessThan(sentence.length);
      expect(sentence.slice(alu.source.locator.start, alu.source.locator.end + 1)).toBe(alu.source.text);
    }
  }
});
