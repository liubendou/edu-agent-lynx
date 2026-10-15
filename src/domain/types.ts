/**
 * 公共基础类型（CONTRACTS §0，逐字一致）。
 * M2-int 归位（T4）：SkillParams 迁往 src/skills/runtime.ts（CONTRACTS §6），
 * EscalationSignal/EscalationResult 迁往 src/cloud/escalation.ts（CONTRACTS §7）；
 * 本文件只保留契约 §0 的公共类型。
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
