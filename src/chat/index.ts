/**
 * src/chat —— 对话外壳（客户端本地渲染）。
 *
 * 硬约束：本目录任何组件/名称不得注册进 a2ui/surface.tsx registry、
 * 不得出现在 a2ui/catalog.ts（catalog = 云侧字节级稳定前缀③，改即缓存失效）。
 */
export { ChatComposer, type ChatComposerProps } from './Composer';
export { MessageBubble } from './MessageBubble';
export { MessageList, type MessageListProps } from './MessageList';
export { TypingSkeleton } from './TypingSkeleton';
export { SuggestionChips, SUGGESTIONS, type SuggestionChipsProps } from './SuggestionChips';
export {
  agentItem,
  userItem,
  typingItem,
  noticeItem,
  withTyping,
  isRetryable,
  openingTextFor,
  FIRST_RUN_OPENING,
  TURN_FAILURE_NOTICE,
  TURN_BUSY_NOTICE,
  TURN_NO_KEY_NOTICE,
  type ChatItem,
  type ChatTextItem,
  type ChatNoticeItem,
} from './items';
