/**
 * 切分器（M5，PRD §4.3 / CONTRACTS §8）。
 *
 * 职责边界：真实"读资料出卡"由云侧 sub-agent 独立窗口完成（§7.7⑤：读资料 → 只回传 ALU 列表 JSON，
 * 形状即 PRD 附录样例）；本模块是端侧的程序化切分管线——把 sub-agent 回传的候选卡草案
 * （SplitCandidate，附录样例 JSON 的类型化 + 锚句字段）锚定回原文句表，计算句子级出处 span
 * （创建时即写，回链不自研），并做 §4.3 两层分流：
 *   - 知识型条目 → 可测 ALU（knowledgeAlus，进验收闸 → 复习队列）
 *   - 资源型条目 → 入口卡（resourceEntries，kind='resource'，不进队列）
 * 锚句无法在原文命中的候选一律拒收（不出卡）——可追溯率 100% 硬门槛在创建侧的第一道收口。
 */
import type { AluId, AluKind } from '../domain/types';
import { createAlu, type Alu, type SourceRef } from '../domain/alu';

/** 切分器输出（CONTRACTS §8，逐字一致）。 */
export interface SplitterOutput {
  batchId: string;
  knowledgeAlus: Alu[];        // 知识型 → 可测 ALU（进验收闸→复习队列）
  resourceEntries: Alu[];      // 资源型 → 入口卡（kind='resource'，不进队列）
  sourceDoc: { docId: string; docTitle: string; sentenceTexts: string[] }; // 原文句表（回链校验依据）
}

/** 原文句表（SplitterOutput.sourceDoc 的具名形状；种子包句表同构复用）。 */
export interface SourceDoc {
  docId: string;
  docTitle: string;
  sentenceTexts: string[];
}

/**
 * sub-agent 回传的候选卡草案（PRD 附录样例 JSON 的类型化 + 锚句协议）。
 * type 收中文原语（"概念/判据/过程/资源"，附录逐字）与英文 AluKind 两种写法；
 * anchorText 必须是原文原句（禁止改写）——找不到即拒收。
 */
export interface SplitCandidate {
  id: AluId;
  type: string;
  module: string;
  front: string;
  back: string;
  variants?: string[];
  prereq?: AluId[];
  difficulty?: number;
  anchorText: string;
  /** 可选提示：候选声称命中的句序号（句表下标），命中则优先采用 */
  anchorSentenceIndex?: number;
  /** 资源型条目的入口链接（缺省时入口卡回退句内 span 出处） */
  url?: string;
}

/** 中文原语 → AluKind（§4.1；附录样例 type 字段为中文）。 */
const KIND_BY_LABEL: Readonly<Record<string, AluKind>> = {
  '概念': 'concept',
  '判据': 'criterion',
  '过程': 'procedure',
  '资源': 'resource',
  concept: 'concept',
  criterion: 'criterion',
  procedure: 'procedure',
  resource: 'resource',
};

const isWhitespace = (c: string): boolean => /\s/.test(c);

/**
 * 句切分：以换行为界（"句" = 原文条目行，回链展示与跳转的最小单位；
 * V1 语料即清单/方法论型，条目行 = 自检题/资源条目/表格行，天然对齐 PRD 附录 source 例），
 * 滤除空白行与纯符号行。行内不做标点二次切分——锚句允许是完整条目行。
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const raw of text.split(/\n+/)) {
    const s = raw.trim();
    if (s.length === 0) continue;
    // 纯标点/符号残余（如 "---"）不成句
    if (!/[\p{L}\p{N}]/u.test(s)) continue;
    sentences.push(s);
  }
  return sentences;
}

/** 构建原文句表（切分与回链校验的唯一依据）。 */
export function buildSourceDoc(docId: string, docTitle: string, text: string): SourceDoc {
  return { docId, docTitle, sentenceTexts: splitSentences(text) };
}

/**
 * 归一化区间定位：在 sentence 中找 anchor 的匹配区间（忽略两侧空白差异），
 * 返回原句内字符区间 [start, end]（含，CONTRACTS §1 TextSpan 口径）。
 * 逐字符双指针跳空白匹配，空白差异不破坏命中；改写字符则不命中。
 */
export function findNormalizedRange(sentence: string, anchor: string): [number, number] | null {
  const a = anchor.trim();
  if (a.length === 0) return null;
  let start = 0;
  while (start < sentence.length) {
    while (start < sentence.length && isWhitespace(sentence[start])) start++;
    let si = start;
    let ai = 0;
    let lastNonWs = -1;
    while (si < sentence.length && ai < a.length) {
      if (isWhitespace(sentence[si])) { si++; continue; }
      if (isWhitespace(a[ai])) { ai++; continue; }
      if (sentence[si] !== a[ai]) break;
      lastNonWs = si;
      si++;
      ai++;
    }
    while (ai < a.length && isWhitespace(a[ai])) ai++;
    if (ai === a.length && lastNonWs >= start) return [start, lastNonWs];
    start = (lastNonWs >= start ? si : start) + 1;
  }
  return null;
}

/**
 * 在句表中定位锚句：先按 hintIndex 精确候选，否则全表扫描（取首个命中句）。
 * 返回句内 span + sentenceIndex；找不到返回 null（该候选拒收）。
 */
export function locateSpan(
  sentenceTexts: string[],
  anchorText: string,
  hintIndex?: number,
): { sentenceIndex: number; start: number; end: number } | null {
  const trySentence = (index: number): { sentenceIndex: number; start: number; end: number } | null => {
    const range = findNormalizedRange(sentenceTexts[index], anchorText);
    return range === null ? null : { sentenceIndex: index, start: range[0], end: range[1] };
  };
  if (hintIndex !== undefined && hintIndex >= 0 && hintIndex < sentenceTexts.length) {
    const hit = trySentence(hintIndex);
    if (hit !== null) return hit;
  }
  for (let i = 0; i < sentenceTexts.length; i++) {
    if (i === hintIndex) continue;
    const hit = trySentence(i);
    if (hit !== null) return hit;
  }
  return null;
}

/** SourceRef.text = span 覆盖的命中原文（被切分命中的原句原文，校验与回链展示用）。 */
function anchorTextOf(sentenceTexts: string[], sentenceIndex: number, start: number, end: number): string {
  return sentenceTexts[sentenceIndex].slice(start, end + 1);
}

/**
 * 两层分流切分（唯一入口）：候选草案 → 锚定 → createAlu → 按 kind 分流。
 * moduleId 规范为 "subjectId.module" 形态（§4.2 Subject ──< Module ──< ALU；
 * 候选自带点号命名空间时原样保留）。
 * 拒收情形（不出卡）：锚句无法命中原文 / type 无法识别 / id 重复 / createAlu 校验失败。
 */
export function splitToAlus(
  batchId: string,
  subjectId: string,
  doc: SourceDoc,
  candidates: readonly SplitCandidate[],
): SplitterOutput {
  const knowledgeAlus: Alu[] = [];
  const resourceEntries: Alu[] = [];
  const seenIds = new Set<AluId>();

  for (const candidate of candidates) {
    const kind = KIND_BY_LABEL[candidate.type];
    if (kind === undefined) continue;
    if (seenIds.has(candidate.id)) continue;
    const span = locateSpan(doc.sentenceTexts, candidate.anchorText, candidate.anchorSentenceIndex);
    if (span === null) continue;

    const isResource = kind === 'resource';
    const locator: SourceRef['locator'] =
      isResource && candidate.url && candidate.url.trim().length > 0
        ? { kind: 'url', url: candidate.url.trim() }
        : { kind: 'span', start: span.start, end: span.end, sentenceIndex: span.sentenceIndex };
    const source: SourceRef = {
      docId: doc.docId,
      docTitle: doc.docTitle,
      locator,
      text: anchorTextOf(doc.sentenceTexts, span.sentenceIndex, span.start, span.end),
    };
    const moduleId = candidate.module.includes('.') ? candidate.module : `${subjectId}.${candidate.module}`;
    let alu: Alu;
    try {
      alu = createAlu({
        id: candidate.id,
        subjectId,
        moduleId,
        kind,
        front: candidate.front,
        back: candidate.back,
        variants: candidate.variants,
        prereq: candidate.prereq,
        difficulty: isResource ? 0 : candidate.difficulty,
        source,
      });
    } catch {
      continue; // 最小完备性不满足（空正题/自环 prereq 等）：拒收
    }
    seenIds.add(candidate.id);
    if (isResource) resourceEntries.push(alu);
    else knowledgeAlus.push(alu);
  }

  return { batchId, knowledgeAlus, resourceEntries, sourceDoc: doc };
}
