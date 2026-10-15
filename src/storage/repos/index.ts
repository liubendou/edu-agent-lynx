/**
 * 仓库层（CONTRACTS §10 / ARCHITECTURE §12）：9 个集合仓库 + 回合边界批量落盘。
 * 分集合 JSON 持久化；review_log 仅含 correct/wrong（fuzzy 不落盘，D8）；
 * judge 写入经 1s 撤销窗口（JudgeCommitter）。
 */
import type { Alu, AluUserState, AnswerRecord } from '../../domain/alu';
import type { AluId } from '../../domain/types';
import type { LearnerProfile, SessionSummary } from '../../domain/profile';
import { MAX_SESSION_SUMMARIES as SUMMARY_CAP } from '../../domain/profile';
import type { KVStore } from '../kv';
import { createMemoryKVStore } from '../kv';
import type { AppSettings, BudgetState, Collections, GateReport, GrayscaleState } from './collections';
import { DEFAULT_APP_SETTINGS } from './collections';
import { COLLECTION_KEYS, createJsonCollection, reviveAluStateCollection } from './common';
import { JudgeCommitter } from './judge-commit';

export type { AppSettings, BudgetState, Collections, GateReport, GrayscaleState } from './collections';
export { DEFAULT_APP_SETTINGS } from './collections';
export { COLLECTION_KEYS, createJsonCollection } from './common';
export type { JsonCollection, CollectionKey } from './common';
export { JudgeCommitter } from './judge-commit';
export type { JudgeWritePayload, JudgeCommitOptions } from './judge-commit';

/** 灰度默认态：种子内容模式起步（§4.3）。 */
export const DEFAULT_GRAYSCALE: GrayscaleState = { consecutivePasses: 0, mode: 'seed' };

/** 仓库聚合：9 集合 + 回合边界批量落盘 + judge 延迟提交器。 */
export class Repositories {
  readonly kv: KVStore;
  /** judge 写入（1 秒撤销窗口；UID §三）。 */
  readonly judgeCommitter: JudgeCommitter;

  constructor(kv?: KVStore, judgeDelayMs?: number) {
    this.kv = kv ?? createMemoryKVStore();
    this.judgeCommitter = new JudgeCommitter(this.kv, judgeDelayMs !== undefined ? { delayMs: judgeDelayMs } : {});
  }

  // ── ① alu：主数据 ──
  async getAlu(aluId: AluId): Promise<Alu | null> {
    const all = await this.listAlus();
    return all[aluId] ?? null;
  }

  async putAlu(alu: Alu): Promise<void> {
    const col = createJsonCollection<Record<AluId, Alu>>(this.kv, COLLECTION_KEYS.alu);
    const all = (await col.load()) ?? {};
    all[alu.id] = alu;
    await col.save(all);
  }

  async listAlus(): Promise<Record<AluId, Alu>> {
    const col = createJsonCollection<Record<AluId, Alu>>(this.kv, COLLECTION_KEYS.alu);
    return (await col.load()) ?? {};
  }

  // ── ② alu_state：用户状态 ──
  async getAluState(aluId: AluId): Promise<AluUserState | null> {
    const all = await this.listAluStates();
    return all[aluId] ?? null;
  }

  async putAluState(state: AluUserState): Promise<void> {
    const col = createJsonCollection<Record<AluId, AluUserState>>(this.kv, COLLECTION_KEYS.alu_state);
    const all = (await col.load()) ?? {};
    all[state.aluId] = state;
    await col.save(all);
  }

  async listAluStates(): Promise<Record<AluId, AluUserState>> {
    const col = createJsonCollection<Record<AluId, AluUserState>>(this.kv, COLLECTION_KEYS.alu_state);
    const raw = await col.load();
    return raw === null ? {} : reviveAluStateCollection(raw); // JSON 往返后恢复 Card 的 Date 字段
  }

  // ── ③ review_log：追加式（仅 correct/wrong，fuzzy/revoked 不落盘，D8） ──
  async appendReviewLog(records: AnswerRecord[]): Promise<void> {
    const kept = records.filter((r) => r.grade !== 'fuzzy' && !r.revoked);
    if (kept.length === 0) return;
    const col = createJsonCollection<AnswerRecord[]>(this.kv, COLLECTION_KEYS.review_log);
    const log = (await col.load()) ?? [];
    await col.save([...log, ...kept]);
  }

  async listReviewLog(): Promise<AnswerRecord[]> {
    const col = createJsonCollection<AnswerRecord[]>(this.kv, COLLECTION_KEYS.review_log);
    return (await col.load()) ?? [];
  }

  // ── ④ profile ──
  async loadProfile(): Promise<LearnerProfile | null> {
    return createJsonCollection<LearnerProfile>(this.kv, COLLECTION_KEYS.profile).load();
  }

  async saveProfile(profile: LearnerProfile): Promise<void> {
    await createJsonCollection<LearnerProfile>(this.kv, COLLECTION_KEYS.profile).save(profile);
  }

  // ── ⑤ session_summaries：追加式（截尾保留最近 50，CONTRACTS §4） ──
  async appendSessionSummary(summary: SessionSummary): Promise<void> {
    const col = createJsonCollection<SessionSummary[]>(this.kv, COLLECTION_KEYS.session_summaries);
    const all = (await col.load()) ?? [];
    await col.save([...all, summary].slice(-SUMMARY_CAP));
  }

  async listSessionSummaries(): Promise<SessionSummary[]> {
    const col = createJsonCollection<SessionSummary[]>(this.kv, COLLECTION_KEYS.session_summaries);
    return (await col.load()) ?? [];
  }

  // ── ⑥ settings（带默认值） ──
  async loadSettings(): Promise<AppSettings> {
    return (await createJsonCollection<AppSettings>(this.kv, COLLECTION_KEYS.settings).load())
      ?? { ...DEFAULT_APP_SETTINGS };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await createJsonCollection<AppSettings>(this.kv, COLLECTION_KEYS.settings).save(settings);
  }

  // ── ⑦ gate_reports ──
  async putGateReport(report: GateReport): Promise<void> {
    const col = createJsonCollection<Record<string, GateReport>>(this.kv, COLLECTION_KEYS.gate_reports);
    const all = (await col.load()) ?? {};
    all[report.batchId] = report;
    await col.save(all);
  }

  async getGateReport(batchId: string): Promise<GateReport | null> {
    const all = (await createJsonCollection<Record<string, GateReport>>(this.kv, COLLECTION_KEYS.gate_reports).load()) ?? {};
    return all[batchId] ?? null;
  }

  // ── ⑧ grayscale（带默认值） ──
  async loadGrayscale(): Promise<GrayscaleState> {
    return (await createJsonCollection<GrayscaleState>(this.kv, COLLECTION_KEYS.grayscale).load())
      ?? { ...DEFAULT_GRAYSCALE };
  }

  async saveGrayscale(state: GrayscaleState): Promise<void> {
    await createJsonCollection<GrayscaleState>(this.kv, COLLECTION_KEYS.grayscale).save(state);
  }

  // ── ⑨ budget ──
  async loadBudget(): Promise<BudgetState | null> {
    return createJsonCollection<BudgetState>(this.kv, COLLECTION_KEYS.budget).load();
  }

  async saveBudget(state: BudgetState): Promise<void> {
    await createJsonCollection<BudgetState>(this.kv, COLLECTION_KEYS.budget).save(state);
  }

  // ── 回合边界批量落盘（§7.7）：先 flush judge 延迟提交，再整体写入给定集合 ──
  async saveAll(patch: Partial<Collections>): Promise<void> {
    await this.judgeCommitter.flush();
    if (patch.alu !== undefined) await createJsonCollection<Record<AluId, Alu>>(this.kv, COLLECTION_KEYS.alu).save(patch.alu);
    if (patch.alu_state !== undefined) await createJsonCollection<Record<AluId, AluUserState>>(this.kv, COLLECTION_KEYS.alu_state).save(patch.alu_state);
    if (patch.review_log !== undefined) await createJsonCollection<AnswerRecord[]>(this.kv, COLLECTION_KEYS.review_log).save(patch.review_log);
    if (patch.profile !== undefined) await createJsonCollection<LearnerProfile>(this.kv, COLLECTION_KEYS.profile).save(patch.profile);
    if (patch.session_summaries !== undefined) await createJsonCollection<SessionSummary[]>(this.kv, COLLECTION_KEYS.session_summaries).save(patch.session_summaries);
    if (patch.settings !== undefined) await createJsonCollection<AppSettings>(this.kv, COLLECTION_KEYS.settings).save(patch.settings);
    if (patch.gate_reports !== undefined) await createJsonCollection<Record<string, GateReport>>(this.kv, COLLECTION_KEYS.gate_reports).save(patch.gate_reports);
    if (patch.grayscale !== undefined) await createJsonCollection<GrayscaleState>(this.kv, COLLECTION_KEYS.grayscale).save(patch.grayscale);
    if (patch.budget !== undefined) await createJsonCollection<BudgetState>(this.kv, COLLECTION_KEYS.budget).save(patch.budget);
  }

  /** 全量读取（冷启动装配 TodayDecision 用；端侧本地计算，离线可跑）。 */
  async loadAll(): Promise<Partial<Collections>> {
    const [alu, alu_state, review_log, profile, session_summaries, settings, gate_reports, grayscale, budget] =
      await Promise.all([
        createJsonCollection<Record<AluId, Alu>>(this.kv, COLLECTION_KEYS.alu).load(),
        createJsonCollection<Record<AluId, AluUserState>>(this.kv, COLLECTION_KEYS.alu_state).load(),
        createJsonCollection<AnswerRecord[]>(this.kv, COLLECTION_KEYS.review_log).load(),
        createJsonCollection<LearnerProfile>(this.kv, COLLECTION_KEYS.profile).load(),
        createJsonCollection<SessionSummary[]>(this.kv, COLLECTION_KEYS.session_summaries).load(),
        createJsonCollection<AppSettings>(this.kv, COLLECTION_KEYS.settings).load(),
        createJsonCollection<Record<string, GateReport>>(this.kv, COLLECTION_KEYS.gate_reports).load(),
        createJsonCollection<GrayscaleState>(this.kv, COLLECTION_KEYS.grayscale).load(),
        createJsonCollection<BudgetState>(this.kv, COLLECTION_KEYS.budget).load(),
      ]);
    const result: Partial<Collections> = {};
    if (alu !== null) result.alu = alu;
    if (alu_state !== null) result.alu_state = reviveAluStateCollection(alu_state);
    if (review_log !== null) result.review_log = review_log;
    if (profile !== null) result.profile = profile;
    if (session_summaries !== null) result.session_summaries = session_summaries;
    if (settings !== null) result.settings = settings;
    if (gate_reports !== null) result.gate_reports = gate_reports;
    if (grayscale !== null) result.grayscale = grayscale;
    if (budget !== null) result.budget = budget;
    return result;
  }
}
