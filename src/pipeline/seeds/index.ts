/**
 * 种子内容包汇总（M5，PRD §0.1①② / CONTRACTS §8）。
 * 种子内容 = 人机分工的种子集（PRD §9：切分失败风险的人机分工缓解），
 * 全量经验收闸（pipeline-seeds.test 断言可追溯率 100% + 抽样指标过门槛）。
 */
import type { Alu, Module, Subject } from '../../domain/alu';
import type { SourceDoc } from '../splitter';
import { META_ALUS, META_MODULES, META_SUBJECT, SOURCE_DOC_META } from './meta-course';
import {
  PSY_ALUS, PSY_MODULES, PSY_REVIEW_WHITELIST, PSY_SUBJECT,
  SOURCE_DOC_CHECKLIST, SOURCE_DOC_LAKENS,
} from './psychology';

/** 种子内容包格式（CONTRACTS §8，逐字一致）。 */
export interface SeedContentPack {
  packId: string; version: string;
  layer: 'meta_course' | 'real_subject';   // ①学习科学=首启元课程 ②首个真实学科
  subjects: Subject[]; modules: Module[]; alus: Alu[];
  reviewWhitelist: string[];               // 外部链接 = 出处字段 + 搜索起始白名单（§4.4）
}

/** ①首启元课程（学习科学）。 */
export const SEED_META_COURSE: SeedContentPack = {
  packId: 'seed-meta-course',
  version: '1.0.0',
  layer: 'meta_course',
  subjects: [META_SUBJECT],
  modules: META_MODULES,
  alus: META_ALUS,
  reviewWhitelist: [],
};

/** ②首个真实学科（心理学研究方法）。 */
export const SEED_PSYCHOLOGY: SeedContentPack = {
  packId: 'seed-psychology',
  version: '1.0.0',
  layer: 'real_subject',
  subjects: [PSY_SUBJECT],
  modules: PSY_MODULES,
  alus: PSY_ALUS,
  reviewWhitelist: PSY_REVIEW_WHITELIST,
};

/** V1 内置种子包（M5 全量过闸；首启装配顺序 = 元课程在前，§6 方案 D）。 */
export const SEED_PACKS: readonly SeedContentPack[] = [SEED_META_COURSE, SEED_PSYCHOLOGY];

/** 种子句表汇总（gate.checkTraceability 的强校验依据；docId → 句表）。 */
export const SEED_SOURCE_DOCS: Readonly<Record<string, SourceDoc>> = Object.fromEntries(
  [SOURCE_DOC_META, SOURCE_DOC_LAKENS, SOURCE_DOC_CHECKLIST].map((doc) => [doc.docId, doc]),
);

/** 全部种子 ALU（两包拼接；顺序 = 元课程 → 心理学）。 */
export const ALL_SEED_ALUS: readonly Alu[] = [...META_ALUS, ...PSY_ALUS];
