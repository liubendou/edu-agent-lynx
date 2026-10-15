/**
 * Orchestrator 依赖倒置 ports（ARCHITECTURE §3/§4；类型遵 CONTRACTS §6/§7）。
 * cloud/ 与 skills/ 正被并行开发：orchestrator 只依赖本文件的结构性接口，
 * 不 import 任何实现；M2-int 把真实实现做零成本结构适配接入。
 *
 * 端口归属说明：
 *  - SkillRuntimePort ← skills/runtime.ts + registry.ts（CONTRACTS §6 装载协议）
 *  - CloudClientPort   ← cloud/client.ts + escalation.ts（CONTRACTS §7）
 *  - A2UiEmitterPort   ← a2ui/stream-parser 的渐进写入入口（M3）
 *  - ToolInvokerPort   ← tools/registry.ts（§7.3；ToolName 联合见 CONTRACTS §6）
 *  - StoragePort       ← storage/repos 薄封装（CONTRACTS §10；回合边界批量落盘 §7.7）
 */
import type { Alu, AluUserState, AnswerRecord } from '../domain/alu';
import type { SessionEvent } from '../domain/events';
import type { LearnerProfile, SessionSummary } from '../domain/profile';
import type { DailyBudget } from '../domain/queue';
import type { AluId, ISODate, KnowledgeSkillName, SkillName } from '../domain/types';
import type { EscalationResult, EscalationSignal } from '../cloud/escalation';
import type { SkillParams } from '../skills/runtime';

// ── SkillRuntimePort（CONTRACTS §6；components 用 string 按名引用，M3 catalog 收窄）──

/** 技能包 manifest 的端口形态（CONTRACTS §6 SkillManifest 的结构性子集）。 */
export interface SkillManifestPort {
  name: SkillName | KnowledgeSkillName;
  /** 何时用（SKILL.md frontmatter 原文；点名路由的匹配语料） */
  description: string;
  version: string;
  mode: 'pattern' | 'knowledge';
  /** SKILL.md 正文 → 云侧上下文第④段（换档失效边界） */
  promptTemplate: string;
  /** 对 catalog 零件的按名引用（CONTRACTS §5 ComponentName；M3 前以 string 承接） */
  components: string[];
  /** 硬规则1：quick 恒 cardGeneration=false */
  params: SkillParams;
  /** 所需工具声明（§7.2） */
  tools: string[];
}

export interface SkillSummaryPort {
  name: string;
  description: string;
}

/**
 * 技能运行时端口（§7.8①：name+description 常驻窗口、正文按需加载）。
 * 'remediation' 不是档位：复习失败拉起的 90 秒补讲（standard 档技能包），由实现侧映射。
 */
export interface SkillRuntimePort {
  /** 决策已定档 → 取该档激活技能（确定性，不经模型） */
  getActiveSkill(mode: SkillName | 'remediation'): SkillManifestPort;
  /** 按名取正文（④段注入用） */
  getBody(name: SkillName | KnowledgeSkillName): SkillManifestPort;
  /** 常驻摘要（点名路由的元数据；只读，不调模型） */
  listSummaries(): SkillSummaryPort[];
}

// ── CloudClientPort（CONTRACTS §7）──

/** ⑥ 任务指令（CONTRACTS §7 TaskInstruction，逐字一致）。 */
export interface TaskInstruction {
  aluIds: AluId[];                         // 今天学哪些 ALU
  mode: SkillName | 'remediation';         // 档位（remediation=复习 wrong 拉起的 90 秒补讲，F7）
  params: SkillParams;                     // 深度/时长预算
  budget: DailyBudget;                     // 当日预算
  boundaries: string[];                    // 偏好边界硬约束（压缩保命清单②）
}

/** ⑦ 对话历史（只追加，不改写）。 */
export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  at?: ISODate;
}

/** ⑧ 按需检索（可寻址引用，§7.7③：不放整段原文）。 */
export interface RetrievedChunk {
  kind: 'alu_ref' | 'source_ref' | 'search_digest' | 'vision_digest';
  aluId?: AluId;
  digest: string; // 截断/摘要后入窗
}

/**
 * 回合请求：CloudRequest.segments 中由 orchestrator 拥有的 ④~⑧ 段
 * （CONTRACTS §7 结构同名同型）+ 回合级指令注入位。
 * ①②③段（System/心理学库/catalog）为字节级稳定前缀，归 cloud/context-builder
 * 持有（ARCHITECTURE §5）；M2-int 适配器把本请求并段成完整 CloudRequest。
 * directives 是 validator 纠偏、difficulty 调节、有界会话话术的注入通道。
 */
export interface CloudTurnRequest {
  mode: SkillName | 'remediation';
  skillTemplate: string;      // ④ 当前档 Skill 模板
  profileFragment: string;    // ⑤ 端侧画像最小片段（绝不进前缀；绝不发完整画像）
  taskInstruction: TaskInstruction; // ⑥ 每轮变
  history: ChatTurn[];        // ⑦ 只追加
  retrieved: RetrievedChunk[]; // ⑧ 用到才来
  directives: string[];       // 回合级指令（纠偏/难度/节拍/有界话术；并入⑥段序列化）
}

/** 云侧流式完成元信息（CONTRACTS §7 CloudStreamResult 的回调形态）。 */
export interface CloudStreamMeta {
  usage: { promptTokens: number; completionTokens: number; cacheHit: boolean };
  modelUsed: string; // flash | pro（升级时）
}

/** 流式回调：chunk 逐行（A2UI JSONL 或机器级行内指令，见下）。 */
export interface CloudStreamCallbacks {
  onChunk(chunk: string): void;
  onDone(meta: CloudStreamMeta): void;
  onError(error: Error): void;
}

/**
 * 云侧 → orchestrator 的行内指令约定（A2UI JSONL 之外的机器级行，一行一条 JSON）：
 *  - {"tts":{"text":"…"}}                → TTS 指令，机器分派 tools.callTool('tts_speak', …)
 *  - {"tool_call":{"name":"…","args":…}} → 工具调用，结果作为 ⑧ 段 retrieved 回收
 * 其余含 surfaceUpdate 的行 = A2UI v0.9 消息，渐进下发 A2UiEmitterPort。
 */
export interface TtsLine {
  tts: { text: string; rate?: number };
}
export interface ToolCallLine {
  tool_call: { name: string; args: unknown };
}

/** 升级请求（CONTRACTS §7 EscalationRequest；单次、上下文最小化）。 */
export interface EscalationRequest {
  stuckAt: string;
  goal: string;
  skill: SkillName;
}

/** 云侧端口（§7.6：默认 flash、卡死单次升 pro、切回 flash 执行）。 */
export interface CloudClientPort {
  stream(request: CloudTurnRequest, callbacks: CloudStreamCallbacks): void;
  /** 卡死升级：五类信号（EscalationSignal）→ 单次 pro 请求 → 拿到 nextStep 切回 flash */
  escalate(request: EscalationRequest, signal: EscalationSignal): Promise<EscalationResult>;
}

// ── A2UiEmitterPort（PRD §7.1 渐进渲染）──

export interface A2UiEmitterPort {
  /** 逐行下发（JSONL 片段，后台线程流式解析后向主线程提交） */
  emit(jsonlChunk: string): void;
  /** 回合边界 flush（渲染层收尾） */
  flush(): void;
}

// ── ToolInvokerPort（§7.3；ToolName=CONTRACTS §6 联合，M6 收窄）──

export interface ToolInvokerPort {
  callTool(name: string, args: unknown): Promise<unknown>;
}

// ── StoragePort（薄封装 storage/repos；回合边界批量落盘 §7.7）──

/** 冷启动快照：端侧全量本地数据（离线可算，§6 端云边界）。 */
export interface StorageSnapshot {
  alus: Record<AluId, Alu>;
  aluStates: Record<AluId, AluUserState>;
  profile: LearnerProfile | null;
}

/** 回合边界落盘补丁：只写给出字段；reviewLogAppend 仅收 correct/wrong（fuzzy 不落盘，D8）。 */
export interface StorageCommitPatch {
  profile?: LearnerProfile;
  aluStates?: Record<AluId, AluUserState>;
  reviewLogAppend?: AnswerRecord[];
  sessionSummary?: SessionSummary;
  events?: SessionEvent[];
}

export interface StoragePort {
  loadSnapshot(): Promise<StorageSnapshot>;
  commit(patch: StorageCommitPatch): Promise<void>;
}

/** Orchestrator 全部依赖（构造注入；测试用内存 fake）。 */
export interface OrchestratorPorts {
  skills: SkillRuntimePort;
  cloud: CloudClientPort;
  emitter: A2UiEmitterPort;
  tools: ToolInvokerPort;
  storage: StoragePort;
}
