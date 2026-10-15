/**
 * 验收闸（M5，PRD §4.3 / CONTRACTS §8）。
 *
 * 三指标分硬门槛与抽样两类：
 *   - 可追溯率：程序化逐卡校验"回链存在且原文可命中"，100% 硬门槛；
 *     不达标者进 isolatedAluIds 隔离、不入复习队列，批次 verdict 直接 fail。
 *   - 可判对错率（≥90%）/ 颗粒度合格率（≥85%）：抽样评审产出（sampler.ts），闸只做判定。
 * 灰度判定：连续两批 pass → 扩大灰度（auto_split）；任一 fail → 退回种子内容模式（seed）。
 */
import type { AluId } from '../domain/types';
import type { Alu, SourceRef } from '../domain/alu';
import type { GateReport, GrayscaleState } from '../storage/repos';
import { findNormalizedRange } from './splitter';

/** 初始阈值（PRD §4.3：标注为初始值，用前两批真实切分校准）。 */
export const GATE_THRESHOLDS = { judgeable: 0.9, granularity: 0.85 } as const;
/** 人工抽检占比下限（≥20%，与 LLM 评审并行）。 */
export const MANUAL_REVIEW_RATIO = 0.2;

/** 句表提供者：docId → 句表（splitter 产物或种子包内嵌句表，结构同 SourceDoc）。 */
export type SentenceTables = Readonly<Record<string, { sentenceTexts: readonly string[] }>>;

export interface TraceabilityResult {
  /** 通过卡 / 全部卡（资源入口卡同标准：回链存在且可命中） */
  rate: number;
  /** 通过校验的卡（抽样评审在此集合上进行） */
  passed: Alu[];
  /** 隔离名单：不入复习队列 */
  isolatedAluIds: AluId[];
}

interface TraceIssue {
  aluId: AluId;
  reason: string;
}

const isHttpUrl = (url: string): boolean => /^https?:\/\/\S+$/.test(url);

/** 逐卡校验（checkTraceability 的诊断明细；pass 的卡不在列）。 */
export function diagnoseTraceability(
  alus: readonly Alu[],
  tables: SentenceTables = {},
): TraceIssue[] {
  const issues: TraceIssue[] = [];
  for (const alu of alus) {
    const reject = (reason: string) => issues.push({ aluId: alu.id, reason });
    const src: SourceRef | undefined = alu.source;
    if (!src || typeof src.docId !== 'string' || src.docId.trim().length === 0) {
      reject('source.docId missing');
      continue;
    }
    if (typeof src.docTitle !== 'string' || src.docTitle.trim().length === 0) {
      reject('source.docTitle missing');
      continue;
    }
    if (typeof src.text !== 'string' || src.text.trim().length === 0) {
      reject('source.text missing');
      continue;
    }
    const locator = src.locator;
    if (!locator || typeof locator !== 'object') {
      reject('source.locator missing');
      continue;
    }
    if (locator.kind === 'url') {
      if (!isHttpUrl(locator.url)) reject('source.locator.url not a valid http(s) url');
      continue;
    }
    if (locator.kind === 'span') {
      const { start, end, sentenceIndex } = locator;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        reject('source.locator.span invalid range');
        continue;
      }
      if (typeof sentenceIndex !== 'number' || !Number.isInteger(sentenceIndex) || sentenceIndex < 0) {
        reject('source.locator.span invalid sentenceIndex');
        continue;
      }
      const table = tables[src.docId]?.sentenceTexts;
      if (table === undefined) {
        // 无句表可查（如种子包未注入句表的旁路校验）：只做结构校验；
        // 正式批次必须携带句表做"原文可命中"强校验（见 checkTraceability 注入约定）。
        continue;
      }
      const sentence: string | undefined = table[sentenceIndex];
      if (sentence === undefined) {
        reject('source.locator.span sentenceIndex out of range');
        continue;
      }
      const range = findNormalizedRange(sentence, src.text);
      if (range === null || range[0] !== start || range[1] !== end) {
        reject('source.text not found at span (原文不可命中)');
        continue;
      }
      continue;
    }
    reject('source.locator unknown kind');
  }
  return issues;
}

/**
 * 可追溯率程序化逐卡校验（§4.3 硬门槛）：回链存在且原文可命中。
 * tables 注入句表（splitter 批次传 SplitterOutput.sourceDoc；种子包传内嵌句表）——
 * TextSpan 卡做 span 坐标级命中强校验；无句表的旁路调用退化为结构校验。
 */
export function checkTraceability(alus: readonly Alu[], tables: SentenceTables = {}): TraceabilityResult {
  const issues = diagnoseTraceability(alus, tables);
  const badIds = new Set(issues.map((i) => i.aluId));
  const passed = alus.filter((a) => !badIds.has(a.id));
  const rate = alus.length === 0 ? 1 : passed.length / alus.length;
  return { rate, passed, isolatedAluIds: [...badIds] };
}

export interface GateInput {
  batchId: string;
  /** 待验收批次（splitter 产物 knowledgeAlus + resourceEntries 全量） */
  alus: readonly Alu[];
  /** 句表注入（硬门槛强校验依据；正式批次必传） */
  sentenceTables?: SentenceTables;
  /** 抽样评审结果；缺省 = 尚未抽样（verdict=pending_sample） */
  sample?: {
    judgeableRate: number;
    granularityRate: number;
    sampleSize: number;
    llmReview: boolean;
    /** 实际完成人工抽检的占比（≥MANUAL_REVIEW_RATIO 为达标口径，仅记录不参与 verdict） */
    manualRatio: number;
  };
  now?: () => Date;
}

/**
 * 验收闸主入口：程序化可追溯校验 + 抽样指标判定。
 *   - 可追溯率 < 100% → fail（隔离名单照报，坏卡绝不放行）。
 *   - 未抽样 → pending_sample（灰度不推进不清零，updateGrayscale 原样返回）。
 *   - pass ⇔ 可追溯 100% 且 judgeable ≥0.9 且 granularity ≥0.85。
 */
export function checkGate(input: GateInput): GateReport {
  const trace = checkTraceability(input.alus, input.sentenceTables);
  const sample = input.sample;
  let verdict: GateReport['verdict'];
  if (trace.rate < 1) {
    verdict = 'fail';
  } else if (!sample || sample.sampleSize === 0) {
    verdict = 'pending_sample';
  } else {
    verdict =
      sample.judgeableRate >= GATE_THRESHOLDS.judgeable && sample.granularityRate >= GATE_THRESHOLDS.granularity
        ? 'pass'
        : 'fail';
  }
  return {
    batchId: input.batchId,
    traceability: { rate: trace.rate, isolatedAluIds: trace.isolatedAluIds },
    judgeable: {
      rate: sample ? sample.judgeableRate : 0,
      sampleSize: sample ? sample.sampleSize : 0,
      llmReview: sample ? sample.llmReview : false,
      manualRatio: sample ? sample.manualRatio : 0,
    },
    granularity: { rate: sample ? sample.granularityRate : 0, sampleSize: sample ? sample.sampleSize : 0 },
    verdict,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

/**
 * 灰度判定（§4.3）：连续两批 pass → 扩大灰度；任一 fail → 退回种子内容模式；
 * pending_sample（抽样未完成）不推进也不清零。
 */
export function updateGrayscale(prev: GrayscaleState, verdict: GateReport['verdict']): GrayscaleState {
  if (verdict === 'pending_sample') return prev;
  if (verdict === 'fail') return { consecutivePasses: 0, mode: 'seed' };
  const consecutivePasses = prev.consecutivePasses + 1;
  return { consecutivePasses, mode: consecutivePasses >= 2 ? 'auto_split' : prev.mode };
}
