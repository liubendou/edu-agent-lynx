/**
 * 公共基础类型（CONTRACTS §0，逐字一致）。
 * 另暂置三个被 domain/events.ts 引用、但契约归属其他模块的类型
 * （SkillParams → skills/runtime.ts；EscalationSignal/EscalationResult → cloud/*），
 * 待对应模块（M2 后续里程碑）建立时迁移或自此 re-export。
 */

/** 逻辑档位。PRD §3：Quick 一批两用（快速学习/快速回顾）；score-boost 非档位、不进此联合 */
export type SkillName =
  | 'quick-learning'      // 档1 快速学习/快速回顾（§3 档1）
  | 'review'              // 档2 复习（复利引擎）
  | 'standard-learning'   // 档3 标准
  | 'deep-learning';      // 档4 高质量

/** 知识库型技能（总控 §0：score-boost 兼任自适应/方法论知识库） */
export type KnowledgeSkillName = 'score-boost';

/** 判定三档。UID §5.4 / PRD §3 档2：反馈只给三档，不留"差不多对"。fuzzy 不记账（D8，映射见 §2） */
export type Grade = 'correct' | 'fuzzy' | 'wrong';

/** ISO-8601 字符串统一用 string 存储与传输 */
export type ISODate = string;

/** 来源模式。PRD §4.2 用户状态 from_mode */
export type FromMode = 'quick' | 'standard' | 'deep';

/** 三元组原语 + 资源。PRD §4.1/§4.2：概念/判据/过程/资源 */
export type AluKind = 'concept' | 'criterion' | 'procedure' | 'resource';

/** 标识符：种子内容带命名空间（如 "psy-001"/"meta-001"，PRD 附录样例） */
export type AluId = string;
export type ModuleId = string;
export type SubjectId = string;

/** ── 暂置类型（契约出处标注于各注释；最终归属见文件头注） ── */

/** 技能包参数（CONTRACTS §6；最终归属 src/skills/runtime.ts）。
 *  quick 两用切换参数（§3 档1：预算=长/目标=建立地图 vs 预算=90s/目标=唤醒）。 */
export interface SkillParams {
  budgetMinutes?: [number, number];   // 时长预算区间
  goal?: 'map' | 'recall';            // 收敛为 PRD §3 档1 两态（原 understand/master 为越界扩展，已删，F12）
  cardGeneration: boolean;            // 是否允许生成复习卡（硬规则1：quick=false）
}

/** 卡死升级信号（CONTRACTS §7；最终归属 src/cloud/*）。（§7.6：五类触发） */
export type EscalationSignal =
  | { type: 'retry_no_converge'; turns: number }     // 同义重试连续不收敛
  | { type: 'tool_failures'; consecutive: number }   // 工具连续失败
  | { type: 'output_deviation'; detail: string }     // 输出反复偏离目标
  | { type: 'user_correction'; detail: string }      // 用户明显不满或纠错
  | { type: 'low_confidence'; selfReport: string };  // 模型自评低置信

/** 升级结果（CONTRACTS §7；最终归属 src/cloud/*） */
export interface EscalationResult {
  nextStep: string;          // 拿到"下一步怎么做"，随即切回 flash 执行
  loggedToFacts: boolean;    // 记入学习事实层（"这个点在 Flash 上卡过"）
}
