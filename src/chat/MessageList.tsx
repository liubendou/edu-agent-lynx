/**
 * MessageList —— 对话流容器（体验脚本 §1.1-2/6：单列对话流，卡片嵌在流内、跟 agent 一侧）。
 *
 * 卡片仍走原路：A2UI 组件节点 → A2UISurface 渲染（改造清单 §2 硬约束 2），
 * 只是被包进对话项位置里，不单独占页。
 * 滚动交给原生 <scroll-view>（UID §7 空间一致：不重造惯性）。
 */
import { A2UISurface } from '../a2ui/surface';
import type { A2UIAction } from '../a2ui/catalog';
import type { A2UISurfaceSnapshot } from '../a2ui/stream-parser';
import { MessageBubble } from './MessageBubble';
import { TypingSkeleton } from './TypingSkeleton';
import type { ChatItem } from './items';

export interface MessageListProps {
  items: ChatItem[];
  /** A2UI 当前快照（useA2UIStream 产出；卡片位挂在这上面） */
  surface: A2UISurfaceSnapshot;
  /** Action 回传（宿主路由：agent → 回合 / client → 本地） */
  onAction?: (action: A2UIAction) => void;
}

export function MessageList({ items, surface, onAction }: MessageListProps) {
  return (
    <scroll-view className="chat-list" scroll-y={true} scroll-orientation="vertical">
      {items.map((item) =>
        item.kind === 'typing' ? (
          <TypingSkeleton key={item.id} />
        ) : (
          <MessageBubble key={item.id} item={item} />
        ),
      )}
      {/* 卡片位：A2UI 快照非空才渲染（空快照 = 还没内容，由打字骨架顶着，不摆空壳） */}
      {surface.components.length > 0 ? (
        <view className="chat-cards">
          <A2UISurface state={surface} onAction={onAction} />
        </view>
      ) : null}
    </scroll-view>
  );
}
