/**
 * chat/items —— 对话项数据模型与文案（对话外壳的数据层；改造清单批次 1）。
 *
 * 硬约束（防退化，必须遵守）：
 *  - 本目录任何组件/名称都**不得**注册进 a2ui/surface.tsx 的 A2UI_COMPONENT_REGISTRY，
 *    也不得出现在 a2ui/catalog.ts。catalog 是云侧字节级稳定前缀 ③
 *    （cloud/context-builder.ts），混进对话外壳即 DeepSeek 前缀缓存失效——真金白银的代价。
 *  - 对话外壳一律客户端本地渲染；卡片仍走原路（A2UI 组件节点 → A2UISurface）。
 *
 * 依据：`首屏体验脚本.md`（已签字，最高事实源）§1 首启第一屏 / §1.3 时间线。
 */
import type { BootOutcome, Observation } from '../orchestrator/machine';

/** 对话项：agent 消息 / user 消息 / 兜底提示 / 打字骨架（骨架必被真实内容顶掉，脚本 §4-4）。 */
export type ChatItem = ChatTextItem | ChatNoticeItem | { kind: 'typing'; id: string };

/** 纯文本对话项（MessageBubble 的入参收窄）。 */
export type ChatTextItem =
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'user'; id: string; text: string };

/**
 * 兜底提示项（验收 S1.8 / 红线 R-P3 三级兜底第③级「显式告知用户」）：
 * 回合以失败收场时进对话流的一条**可见**提示——绝不静默留白，也不透出堆栈/内部代号。
 * 可重试入口（retry）与无 Key 引导入口（settingsGuide）由对话流就地给出，用户不必自己找路。
 */
export interface ChatNoticeItem {
  kind: 'notice';
  id: string;
  text: string;
  /** 可安全重放的 observation（有则渲染「接着讲」入口） */
  retry?: Observation;
  /** 无 Key 引导（config.mock === true）：渲染「去设置页填 API Key」入口 */
  settingsGuide?: boolean;
}

/** 渲染 key 用自增 id：同一次挂载内稳定、跨项唯一（模块级计数，无随机/时间戳）。 */
let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq)}`;
}

export function agentItem(text: string): ChatItem {
  return { kind: 'agent', id: nextId('agent'), text };
}

export function userItem(text: string): ChatItem {
  return { kind: 'user', id: nextId('user'), text };
}

export function typingItem(): ChatItem {
  return { kind: 'typing', id: nextId('typing') };
}

/**
 * 兜底提示项构造（三级兜底第③级）：一次失败回合对应一条提示，落在流末尾。
 * retry 只接受可安全重放的 observation（见 isRetryable）；answer 类不给入口，防重复记账。
 */
export function noticeItem(
  text: string,
  options: { retry?: Observation; settingsGuide?: boolean } = {},
): ChatItem {
  return {
    kind: 'notice',
    id: nextId('notice'),
    text,
    ...(options.retry !== undefined ? { retry: options.retry } : {}),
    ...(options.settingsGuide === true ? { settingsGuide: true } : {}),
  };
}

/** 可安全重放的 observation：answer/tool_result 带记账副作用（重复判定=重复写 FSRS/流水），不给重试入口。 */
export function isRetryable(observation: Observation): boolean {
  return observation.kind !== 'answer' && observation.kind !== 'tool_result';
}

/**
 * 打字态开关：骨架统一钉在流末尾（保证流里只有一条，且一定被随后的真实内容顶掉——
 * 不允许出现"永远不会被填充的占位块"，脚本 §4-4）。
 */
export function withTyping(items: ChatItem[], on: boolean): ChatItem[] {
  const base = items.filter((i) => i.kind !== 'typing');
  return on ? [...base, typingItem()] : base;
}

/**
 * 首启第一句 agent 消息（脚本 §1.2 口径：陈述句引子，用户不需要点任何东西）。
 * 文案口径由产品定（脚本 §7-4），此处按 2026-10-17 用户选定版本落地。
 */
export const FIRST_RUN_OPENING =
  '嘿，先不问你任何问题。花 3 分钟，你就知道“合上资料自测”为什么比重复阅读有效。';

/**
 * 首屏开场文案：首启用 §1.2 引子；回访承接上一次（脚本 §2，批次 2 细化，
 * 此处先用机器给的有界话术占位，不做开放结尾——§10.1①）。
 */
export function openingTextFor(boot: Pick<BootOutcome, 'isFirstRun' | 'boundedLine'>): string {
  return boot.isFirstRun ? FIRST_RUN_OPENING : boot.boundedLine;
}

// ── 回合失败的兜底文案（三级兜底第③级；面向"下一步做什么"，绝不透出堆栈/错误码/内部代号）──

/** 回合失败（云侧异常 / validator 终态未过 / 无内容可上屏）：给动作，不给原因堆栈。 */
export const TURN_FAILURE_NOTICE = '这一回合没接上，你刚才的进度没丢。点「接着讲」或直接再说一句，我马上接上。';

/** 上一回合还在跑时又发了一条：不静默丢弃，同样给可见提示。 */
export const TURN_BUSY_NOTICE = '你上一条我还在答，这条先没接上。点「接着讲」或稍等半句，我马上接上。';

/** 无 Key（config.mock === true）时失败：引导去设置页填 Key——离线部分照常可用，不首屏拦截。 */
export const TURN_NO_KEY_NOTICE =
  '这一回合没接上：这台设备还没配置 API Key。点「去设置页填 API Key」填好，我就能真的讲给你听——你刚才的进度都在。';
