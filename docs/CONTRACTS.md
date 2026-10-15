# CONTRACTS.md —— 数据与接口契约（M1，全工程唯一接口依据）

> 事实源：PRD v1.3、UID v3、总控方案。类型均以 TypeScript 定义，供 M2~M7 直接使用。
> 放置约定：全部类型收敛到 `edu-agent/src/` 对应域文件（各节头部标注）；外部依赖导入路径已注明。
> 改本文件须走变更记录（总控 §4）。`§x.y` 指 PRD，`UID §x` 指 UID。

## 0. 公共基础（src/domain/types.ts）

```ts
/** 逻辑档位。PRD §3：Quick 一批两用（快速学习/快速回顾）；score-boost 非档位、不进此联合 */
export type SkillName =
  | 'quick-learning'      // 档1 快速学习/快速回顾（§3 档1）
  | 'review'              // 档2 复习（复利引擎）
  | 'standard-learning'   // 档3 标准
  | 'deep-learning';      // 档4 高质量

/** 知识库型技能（总控 §0：score-boost 兼任自适应/方法论知识库） */
export type KnowledgeSkillName = 'score-boost';

/** 判定三档。UID §5.4 / PRD §3 档2：反馈只给三档，不留"差不多对" */
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
```

## 1. ALU 实体（src/domain/alu.ts，PRD §4.2 + 附录样例）

```ts
import type { Card, State } from 'ts-fsrs'; // fsrs 卡片：due/stability/difficulty/elapsed_days/scheduled_days/reps/lapses/state/last_review

/** 出处：文件 + 句子级 span。PRD §4.2 出处字段 / §4.3 可追溯率 100% 硬门槛 */
export interface SourceRef {
  docId: string;          // 出处文件/资料/视频/搜索结果 id（资料库内唯一）
  docTitle: string;       // 如 "档1·Lakens《Improving Your Statistical Inferences》"（附录样例 source 字段）
  locator: TextSpan | UrlLocator;  // 句子级 span 或外部链接
  text: string;           // 被切分命中的原句原文（校验与回链展示用）
}
export interface TextSpan { kind: 'span'; start: number; end: number; sentenceIndex?: number } // 字符区间（含）
export interface UrlLocator { kind: 'url'; url: string }

/** ALU 主数据（内容层，跨用户不变；种子/切分/搜索/识图摄入同构） */
export interface Alu {
  id: AluId;
  subjectId: SubjectId;          // 学科空间（§4.2：Subject ──< Module ──< ALU）
  moduleId: ModuleId;            // 所属板块
  kind: AluKind;                 // 概念/判据/过程/资源（§4.1 三元组 + 资源型）
  front: string;                 // 正题（正面问什么；判据式提问，SKILL review 方法5）
  back: string;                  // 背面（判据/答案）
  variants: string[];            // 反面/变式（换问法）；资源型可为空（附录 res-001）
  prereq: AluId[];               // 依赖：前置 ALU，可成图（§4.6② 前置归因沿此向上游追溯）
  difficulty: number;            // 难度 1~5（附录样例 0~3，统一为整数刻度，0=资源型占位）
  source: SourceRef;             // 出处（创建时即写入，回链不自研）
  isPriority?: boolean;          // 高质量档升级为"重点"：入队优先级更高、间隔更保守（§4.5）
}

/** ALU 用户状态（每条独立；§4.2） */
export interface AluUserState {
  aluId: AluId;
  status: AluStatus;             // 未见→见过→学过一轮→暂记→已稳固
  fromMode: FromMode | null;     // 来源模式（§4.2）
  fsrs: Card;                    // ts-fsrs 卡片（D/S/R 参数、due、reps、lapses；§4.6①）
  lastAnswers: AnswerRecord[];   // 最近作答记录（截尾保留最近 10 条）
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** 产品状态与 FSRS State 的映射由 domain/fsrs.ts 实现：
 *  未见/见过=New（见过不入队，硬规则1）；学过一轮=入队 Learning→Review，due=T+1；
 *  暂记=Review 且近期有 lapse；已稳固=Review 且 scheduled_days≥21（建议值，待裁决 D5） */
export type AluStatus = 'unseen' | 'seen' | 'learned_once' | 'retaining' | 'consolidated';

/** 作答记录（学习事实层原子级，§5.1 A） */
export interface AnswerRecord {
  aluId: AluId;
  grade: Grade;                  // 对/错/模糊 三档
  latencyMs: number;             // 用时（§4.2：对/错/模糊 + 用时）
  skill: SkillName;              // 在哪个档答的
  at: ISODate;
  revoked?: boolean;             // 1s 撤销窗口内撤销（UID §三），撤销不计入 FSRS
  struggleWin?: boolean;         // "挣扎后想起来"：fuzzy→correct 的高价值正反馈（§10.2）
}

/** 板块与学科空间（§4.2） */
export interface Module { id: ModuleId; subjectId: SubjectId; name: string; aluOrder: AluId[] }
export interface Subject { id: SubjectId; name: string; moduleIds: ModuleId[] }
```

## 2. FSRS 封装与复习队列（src/domain/fsrs.ts / queue.ts，PRD §4.6）

```ts
import { fsrs, generatorParameters, createEmptyCard, Rating, State, type FSRS, type Grade as FsrsGrade, type RecordLogItem } from 'ts-fsrs';

/** 三档 → FSRS Rating 映射（唯一映射表，全工程只用这一处）：
 *  correct→Good(3)  fuzzy→Hard(2)  wrong→Again(1)。Easy(4) 不暴露给用户。 */
export function gradeToRating(g: Grade): Rating;

/** 调度器实例：目标保持率 0.9（§4.6①"按目标保持率反解下次到期日"） */
export function createScheduler(requestRetention = 0.9): FSRS; // fsrs(generatorParameters({ request_retention }))

/** 冷启动：新卡 createEmptyCard + 默认 w；初次入队 due=T+1（§4.5/§4.6①）。
 *  艾宾浩斯 1-2-4-7-15 为骨架参照（V1 用默认参数演进；个人参数优化见待裁决 D6）。 */
export function newCardForQueue(now: Date): Card;

/** 复习队列条目 */
export interface QueueItem {
  aluId: AluId;
  due: ISODate;
  retrievability: number;   // R 值（0~1），首页欠账排序用（§4.6③）
  moduleId: ModuleId;       // 交错抽取按板块去同（§4.6②）
  isPriority: boolean;      // 重点卡优先（§4.5 高质量档）
}

/** 一轮抽取：跨板块抽 5~8 张、按当日预算截断（§4.6② 节奏编织）。
 *  算法：R 升序为底序 → 同板块至多 2 张 → 截断到 budget → 一次只还 3~6 张（§2 欠账牵引）。 */
export function pickReviewBatch(items: QueueItem[], budget: number): QueueItem[];

/** 当日预算（§4.6②）。V1 固定默认值，画像节奏画像可调（§5.1 B） */
export interface DailyBudget { newCards: number; reviewCards: number }
```

## 3. 今日决策（src/domain/decision.ts，PRD §5.6/§6）

```ts
/** 今日决策：首页"今天该学的一件事"。§5.6 驱动点表 + §6 回访第一屏三行。
 *  优先级：当日补讲 > 到期复习（R 最低优先）> 新学建议。端侧本地计算、离线即时渲染。 */
export type TodayDecision =
  | { kind: 'first_run' }                                          // 首启：方案 D 元课程小课（§6）
  | { kind: 'review'; batch: QueueItem[]; remediationCount: number } // 复习欠账优先
  | { kind: 'remediation'; aluIds: AluId[] }                       // 补讲（复习答错待补）
  | { kind: 'new_learn'; suggestion: { aluId?: AluId; moduleId?: ModuleId }; reason: string }; // 新学建议（含个性化理由，§2 牵引3）

/** 回访第一屏 TodayPlanPanel 数据（UID §2.2：三行、端侧算、零等待） */
export interface TodayPlan {
  dueCount: number;          // "复习 N 张到期卡"
  remediationCount: number;  // "补讲 X"
  suggestion: TodayDecision; // "今天建议学的一条"
  generatedAt: ISODate;      // 端侧生成时间（不进云侧前缀，§7.6）
}
```

## 4. 画像四层与触发（src/domain/profile.ts，PRD §5）

```ts
/** A. 学习事实层（原子级，§5.1） */
export interface LearningFacts {
  answerEvents: AnswerRecord[];            // 逐条原子级（§5.4）
  gradeEvents: GradeEvent[];               // 成绩事件（入口形态见待裁决 D4）
  goals: Goal[];                           // 目标+期限+预估投入
}
/** 成绩事件（§5.1 A：科目、时间、总分、分项、错因四分类） */
export interface GradeEvent {
  id: string; subject: string; at: ISODate;
  total: number; sections: { name: string; score: number; full: number }[];
  errorCauses: ErrorCauseDistribution;     // 错因四分类
}
export type ErrorCause = 'unknown' | 'misapplied' | 'misread' | 'calculation'; // 不会/会用错/审题/计算
export type ErrorCauseDistribution = Record<ErrorCause, number>;
export interface Goal { text: string; deadline?: ISODate; estimatedHours?: number; createdAt: ISODate }

/** B. 能力画像层（派生，§5.1） */
export interface AbilityProfile {
  moduleMastery: Record<ModuleId, { avgStability: number; avgDifficulty: number; consolidatedRatio: number }>; // 板块 ALU 的 S/D 聚合
  errorCauseDistribution: ErrorCauseDistribution;   // 错因分布 → 定向补漏专项（§5.6）
  rhythm: { preferredDurationMin: number; activeHours: number[]; acceptableDifficulty: number }; // 学习节奏画像
}

/** C. 偏好与边界层（§5.1：硬约束，写入所有 Skill 输出约束） */
export interface Preferences {
  boundaries: PreferenceBoundary[];  // "介意/不喜欢"，硬约束
  traits: StableTraits;              // 零散但稳定
  tts: { rate: number; voice: string }; // 语速/音色偏好（§7.3 接画像）
}
export interface PreferenceBoundary {
  id: string; text: string;          // 如 "别用太多类比"/"不喜欢被问'听懂了吗'"
  source: 'declared' | 'observed';   // 明确声明 或 出现≥2次（§5.3 防噪音）
  observedCount: number; createdAt: ISODate;
}
export interface StableTraits { locale: string; grade?: string; profession?: string; isExamPrep?: boolean; notes: string[] }

/** D. 会话摘要层（§5.1/§5.3） */
export interface SessionSummary {
  sessionId: string; skill: SkillName; at: ISODate;
  whatHappened: string;             // 做了什么
  stuckAt: AluId[];                 // 卡在哪
  nextSuggestion: string;           // 下次建议
  mindState?: MindState;            // 一句心理状态推断（短期带 TTL）
}
export interface MindState { text: string; expiresAt: ISODate } // TTL 过期即弃（§5.4/§5.5）

/** 画像根（storage/repos/profile 持久化单元） */
export interface LearnerProfile {
  facts: LearningFacts;
  ability: AbilityProfile;
  preferences: Preferences;
  sessionSummaries: SessionSummary[]; // 截尾保留最近 N=50
  version: number;
}

/** 触发规则（§5.2 三类）——领域事件定义 */
export type ProfileTrigger =
  | { type: 'event'; event: AnswerRecord | GradeEvent | 'mode_switch' | 'skip' | 'long_stay' | 'abandon' | 'boundary_declared' } // 即时、轻量、本地
  | { type: 'periodic'; reason: 'session_10min' | 'interactions_8' }   // 会话内刷新能力画像层
  | { type: 'session_end'; trigger: SessionEndTrigger };                // 会话尾主动分析

export type SessionEndTrigger = 'idle_90s' | 'enter_background' | 'skip_twice' | 'goodbye'; // §5.2

/** 会话结束分析三产出（§5.3） */
export interface SessionEndAnalysis {
  mindState: MindState;                        // ① 心理状态推断（短期带 TTL）
  preferenceUpdates: PreferenceUpdate[];       // ② 仅"明确声明或≥2次"落库（防噪音）
  nextAdjustment: string;                      // ③ 对下次交互的一条具体调整建议
}
export type PreferenceUpdate = { op: 'add' | 'revise'; boundary: PreferenceBoundary };
```

## 5. A2UI 消息协议与组件 catalog（src/a2ui/catalog.ts，PRD §7.1/§7.2/§7.5；UID §四）

采用 A2UI v0.9 协议（Google 发起；Lynx 官方渲染实现 `@lynx-js/genui/a2ui`）。消息为 JSONL，每行一个完整 JSON 对象：

```ts
/** A2UI v0.9 顶层消息（流式块：一行一条，Agent 边推理边发） */
export interface A2UIMessage {
  surfaceUpdate: {
    surfaceId: 'main';                    // V1 单 surface
    components: A2UIComponentNode[];      // 组件树（按 catalog 声明字段）
  };
}

/** 组件节点：name 必须命中 catalog（UID §四规则1：Skill 只能填声明的字段） */
export interface A2UIComponentNode {
  id: string;                 // 组件实例 id（Action 回传引用）
  name: ComponentName;        // 16 零件之一；catalog 外名称 → fallback.tsx 降级纯文本块（UID §四规则2）
  props: ComponentPropsMap[ComponentName];
  children?: A2UIComponentNode[];
}

/** 用户操作回传（A2UI Action，两类；UID/PRD §7.1） */
export type A2UIAction =
  | { kind: 'agent'; nodeId: string; action: string; payload: unknown }  // 影响下一轮生成 → 进 SessionLoop observation
  | { kind: 'client'; nodeId: string; action: string; payload: unknown }; // 本地直处理：TTS 播放/暂停、跳出处、埋点
```

**组件 catalog：16 零件清单及声明字段**（UID §四表格；产品级全局常量、全量常驻、进云侧上下文③段）：

```ts
export type ComponentName =
  | 'ConceptCard' | 'QuestionCard' | 'RevealCard' | 'MapView' | 'ProgressRing'
  | 'ExplainStep' | 'ChoiceGrid' | 'MicButton' | 'TTSBar' | 'FeedbackBar'
  | 'SourceLink' | 'DueChip' | 'TodayPlanPanel' | 'EntryCard' | 'StreamSkeleton'
  | 'SessionEndCard';

export interface ComponentPropsMap {
  /** 快速/标准：一个定义加出处，能展开（UID §四） */
  ConceptCard: { title: string; definition: string; sourceRef?: SourceRef; expandable?: boolean };
  /** 复习/标准/高质量：正题或变式，等他答（答题类型：自由/选择） */
  QuestionCard: { question: string; variantOfAlu?: AluId; answerType: 'free' | 'choice'; options?: string[] };
  /** 复习/快速：上滑揭晓，答案在背面（UID §5.2"揭晓"） */
  RevealCard: { front: string; back: string };
  /** 快速/高质量/地图页：概念关系图，能拖能点（关系=并列/包含/因果/前置，quick 方法1） */
  MapView: { nodes: { id: string; label: string; definition: string }[]; edges: { from: string; to: string; relation: 'parallel' | 'contains' | 'causal' | 'prereq' }[] };
  /** 高质量/成长：掌握度；S 上涨时长一格（§10.2 信号1 落点） */
  ProgressRing: { progress: number; label: string; grewBy?: number };
  /** 标准/高质量：步骤序列，一步步走（四段式：概念→例子→反例→常见坑） */
  ExplainStep: { steps: { title: string; body: string }[]; current: number };
  /** 复习/标准：选项，可单选可多选 */
  ChoiceGrid: { options: string[]; multi?: boolean };
  /** 档4 费曼复述：长按说话（350ms 判定，UID §5.2；首页入口 V1 是文字版不是本组件） */
  MicButton: { hint: string };
  /** 快速/标准/高质量：播/停/倍速/重播（§7.3 TTS 覆盖四档） */
  TTSBar: { playing: boolean; rate: number; durationMs: number };
  /** 复习/标准：对/模糊/错三档；按下反馈先行、判定异步补上（UID §5.4） */
  FeedbackBar: { grades: Grade[]; pendingJudge: boolean };
  /** 全站：点回出处原句（句子级 span；§4.3 硬门槛落点） */
  SourceLink: { aluId: AluId; sourceRef: SourceRef; label: string };
  /** 首页："还有几张"，点开就还 */
  DueChip: { count: number };
  /** 回访第一屏：三行端侧算（到期 N / 补讲 X / 建议一条） */
  TodayPlanPanel: { dueCount: number; remediationCount: number; suggestionText: string };
  /** 首页/资料库：资源型条目入口卡，打开即看，不进复习队列（§4.3 两层分流） */
  EntryCard: { title: string; url: string; sourceRef: SourceRef };
  /** 首屏：骨架，必须定高（UID §2.1） */
  StreamSkeleton: { heightPx: number };
  /** 会话尾：收尾"下一个"；给正向峰值不给欠账（§10.2 峰值-终点律） */
  SessionEndCard: { highlight: string; next: string | null };
}

/** catalog 声明项（注册表条手；JSON Schema 形态同步给云侧③段） */
export interface CatalogEntry {
  name: ComponentName;
  description: string;      // 何时上场（UID §四表格一句话）
  propsSchema: Record<string, unknown>;  // JSON Schema（由 props 接口生成）
  clientOnly?: boolean;     // TodayPlanPanel/DueChip/EntryCard/StreamSkeleton 主要由端侧直渲染
}
```

## 6. 技能包清单格式（src/skills/runtime.ts，PRD §7.2）

```ts
/** 技能包 manifest。源：/skill/*/SKILL.md（只读），构建期装载为 TS 资产。
 *  catalog 不内嵌：components 仅按名引用（§7.2，避免打散缓存前缀）。 */
export interface SkillManifest {
  name: SkillName | KnowledgeSkillName;
  description: string;         // 何时用（SKILL.md frontmatter 原文；§7.8① description 写"何时用"）
  version: string;             // 热更新预留（V1 内置，见待裁决 D3）
  mode: 'pattern' | 'knowledge';   // 四模式档 vs 知识库（score-boost）
  promptTemplate: string;      // SKILL.md 正文 → 云侧上下文第④段（换档失效边界）
  tools: ToolName[];           // 所需工具声明（§7.2）
  components: ComponentName[]; // 对本档所用组件的按名引用列表（§7.2）
  params?: SkillParams;        // 深度参数 + 时长预算（quick 一批两用切换，§3 档1）
  references?: string[];       // references/ 资源清单装载路径（搜索起始白名单，§4.4）
}

/** quick 两用切换参数（§3 档1：预算=长/目标=建立地图 vs 预算=90s/目标=唤醒） */
export interface SkillParams {
  budgetMinutes?: [number, number];   // 时长预算区间
  goal?: 'map' | 'recall' | 'understand' | 'master';
  cardGeneration: boolean;            // 是否允许生成复习卡（硬规则1：quick=false）
}

/** 运行时装载协议（§7.8①：name+description 常驻窗口、正文按需加载） */
export interface SkillRuntime {
  listSummaries(): SkillSummary[];                 // 常驻：{name, description}
  loadBody(name: SkillName | KnowledgeSkillName): SkillManifest;  // 按需
}
export interface SkillSummary { name: string; description: string }

/** 工具名（§7.3 注册表；offline 标注） */
export type ToolName = 'web_search' | 'vision_capture' | 'tts_speak' | 'asr_transcribe';
```

## 7. 云侧请求/响应与卡死升级（src/cloud/*，PRD §7.6/§7.7）

```ts
/** 八段分层请求（§7.7① 固定顺序，端侧拼装器代码硬约束）。
 *  ①②③ 序列化后字节级稳定（吃 DeepSeek 硬盘缓存）；换档仅从④起失效。 */
export interface CloudRequest {
  segments: {
    system: string;                    // ① System 约束（跨所有请求不变）
    psychologyLibrary: string;         // ② 心理学策略库（随产品版本变；含 score-boost 方法论要点）
    catalog: string;                   // ③ A2UI catalog 全量 JSON Schema（产品级常量）
    skillTemplate: string;             // ④ 当前档 Skill 模板
    profileFragment: string;           // ⑤ 端侧画像最小片段（绝不进前缀；回合边界更新）
    taskInstruction: TaskInstruction;  // ⑥ 每轮变
    history: ChatTurn[];               // ⑦ 对话历史（只追加）
    retrieved: RetrievedChunk[];       // ⑧ 按需检索（用到才来）
  };
}

export interface TaskInstruction {          // ⑥ 段结构化内容（序列化注入）
  aluIds: AluId[];                         // 今天学哪些 ALU
  mode: SkillName | 'remediation';         // 档位（remediation=复习拉起的 90 秒补讲，§4.5）
  params: SkillParams;                     // 深度/时长预算
  budget: DailyBudget;                     // 当日预算
  boundaries: string[];                    // 偏好边界硬约束（压缩保命清单②）
}

export interface ChatTurn { role: 'user' | 'assistant' | 'tool'; content: string; at?: ISODate } // ⑦ 只追加
export interface RetrievedChunk {          // ⑧ 可寻址引用（§7.7③：不放整段原文）
  kind: 'alu_ref' | 'source_ref' | 'search_digest' | 'vision_digest';
  aluId?: AluId; sourceRef?: SourceRef; digest: string; // 截断/摘要后入窗
}

/** 卡死升级信号（§7.6：五类触发） */
export type EscalationSignal =
  | { type: 'retry_no_converge'; turns: number }     // 同义重试连续不收敛
  | { type: 'tool_failures'; consecutive: number }   // 工具连续失败
  | { type: 'output_deviation'; detail: string }     // 输出反复偏离目标
  | { type: 'user_correction'; detail: string }      // 用户明显不满或纠错
  | { type: 'low_confidence'; selfReport: string };  // 模型自评低置信

/** 升级请求（单次；上下文最小化：只带"卡在哪+目标"） */
export interface EscalationRequest {
  stuckAt: string; goal: string; skill: SkillName;
}
export interface EscalationResult {
  nextStep: string;          // 拿到"下一步怎么做"，随即切回 flash 执行
  loggedToFacts: boolean;    // 记入学习事实层（"这个点在 Flash 上卡过"）
}

/** 云侧响应：A2UI JSONL 流 + 元信息 */
export interface CloudStreamResult {
  a2uiLines: string[];            // A2UI v0.9 JSONL（后台线程逐行解析渐进渲染）
  usage: { promptTokens: number; completionTokens: number; cacheHit: boolean };
  modelUsed: string;              // flash | pro（升级时）
}

/** 成本护栏（§7.6：token 日预算 + 升级配额 + 闲时调度） */
export interface BudgetState {
  date: ISODate; dailyTokenUsed: number; dailyTokenLimit: number;
  escalationsUsed: number; escalationLimit: number;
}
```

## 8. 内容管线产物（src/pipeline/*，PRD §4.3/§9）

```ts
/** 切分器输出（sub-agent 独立窗口：读资料 → 只回传 ALU 列表 JSON，§7.7⑤） */
export interface SplitterOutput {
  batchId: string;
  knowledgeAlus: Alu[];        // 知识型 → 可测 ALU（进验收闸→复习队列）
  resourceEntries: Alu[];      // 资源型 → 入口卡（kind='resource'，不进队列）
  sourceDoc: { docId: string; docTitle: string; sentenceTexts: string[] }; // 原文句表（回链校验依据）
}

/** 验收闸指标结构（§4.3 三指标：硬门槛 + 抽样两类） */
export interface GateReport {
  batchId: string;
  traceability: { rate: number; isolatedAluIds: AluId[] }; // 可追溯率：程序化逐卡校验，100% 硬门槛；不达标隔离不入队
  judgeable: { rate: number; sampleSize: number; llmReview: boolean; manualRatio: number };   // ≥90%，抽样分层 100~200 张 + ≥20% 人工抽检
  granularity: { rate: number; sampleSize: number };                                          // ≥85%，同上
  verdict: 'pass' | 'fail' | 'pending_sample';
  createdAt: ISODate;
}
/** 灰度判定（§4.3）：连续两批 pass → 扩大灰度；任一 fail → 退回种子内容模式 */
export interface GrayscaleState { consecutivePasses: number; mode: 'seed' | 'auto_split' }

/** 种子内容包格式（§0.1 三层：①首启元课程 ②心理学研究方法；M5 内置） */
export interface SeedContentPack {
  packId: string; version: string;
  layer: 'meta_course' | 'real_subject';   // ①学习科学=首启元课程 ②首个真实学科
  subjects: Subject[]; modules: Module[]; alus: Alu[];
  reviewWhitelist: string[];               // 外部链接 = 出处字段 + 搜索起始白名单（§4.4）
}
```

## 9. 四档会话事件流（src/domain/events.ts，PRD §3/§4.5/§5.2/§10）

```ts
/** 会话生命周期事件（orchestrator 发、domain/storage 消费；埋点同源，§7.8④） */
export type SessionEvent =
  | { type: 'session_start'; sessionId: string; skill: SkillName; aluIds: AluId[]; params: SkillParams; at: ISODate }
  | { type: 'answer'; record: AnswerRecord }                                    // 作答（1s 撤销窗口内可补 revoked）
  | { type: 'judge'; aluId: AluId; grade: Grade; fsrsApplied: boolean; at: ISODate } // 判定三档 + FSRS 是否已写
  | { type: 'difficulty_adjust'; aluId: AluId; direction: 'up' | 'down'; reason: string } // 实时调节（§10.1③：卡住先降难度给脚手架）
  | { type: 'remediation_start'; aluId: AluId; fromSkill: 'review' }            // 补讲拉起（硬规则3：复习失败→标准档90秒）
  | { type: 'remediation_done'; aluId: AluId; requeued: boolean }               // 补完重新入队（间隔按答错处理）
  | { type: 'card_generated'; aluIds: AluId[]; sourceChunkId: string; skill: 'standard-learning' | 'deep-learning' } // 唯一入口硬约束（硬规则2）
  | { type: 'alu_status'; aluId: AluId; from: AluStatus; to: AluStatus }        // 四档流转状态机跃迁（§4.5）
  | { type: 'skill_escalation'; signal: EscalationSignal; result: EscalationResult } // 卡死升级留痕
  | { type: 'session_end'; sessionId: string; trigger: SessionEndTrigger; analysis: SessionEndAnalysis; at: ISODate };

/** 四档心流参数（§10.3 表；会话容器按档取用） */
export interface FlowParams {
  skill: SkillName;
  judgeLatencyTarget: '<1s' | '1-3s' | 'seconds';   // 判定反馈时延目标（按下反馈先行，判定异步补）
  targetSuccessRate: number;                         // 交互层：快速0.90/复习0.85/标准0.80/深度0.75（与 FSRS 0.9 保持率是两套指标）
  sessionMinutes: [number, number];                  // 单次时长区间
  boundedSession: { closingLine: string };           // 有界会话："再3张清完今天"，不做开放结尾（§10.1①）
}
```

## 10. 存储仓库契约（src/storage/kv.ts + repos/，PRD §7.4/§7.7；UID §三）

```ts
/** KV 桥：Native StorageModule（Android SharedPreferences/内部文件）的 JS 封装。
 *  候选实现见 ARCHITECTURE §12；接口固定，底层可换。 */
export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** 仓库层集合（分集合 JSON 持久化；写入时机：回合边界批量落盘 §7.7；FSRS 写入经 1s 撤销窗口） */
export interface Collections {
  alu: Record<AluId, Alu>;                       // 主数据（种子+摄入）
  alu_state: Record<AluId, AluUserState>;
  review_log: AnswerRecord[];                    // 追加式
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
  reduceMotion?: boolean;          // 系统"减少动态效果"（UID §7.4 降级档输入）
  ttsModelDownloaded?: boolean;    // 语音模型按需下载状态（§7.3）
}
```

## 11. 变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-10-15 | 初版（M1 产出） | PRD v1.3 / UID v3 / 总控方案 |
