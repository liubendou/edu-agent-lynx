/**
 * 仓库层通用基础（ARCHITECTURE §12：分集合 JSON 持久化）。
 */
import type { KVStore } from '../kv';

/** 集合存储 key（edu_agent_storage 命名空间内的固定 key）。 */
export const COLLECTION_KEYS = {
  alu: 'edu:col:alu',
  alu_state: 'edu:col:alu_state',
  review_log: 'edu:col:review_log',
  profile: 'edu:col:profile',
  session_summaries: 'edu:col:session_summaries',
  settings: 'edu:col:settings',
  gate_reports: 'edu:col:gate_reports',
  grayscale: 'edu:col:grayscale',
  budget: 'edu:col:budget',
} as const;

export type CollectionKey = (typeof COLLECTION_KEYS)[keyof typeof COLLECTION_KEYS];

/** 单集合 JSON 读写（整集合读写；V1 量级可控，ARCHITECTURE R3）。 */
export interface JsonCollection<T> {
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
  remove(): Promise<void>;
}

export function createJsonCollection<T>(kv: KVStore, key: CollectionKey): JsonCollection<T> {
  return {
    async load() {
      const raw = await kv.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    },
    async save(value: T) {
      await kv.set(key, JSON.stringify(value));
    },
    async remove() {
      await kv.remove(key);
    },
  };
}

/**
 * Card 的 JSON 往返 Date 恢复：序列化把 due/last_review 变 ISO 字符串，
 * 读侧（listAluStates/loadAll 等）统一恢复为 Date，保证域层 Date 方法可用。
 */
export function reviveCardDates<T extends { fsrs: { due: unknown; last_review?: unknown } }>(state: T): T {
  const fsrs = state.fsrs as { due: string | number | Date; last_review?: string | number | Date | null };
  const revived: Record<string, unknown> = {
    ...fsrs,
    due: new Date(fsrs.due),
  };
  if (fsrs.last_review !== undefined && fsrs.last_review !== null) {
    revived['last_review'] = new Date(fsrs.last_review);
  }
  return { ...state, fsrs: revived as T['fsrs'] };
}

/** 整个 alu_state 集合的读侧恢复。 */
export function reviveAluStateCollection<C extends Record<string, { fsrs: { due: unknown; last_review?: unknown } }>>(
  collection: C,
): C {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(collection)) {
    out[id] = reviveCardDates(collection[id]);
  }
  return out as C;
}
