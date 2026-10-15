/**
 * 八段分层拼装器（M2c，CONTRACTS §7 / ARCHITECTURE §5 / PRD §7.7）。
 * 固定八段顺序①~⑧为代码硬约束（§7.9"能硬约束就别用软提示"）：
 *  ① System 约束  ② 心理学策略库  ③ A2UI catalog 全量常驻（catalog 本体在 M3，外部注入常量字符串）
 *  → ①②③ 序列化为字节级固定前缀（吃 DeepSeek 硬盘缓存，前缀完全匹配命中）；
 *  ④ Skill 模板（换档从此段起失效——设计内行为）  ⑤ 画像片段（绝不进前缀，回合边界更新）
 *  ⑥ 任务指令（每轮变）  ⑦ 对话历史（只追加）  ⑧ 按需检索（可寻址引用入窗）。
 * 前缀稳定性是硬指标：本模块绝不向①②③注入时间戳/随机 id/轮次号；
 * 物理消息序：①~⑤组成 system 消息（会话内稳定），⑥~⑧组成最新 user 消息（追加在历史尾部），
 * 保证 history 只追加即可吃满前缀缓存。
 * 窗口内用标签分段（PRD §7.7⑥）：<skill> <memory> <alu> <catalog> 等，比裸文本稳。
 */
import type { AluId, ISODate, SkillName } from '../domain/types';
import type { SkillParams } from '../skills/runtime';
import type { SourceRef, TextSpan, UrlLocator } from '../domain/alu';
import type { DailyBudget } from '../domain/queue';

/** ⑥ 段结构化内容（CONTRACTS §7；序列化注入）。 */
export interface TaskInstruction {
  aluIds: AluId[];                         // 今天学哪些 ALU
  mode: SkillName | 'remediation';          // 档位（remediation=复习 wrong 拉起的 90 秒补讲）
  params: SkillParams;                     // 深度/时长预算
  budget: DailyBudget;                     // 当日预算
  boundaries: string[];                    // 偏好边界硬约束（压缩保命清单②）
}

/** ⑦ 对话历史（只追加）。 */
export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  at?: ISODate;
}

/** ⑧ 按需检索（CONTRACTS §7：可寻址引用，不放整段原文）。 */
export interface RetrievedChunk {
  kind: 'alu_ref' | 'source_ref' | 'search_digest' | 'vision_digest';
  aluId?: AluId;
  sourceRef?: SourceRef;
  digest: string; // 截断/摘要后入窗
}

/** 八段请求（CONTRACTS §7 CloudRequest；segments 即八段本体）。 */
export interface CloudRequestSegments {
  system: string;                    // ① System 约束（跨所有请求不变）
  psychologyLibrary: string;         // ② 心理学策略库（随产品版本变）
  catalog: string;                   // ③ A2UI catalog 全量 JSON Schema（产品级常量，M3 注入）
  skillTemplate: string;             // ④ 当前档 Skill 模板
  profileFragment: string;           // ⑤ 端侧画像最小片段（绝不进前缀）
  taskInstruction: TaskInstruction;   // ⑥ 每轮变
  history: ChatTurn[];               // ⑦ 只追加
  retrieved: RetrievedChunk[];       // ⑧ 按需（用到才来）
}

/** OpenAI 兼容消息（chat/completions 的 messages 元素）。 */
export interface CloudMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/** buildRequest 产物。 */
export interface BuiltRequest {
  /** ①+②+③ 序列化：字节级稳定前缀（同版本同用户完全一致，吃硬盘缓存）。 */
  prefix: string;
  /** system 消息 content = 前缀①②③ + ④（会话内稳定，换档失效）。 */
  systemContent: string;
  /** ⑤ 画像消息 content（独立 system 消息，绝不进前缀）。 */
  memoryContent: string;
  /** 最新 user 消息 content = ⑥任务指令 + ⑧可寻址检索引用。 */
  currentTurnContent: string;
  messages: CloudMessage[];
}

/** ①②③ 稳定段输入（同版本同用户完全一致；禁止时间戳/随机 id）。 */
export interface StableSegments {
  system: string;
  psychologyLibrary: string;
  catalog: string;
}

/** ⑧ 段可寻址引用单条预算（§7.7③：截断+摘要后入窗）。 */
export const MAX_RETRIEVED_DIGEST_CHARS = 400;

/** ①②③ → 字节级固定字符串。纯函数：同输入字节级相等，无任何动态注入。 */
export function buildStablePrefix(stable: StableSegments): string {
  return (
    `<system>\n${stable.system}\n</system>\n`
    + `<psychology>\n${stable.psychologyLibrary}\n</psychology>\n`
    + `<catalog>\n${stable.catalog}\n</catalog>\n`
  );
}

/** 句子级 span / URL → 紧凑定位描述（可寻址引用：ALU-id + 出处 + 句子级 span，§7.7③）。 */
export function formatLocator(locator: SourceRef['locator']): string {
  if (locator.kind === 'span') {
    const span = locator as TextSpan;
    const idx = span.sentenceIndex !== undefined ? `#${span.sentenceIndex}` : '';
    return `span(${span.start}-${span.end}${idx})`;
  }
  const url = locator as UrlLocator;
  return `url(${url.url})`;
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/** ⑧ 单条 → 可寻址引用行（alu-id + 出处 + 句子级 span + 截断 digest，代替原文粘贴）。 */
export function formatRetrievedChunk(chunk: RetrievedChunk): string {
  const ref = chunk.aluId ?? chunk.sourceRef?.docId ?? 'unknown';
  const loc = chunk.sourceRef ? ` loc=${formatLocator(chunk.sourceRef.locator)} doc="${chunk.sourceRef.docTitle}"` : '';
  const digest = truncate(chunk.digest.replace(/\s+/g, ' ').trim(), MAX_RETRIEVED_DIGEST_CHARS);
  return `- [${chunk.kind}] alu=${ref}${loc} digest="${digest}"`;
}

/** ⑥ → 稳定 JSON（键序 = 接口字面量序，确定性序列化；绝不内嵌时间戳）。 */
export function serializeTaskInstruction(task: TaskInstruction): string {
  return JSON.stringify({
    aluIds: task.aluIds,
    mode: task.mode,
    params: task.params,
    budget: task.budget,
    boundaries: task.boundaries,
  });
}

/** 八段 → OpenAI 兼容消息序列。物理序：①~④ system 前缀消息 → ⑤ memory 消息 → ⑦历史 → ⑥⑧当前 user 消息。 */
export function buildRequest(segments: CloudRequestSegments): BuiltRequest {
  const prefix = buildStablePrefix(segments);
  const systemContent = `${prefix}\n<skill>\n${segments.skillTemplate}\n</skill>\n`;
  const memoryContent = `<memory>\n${segments.profileFragment}\n</memory>\n`;
  const taskBlock = `<task>\n${serializeTaskInstruction(segments.taskInstruction)}\n</task>`;
  const retrievedBlock = segments.retrieved.length > 0
    ? `\n<alu>\n${segments.retrieved.map(formatRetrievedChunk).join('\n')}\n</alu>`
    : '';
  const currentTurnContent = `${taskBlock}${retrievedBlock}`;

  const historyMessages: CloudMessage[] = segments.history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const messages: CloudMessage[] = [
    { role: 'system', content: systemContent },
    { role: 'system', content: memoryContent },
    ...historyMessages,
    { role: 'user', content: currentTurnContent },
  ];

  return { prefix, systemContent, memoryContent, currentTurnContent, messages };
}
