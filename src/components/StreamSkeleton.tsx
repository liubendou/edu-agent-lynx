/**
 * StreamSkeleton —— 首屏：骨架，必须定高（UID §2.1：0.5 秒内首条内容出来，
 * 骨架定高否则流会跳）。数据字段严格按 CONTRACTS §5 ComponentPropsMap.StreamSkeleton。
 * 端侧直渲染（clientOnly，ARCHITECTURE §10）；静态占位不做闪烁动画
 * （动画进行中不增删节点——流式追加期间骨架让位给内容，UID §7.2 禁令2）。
 */
import type { ComponentPropsMap } from '../a2ui/catalog';

export type StreamSkeletonProps = ComponentPropsMap['StreamSkeleton'];

export function StreamSkeleton({ heightPx }: StreamSkeletonProps) {
  return (
    <view className="skel" style={{ height: `${Math.max(0, heightPx)}px` }}>
      <view className="skel-line" />
      <view className="skel-line skel-line--short" />
    </view>
  );
}
