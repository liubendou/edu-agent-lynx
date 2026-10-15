/**
 * 内置技能包资产索引（源：/skill/ 只读；ARCHITECTURE §1/§11）。
 * 5 包：四档（pattern）+ score-boost（knowledge）。内置包为热更新失败时的兜底（D3）。
 */
import type { PackAsset } from '../runtime';
import { quickLearning } from './quick-learning';
import { review } from './review';
import { standardLearning } from './standard-learning';
import { deepLearning } from './deep-learning';
import { scoreBoost } from './score-boost';

/** 内置包列表（顺序即常驻索引顺序）。 */
export const BUILT_IN_PACKS: PackAsset[] = [quickLearning, review, standardLearning, deepLearning, scoreBoost];

/** 内置包按名索引（updater 版本比对基线 / runtime 内置兜底取用）。 */
export const BUILT_IN_PACK_MAP: ReadonlyMap<PackAsset['summary']['name'], PackAsset> = new Map(
  BUILT_IN_PACKS.map((p) => [p.summary.name, p]),
);
