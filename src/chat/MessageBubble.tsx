/**
 * MessageBubble —— 单条消息气泡（左 agent / 右 user；改造清单批次 1）。
 * 纯本地渲染：不进 a2ui catalog / registry（items.ts 头注的硬约束）。
 * 入场复用 .a2ui-grow（共用动画工具类，仅 opacity+transform，禁令1）。
 */
import type { ChatTextItem } from './items';

export function MessageBubble({ item }: { item: ChatTextItem }) {
  const isAgent = item.kind === 'agent';
  return (
    <view className={isAgent ? 'chat-row chat-row--agent' : 'chat-row chat-row--user'}>
      {isAgent ? <view className="chat-avatar" /> : null}
      <view className={isAgent ? 'chat-bubble chat-bubble--agent a2ui-grow' : 'chat-bubble chat-bubble--user a2ui-grow'}>
        <text className={isAgent ? 'Text Text--body chat-text' : 'Text Text--body chat-text chat-text--user'}>
          {item.text}
        </text>
      </view>
    </view>
  );
}
