/**
 * 种子内容包①·首启元课程（M5，PRD §0.1①/§4.4 / CONTRACTS §8 SeedContentPack）。
 *
 * 内容源：/skill/score-boost/references/提分方法论_汇总.md（学习科学域，单一域不伪装跨域）。
 * 卡面 = PRD 附录样例逐字（meta-001/002）；meta-003 为间隔复测卡（同源句锚定）。
 * 出处句表 = 方法论原文句（剥 markdown 结构符净文本，逐字；保真由 pipeline-seeds.test 断言）。
 * TextSpan 口径：start/end 为锚句内字符区间（含），sentenceIndex 指向句表下标，
 * 命中坐标与 splitter.locateSpan 首个归一化命中一致。
 */
import { createAlu, type Alu, type Module, type SourceRef, type Subject } from '../../domain/alu';
import type { SourceDoc } from '../splitter';

/** 方法论文档 docId（score-boost 技能包 references 同源；psy-006 也锚定此表）。 */
export const META_DOC_ID = 'score-boost-methodology';

/** 句表：提分方法论原文句（剥 markdown 结构符净文本；顺序即 sentenceIndex）。 */
export const SOURCE_DOC_META: SourceDoc = {
  docId: META_DOC_ID,
  docTitle: '提分方法论·汇总',
  sentenceTexts: [
    // 行 12（表格行，剥 |/** 净文本）
    '检索练习（practice testing）：合上资料先回忆/自测，再对答案',
    'Dunlosky 评级：高效；一周后回忆率约 80% vs 重复阅读约 35%',
    // 行 13
    '间隔练习（distributed practice）：把复习打散到多天，而非一次性堆',
    'Dunlosky 评级：高效；Cepeda 2006 元分析 254 项研究，间隔约为集中学习的 2 倍保持率',
    // 行 33（剥序号 6.）
    '间隔复测：按 1-2-4-7-15 天复测，连续两次用新题做对才算过关。',
    // 行 67
    '错因归类：每次错题标注为「不会 / 会用错 / 审题 / 计算」四类，统计哪类最多就专攻哪类',
    // 行 144
    '统计题：写公式、写步骤、写结论三句话',
  ],
};

/** 锚句内整句 span（净文本句的句内区间；gate 按此坐标命中校验）。 */
function fullSpan(sentenceIndex: number): SourceRef['locator'] {
  const sentence = SOURCE_DOC_META.sentenceTexts[sentenceIndex];
  return { kind: 'span', start: 0, end: sentence.length - 1, sentenceIndex };
}

function metaSource(docTitle: string, sentenceIndex: number): SourceRef {
  return {
    docId: META_DOC_ID,
    docTitle,
    locator: fullSpan(sentenceIndex),
    text: SOURCE_DOC_META.sentenceTexts[sentenceIndex],
  };
}

export const META_SUBJECT: Subject = { id: 'meta', name: '学习科学', moduleIds: ['meta.practice', 'meta.mistake', 'meta.spacing'] };

export const META_MODULES: Module[] = [
  { id: 'meta.practice', subjectId: 'meta', name: '检索练习', aluOrder: ['meta-001'] },
  { id: 'meta.mistake', subjectId: 'meta', name: '错题管理', aluOrder: ['meta-002'] },
  { id: 'meta.spacing', subjectId: 'meta', name: '间隔复习', aluOrder: ['meta-003'] },
];

/** 首启元课程卡（附录样例逐字；难度按 F9 旧刻度 n→新 n+1 抬升）。 */
export const META_ALUS: Alu[] = [
  createAlu({
    id: 'meta-001',
    subjectId: 'meta',
    moduleId: 'meta.practice',
    kind: 'concept',
    front: "为什么'合上资料自测'比重复阅读有效？",
    back: '检索练习制造 desirable difficulty；一周后回忆率约 80% vs 重复阅读约 35%。',
    variants: ['重读三遍 vs 合书自测一遍，一周后哪个记得多？为什么？'],
    prereq: [],
    difficulty: 2, // 附录 1 → 新刻度 2（F9）
    source: metaSource('提分方法论 §一·Karpicke & Roediger 2008', 1),
  }),
  createAlu({
    id: 'meta-002',
    subjectId: 'meta',
    moduleId: 'meta.mistake',
    kind: 'criterion',
    front: '错题按哪四类归因？最该优先救哪类？',
    back: "不会 / 会用错 / 审题 / 计算；优先救'会用错'（会一半），粗心类只记一行考前扫。",
    variants: ["一道题'思路对但公式用错'属于哪类？该进错题本吗？"],
    prereq: [],
    difficulty: 2, // 附录 1 → 新刻度 2（F9）
    source: metaSource('提分方法论 §二、§三', 5),
  }),
  createAlu({
    id: 'meta-003',
    subjectId: 'meta',
    moduleId: 'meta.spacing',
    kind: 'procedure',
    front: '错题/新学的卡按什么节奏复测才算过关？',
    back: '按 1-2-4-7-15 天复测，连续两次用新题做对才算过关。',
    variants: ['第 7 天重做原题算过关吗？为什么？'],
    prereq: [],
    difficulty: 2,
    source: metaSource('提分方法论 §二·间隔复测', 4),
  }),
];
