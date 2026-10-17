/**
 * TypingSkeleton —— "对方正在输入"打字骨架（体验脚本 §1.1-4）。
 *
 * 硬约束：它**必须会被真实内容替换**，不是永不填充的占位块（脚本 §4-4）。
 * 动画只改 opacity（UID §7.2 禁令1：动画不碰布局属性）。
 */
export function TypingSkeleton() {
  return (
    <view className="chat-row chat-row--agent">
      <view className="chat-avatar" />
      <view className="chat-bubble chat-bubble--typing a2ui-grow">
        <view className="chat-dot chat-dot--1" />
        <view className="chat-dot chat-dot--2" />
        <view className="chat-dot chat-dot--3" />
      </view>
    </view>
  );
}
