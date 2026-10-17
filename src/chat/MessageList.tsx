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
import type { Observation } from '../orchestrator/machine';
import { MessageBubble } from './MessageBubble';
import { TypingSkeleton } from './TypingSkeleton';
import type { ChatItem } from './items';

export interface MessageListProps {
  items: ChatItem[];
  /** A2UI 当前快照（useA2UIStream 产出；卡片位挂在这上面） */
  surface: A2UISurfaceSnapshot;
  /** Action 回传（宿主路由：agent → 回合 / client → 本地） */
  onAction?: (action: A2UIAction) => void;
  /** 兜底提示的重试入口（三级兜底第③级：流内就地重放该回合） */
  onRetry?: (observation: Observation) => void;
  /** 无 Key 引导入口（去设置页填 API Key） */
  onOpenSettings?: () => void;
}

export function MessageList({ items, surface, onAction, onRetry, onOpenSettings }: MessageListProps) {
  return (
    <scroll-view className="chat-list" scroll-y={true} scroll-orientation="vertical">
      {items.map((item) => {
        if (item.kind === 'typing') return <TypingSkeleton key={item.id} />;
        if (item.kind === 'notice') {
          // 兜底提示：可见的失败告知 + 可重试入口（R-P3 不允许空白回合/静默失败）
          const retry = item.retry;
          return (
            <view key={item.id} className="chat-row chat-row--agent">
              <view className="chat-avatar" />
              <view className="chat-bubble chat-bubble--agent a2ui-grow">
                <text className="Text Text--aux s-error">{item.text}</text>
                {retry !== undefined || item.settingsGuide === true ? (
                  <view className="chat-chips">
                    {retry !== undefined && onRetry !== undefined ? (
                      <view className="chat-chip pressable" bindtap={() => onRetry(retry)}>
                        <text className="Text Text--aux chat-chip-text">接着讲</text>
                      </view>
                    ) : null}
                    {item.settingsGuide === true && onOpenSettings !== undefined ? (
                      <view className="chat-chip pressable" bindtap={onOpenSettings}>
                        <text className="Text Text--aux chat-chip-text">去设置页填 API Key</text>
                      </view>
                    ) : null}
                  </view>
                ) : null}
              </view>
            </view>
          );
        }
        return <MessageBubble key={item.id} item={item} />;
      })}
      {/* 卡片位：A2UI 快照非空才渲染（空快照 = 还没内容，由打字骨架顶着，不摆空壳） */}
      {surface.components.length > 0 ? (
        <view className="chat-cards">
          <A2UISurface state={surface} onAction={onAction} />
        </view>
      ) : null}
    </scroll-view>
  );
}
