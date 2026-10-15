/**
 * judge 延迟提交（1 秒撤销窗口，UID §三 / ARCHITECTURE §12 / CONTRACTS §10 注）：
 * judge 写入在撤销期内不落盘、不进 review_log；撤销即取消；flush = 回合边界立即提交。
 * review_log 仅含 correct/wrong（fuzzy 不落盘，D8；revoked 不落盘）。
 */
import type { AluUserState, AnswerRecord } from '../../domain/alu';
import type { AluId } from '../../domain/types';
import type { KVStore } from '../kv';
import { COLLECTION_KEYS, createJsonCollection } from './common';

/** 一次 judge 的待写内容：更新后的用户状态 + 作答记录（fuzzy/撤销 → record 传 null 或 revoked）。 */
export interface JudgeWritePayload {
  aluState: AluUserState;
  /** correct/wrong 记录；fuzzy 恒 null（D8：不落 review_log） */
  record: AnswerRecord | null;
}

export interface JudgeCommitOptions {
  /** 撤销窗口时长（默认 1000ms，UID §三） */
  delayMs?: number;
}

interface PendingEntry {
  aluId: AluId;
  payload: JudgeWritePayload;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * judge 写入延迟提交器：
 * - submit()：暂存 + 定时提交（窗口期内不落盘不进日志）；
 * - revoke()：撤销未落盘提交（AnswerRecord.revoked 语义），返回被撤销 payload；
 * - flush()：立即提交全部 pending（回合边界批量落盘）。
 * 落盘动作 = alu_state 集合更新该卡 + review_log 追加非 fuzzy/非 revoked 记录。
 */
export class JudgeCommitter {
  private readonly kv: KVStore;
  private readonly delayMs: number;
  private readonly pending = new Map<AluId, PendingEntry>();

  constructor(kv: KVStore, opts: JudgeCommitOptions = {}) {
    this.kv = kv;
    this.delayMs = opts.delayMs ?? 1000;
  }

  /** 提交一次 judge 写入（1 秒窗口后落盘；同卡新提交覆盖旧 pending 并重置计时）。 */
  submit(aluId: AluId, payload: JudgeWritePayload): void {
    const existing = this.pending.get(aluId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pending.delete(aluId);
      void this.commit(aluId, payload);
    }, this.delayMs);
    this.pending.set(aluId, { aluId, payload, timer });
  }

  /** 撤销未落盘的提交（撤销期内不落盘不进日志）；无待撤销返回 null。 */
  revoke(aluId: AluId): JudgeWritePayload | null {
    const entry = this.pending.get(aluId);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.pending.delete(aluId);
    return entry.payload;
  }

  /** 该卡是否有未落盘提交（撤销窗口内）。 */
  isPending(aluId: AluId): boolean {
    return this.pending.has(aluId);
  }

  pendingCount(): number {
    return this.pending.size;
  }

  /** 回合边界：立即提交全部 pending（聚合为一次批量读写，§7.7 批量落盘）。 */
  async flush(): Promise<void> {
    const entries: PendingEntry[] = [];
    this.pending.forEach((entry) => entries.push(entry));
    if (entries.length === 0) return;
    const stateCol = createJsonCollection<Record<AluId, AluUserState>>(this.kv, COLLECTION_KEYS.alu_state);
    const logCol = createJsonCollection<AnswerRecord[]>(this.kv, COLLECTION_KEYS.review_log);
    const states = (await stateCol.load()) ?? {};
    const log = (await logCol.load()) ?? [];
    for (const entry of entries) {
      clearTimeout(entry.timer);
      this.pending.delete(entry.aluId);
      states[entry.aluId] = entry.payload.aluState;
      const record = entry.payload.record;
      if (record && record.grade !== 'fuzzy' && !record.revoked) log.push(record);
    }
    await stateCol.save(states);
    await logCol.save(log);
  }

  private async commit(aluId: AluId, payload: JudgeWritePayload): Promise<void> {
    // 1) alu_state：更新该卡用户状态
    const stateCol = createJsonCollection<Record<AluId, AluUserState>>(this.kv, COLLECTION_KEYS.alu_state);
    const states = (await stateCol.load()) ?? {};
    states[aluId] = payload.aluState;
    await stateCol.save(states);
    // 2) review_log：追加（仅 correct/wrong 且未撤销；fuzzy 不落盘，D8）
    const record = payload.record;
    if (record && record.grade !== 'fuzzy' && !record.revoked) {
      const logCol = createJsonCollection<AnswerRecord[]>(this.kv, COLLECTION_KEYS.review_log);
      const log = (await logCol.load()) ?? [];
      log.push(record);
      await logCol.save(log);
    }
  }
}
