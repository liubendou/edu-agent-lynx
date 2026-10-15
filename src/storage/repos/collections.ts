/**
 * 持久化集合形状（CONTRACTS §7/§8/§10 中被 Collections 引用的类型，逐字一致）。
 * 暂置说明：BudgetState 最终归属 cloud/budget.ts、GateReport/GrayscaleState 归属 pipeline/*，
 * 对应模块建立时自此 import 或迁移（M2a 只建 storage 层）。
 */
import type { Alu, AluUserState, AnswerRecord } from '../../domain/alu';
import type { AluId } from '../../domain/types';
import type { LearnerProfile, SessionSummary } from '../../domain/profile';

/** 成本护栏（§7.6：token 日预算 + 升级配额 + 闲时调度）。最终归属 src/cloud/budget.ts。 */
export interface BudgetState {
  date: string; dailyTokenUsed: number; dailyTokenLimit: number;
  escalationsUsed: number; escalationLimit: number;
}

/** 验收闸指标结构（§4.3 三指标：硬门槛 + 抽样两类）。最终归属 src/pipeline/gate.ts。 */
export interface GateReport {
  batchId: string;
  traceability: { rate: number; isolatedAluIds: AluId[] }; // 可追溯率：程序化逐卡校验，100% 硬门槛；不达标隔离不入队
  judgeable: { rate: number; sampleSize: number; llmReview: boolean; manualRatio: number };   // ≥90%，抽样分层 100~200 张 + ≥20% 人工抽检
  granularity: { rate: number; sampleSize: number };                                          // ≥85%，同上
  verdict: 'pass' | 'fail' | 'pending_sample';
  createdAt: string;
}

/** 灰度判定（§4.3）：连续两批 pass → 扩大灰度；任一 fail → 退回种子内容模式。最终归属 src/pipeline/gate.ts。 */
export interface GrayscaleState { consecutivePasses: number; mode: 'seed' | 'auto_split' }

/** 仓库层集合（分集合 JSON 持久化；写入时机：回合边界批量落盘 §7.7；FSRS 写入经 1s 撤销窗口） */
export interface Collections {
  alu: Record<AluId, Alu>;                       // 主数据（种子+摄入）
  alu_state: Record<AluId, AluUserState>;
  review_log: AnswerRecord[];                    // 追加式；仅含 correct/wrong 判定（fuzzy 不落盘，D8）
  profile: LearnerProfile;
  session_summaries: SessionSummary[];
  settings: AppSettings;
  gate_reports: Record<string, GateReport>;
  grayscale: GrayscaleState;
  budget: BudgetState;
}

export interface AppSettings {
  privacyAdaptive: boolean;        // 分级开关①"学习数据用于自适应"（§5.5）
  privacyCloudInference: boolean;  // 分级开关②"数据用于云端推理"（§5.5）
  cloudSync: boolean;              // 端云同步开关，默认 false（§7.4）
  reduceMotion?: boolean;          // 系统"减少动态效果"（UID §7.4 降级档输入；静止档仍保留触觉，D1）
  skillUpdateManifestUrl?: string; // 技能包热更新端点（D3）：manifest 地址，可配置；开发期指向本地 fixture
  ttsModelDownloaded?: boolean;    // 语音模型按需下载状态（§7.3）
}

/** 默认设置：两分级开关默认开（端侧自适应/云侧推理为产品核心能力，数据不出端、不用于训练，§5.5）；云同步默认关（§7.4）。 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  privacyAdaptive: true,
  privacyCloudInference: true,
  cloudSync: false,
};
