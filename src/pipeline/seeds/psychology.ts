/**
 * 种子内容包②·心理学研究方法（M5，PRD §0.1②/§4.4 / CONTRACTS §8 SeedContentPack）。
 *
 * 内容源：/skill/quick-learning/references/资源清单.md（档1 部分）+ 提分方法论；
 * 卡面 = PRD 附录样例逐字（psy-001~004/006、res-001；psy-005 两份源文档无对应原句，
 * 无真实出处可锚定，不入种子——出处真实性优先于样例齐全）。
 * 出处：知识卡用句内 TextSpan 锚定清单/方法论原句；资源入口卡用 UrlLocator（外部链接 =
 * 出处字段 + 搜索起始白名单，§4.4）。难度按 F9 旧刻度 n→新 n+1 抬升，资源占位 0。
 */
import { createAlu, type Alu, type Module, type SourceRef, type Subject } from '../../domain/alu';
import { META_DOC_ID, SOURCE_DOC_META } from './meta-course';
import type { SourceDoc } from '../splitter';

/** Lakens《Improving Your Statistical Inferences》条目（清单 1.2）。 */
export const DOC_LAKENS = 'lakens-isi';
/** 档1 自检条目（清单 1.6，剥列表符净文本）。 */
export const DOC_CHECKLIST = 'quick-checklist';

export const SOURCE_DOC_LAKENS: SourceDoc = {
  docId: DOC_LAKENS,
  docTitle: '档1·Lakens《Improving Your Statistical Inferences》',
  // 清单行 19（剥链接净文本）
  sentenceTexts: ['Lakens《Improving Your Statistical Inferences》（先读 p 值 / 效应量 / CI 三章）'],
};

export const SOURCE_DOC_CHECKLIST: SourceDoc = {
  docId: DOC_CHECKLIST,
  docTitle: '档1·自检题',
  sentenceTexts: [
    // 行 42
    '差异：实验 vs 相关 vs 准实验；自变量/因变量/混淆变量',
    // 行 43
    'p 值到底在说什么？效应量和 CI 为什么更该看？',
    // 行 44
    '预注册是什么、为什么能防 p-hacking',
  ],
};

/** 锚句整句 span（净句内区间；坐标与 splitter.locateSpan 首个归一化命中一致）。 */
function spanOf(doc: SourceDoc, sentenceIndex: number): SourceRef['locator'] {
  const sentence = doc.sentenceTexts[sentenceIndex];
  return { kind: 'span', start: 0, end: sentence.length - 1, sentenceIndex };
}

function listSource(doc: SourceDoc, docTitle: string, sentenceIndex: number): SourceRef {
  return { docId: doc.docId, docTitle, locator: spanOf(doc, sentenceIndex), text: doc.sentenceTexts[sentenceIndex] };
}

/** StatQuest 入口（清单行 51 剥链接净句；res-001 出处 text）。 */
export const STATQUEST_ENTRY_TEXT = 'StatQuest 视频总索引（Josh Starmer，一个概念一个短片，从均值/标准差开始按序看）';

export const PSY_SUBJECT: Subject = {
  id: 'psy-methods',
  name: '心理学研究方法',
  moduleIds: ['psy-methods.inference', 'psy-methods.design', 'psy-methods.open-science', 'psy-methods.testing', 'psy-methods.resources'],
};

export const PSY_MODULES: Module[] = [
  { id: 'psy-methods.inference', subjectId: 'psy-methods', name: '统计推断', aluOrder: ['psy-001', 'psy-003'] },
  { id: 'psy-methods.design', subjectId: 'psy-methods', name: '研究设计', aluOrder: ['psy-002'] },
  { id: 'psy-methods.open-science', subjectId: 'psy-methods', name: '开放科学', aluOrder: ['psy-004'] },
  { id: 'psy-methods.testing', subjectId: 'psy-methods', name: '假设检验', aluOrder: ['psy-006'] },
  { id: 'psy-methods.resources', subjectId: 'psy-methods', name: '统计入门', aluOrder: ['res-001'] },
];

/** 心理学原理卡 + 资源入口卡（附录样例逐字；知识卡难度按 F9 抬升 n+1）。 */
export const PSY_ALUS: Alu[] = [
  createAlu({
    id: 'psy-001',
    subjectId: 'psy-methods',
    moduleId: 'psy-methods.inference',
    kind: 'concept',
    front: 'p 值说的是什么？',
    back: "在 H0 成立前提下，观测到当前或更极端结果的概率；不是'结论为真的概率'。",
    variants: ['p=0.03 是否意味结论有 97% 概率为真？为什么不是？'],
    prereq: [],
    difficulty: 3, // 附录 2 → 新刻度 3（F9）
    source: listSource(SOURCE_DOC_LAKENS, SOURCE_DOC_LAKENS.docTitle, 0),
  }),
  createAlu({
    id: 'psy-002',
    subjectId: 'psy-methods',
    moduleId: 'psy-methods.design',
    kind: 'criterion',
    front: '实验 / 相关 / 准实验，哪个能支持因果？',
    back: '只有实验（随机分配）能支持因果；相关与准实验无法排除混淆变量。',
    variants: ['按成绩分组比较两种教学法属于哪种设计？能说因果吗？'],
    prereq: ['psy-001'],
    difficulty: 3, // 附录 2 → 3
    source: listSource(SOURCE_DOC_CHECKLIST, '档1·自检题', 0),
  }),
  createAlu({
    id: 'psy-003',
    subjectId: 'psy-methods',
    moduleId: 'psy-methods.inference',
    kind: 'criterion',
    front: '为什么更该看效应量与 CI，而不只看 p？',
    back: "p 只答'有没有差异'；效应量答'差异多大、是否实用'；CI 给出估计的不确定范围。",
    variants: ['两个都显著的研究，效应量一个 0.2 一个 0.8，你怎么解读？'],
    prereq: ['psy-001'],
    difficulty: 4, // 附录 3 → 4
    source: listSource(SOURCE_DOC_LAKENS, SOURCE_DOC_LAKENS.docTitle, 0),
  }),
  createAlu({
    id: 'psy-004',
    subjectId: 'psy-methods',
    moduleId: 'psy-methods.open-science',
    kind: 'concept',
    front: '预注册是什么？它防的是什么？',
    back: '研究开始前公开登记假设与分析计划；防事后按结果改假设（p-hacking / HARKing）。',
    variants: ["'先看数据再定假设'属于哪种问题？预注册怎么阻断它？"],
    prereq: [],
    difficulty: 3, // 附录 2 → 3
    source: listSource(SOURCE_DOC_CHECKLIST, '档1·Munafò 2017 / AsPredicted', 2),
  }),
  createAlu({
    id: 'psy-006',
    subjectId: 'psy-methods',
    moduleId: 'psy-methods.testing',
    kind: 'procedure',
    front: '假设检验的标准步骤？',
    back: '①提 H0/H1 ②选 α 与检验统计量 ③算统计量 ④定临界值/p ⑤结论（结合效应量与 CI）。',
    variants: ["把第 ⑤ 步只说成'p<0.05 则显著'会漏掉什么？"],
    prereq: ['psy-001', 'psy-003'],
    difficulty: 3, // 附录 2 → 3
    // 锚定提分方法论句表句 6（"统计题：写公式、写步骤、写结论三句话"，SOURCE_DOC_META）
    source: {
      docId: META_DOC_ID,
      docTitle: '提分方法论·统计题答题三句话',
      locator: spanOf(SOURCE_DOC_META, 6),
      text: SOURCE_DOC_META.sentenceTexts[6],
    },
  }),
  createAlu({
    id: 'res-001',
    subjectId: 'psy-methods',
    moduleId: 'psy-methods.resources',
    kind: 'resource',
    front: 'StatQuest：均值/标准差入门短片（入口卡）',
    back: '入口 https://statquest.org/video_index.html',
    variants: [],
    prereq: [],
    difficulty: 0, // 资源型占位 0
    source: { docId: 'video-list', docTitle: '视频清单·档1', locator: { kind: 'url', url: 'https://statquest.org/video_index.html' }, text: STATQUEST_ENTRY_TEXT },
  }),
];

/** 搜索起始白名单（§4.4：资源清单全部外部链接 host，域名无协议前缀）。 */
export const PSY_REVIEW_WHITELIST: string[] = [
  'forrt.org',
  'dictionary.apa.org',
  'youtube.com',
  'lakens.github.io',
  'nature.com',
  'experimentology.io',
  'cssn.cn',
  'icourse163.org',
  'xuetangx.com',
  'jamovi.org',
  'jasp-stats.org',
  'aspredicted.org',
  'osf.io',
  'statquest.org',
  'bilibili.com',
  'classcentral.com',
  'bryankoenig.wixsite.com',
  '3blue1brown.com',
];
