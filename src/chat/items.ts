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
import type { BootOutcome } from '../orchestrator/machine';

/** 对话项：agent 消息 / user 消息 / 打字骨架（骨架必被真实内容顶掉，脚本 §4-4）。 */
export type ChatItem =
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'user'; id: string; text: string }
  | { kind: 'typing'; id: string };

/** 纯文本对话项（MessageBubble 的入参收窄）。 */
export type ChatTextItem = Extract<ChatItem, { kind: 'agent' | 'user' }>;

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
