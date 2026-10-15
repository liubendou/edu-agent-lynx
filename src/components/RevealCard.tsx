/**
 * RevealCard —— 复习/快速：上滑揭晓，答案在背面（UID §5.2"揭晓"）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.RevealCard。
 * M3：点击揭晓（背面条件渲染 + 生长入场），保留为 tap 兜底。
 * M4 T5 手势版：上拖跟手（主线程脚本 1:1 位移，UID §5.1 原则2）——主轴位移超
 * DIRECTION_LOCK_PX 锁定为竖直上拖后，卡片跟手指上移；松手越过阈值揭晓
 * （hapticSnap 吸附触觉，D1 ①）+ 背面生长入场；不够阈值弹回原位（transform 复位）。
 * 阈值补位：主线程拿不到卡片实测高度，取 SWIPE_THRESHOLD_RATIO(0.3) × 常见卡高
 * 320px ≈ 96px；M7 真机校准（UID 附录"卡片宽度的 30%"同源比例）。
 */
import { useState } from '@lynx-js/react';
import { runOnBackground, useMainThreadRef } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';
import type { ComponentPropsMap } from '../a2ui/catalog';
import { DIRECTION_LOCK_PX } from '../design-system/motion';
import { hapticSnap } from './haptics';

export type RevealCardProps = ComponentPropsMap['RevealCard'];

/** 上滑揭晓判定阈值（px）：0.3 × 常见卡高 320px，M7 真机校准。 */
const REVEAL_THRESHOLD_PX = 96;

export function RevealCard({ front, back }: RevealCardProps) {
  const [revealed, setRevealed] = useState(false);
  const drag = useMainThreadRef<{ startY: number; locked: boolean } | null>(null);

  const onTouchStart = (e: MainThread.TouchEvent) => {
    'main thread';
    const y = e.touches[0]?.clientY ?? 0;
    drag.current = { startY: y, locked: false };
  };
  const onTouchMove = (e: MainThread.TouchEvent) => {
    'main thread';
    const state = drag.current;
    if (state === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - state.startY;
    if (!state.locked) {
      if (Math.abs(dy) < DIRECTION_LOCK_PX) return;
      state.locked = dy < 0; // 上拖锁定（横滑作答是会话容器的事，此处不上锁横向）
    }
    if (state.locked && dy < 0) {
      e.currentTarget.setStyleProperty('transform', `translateY(${dy}px)`); // 跟手 1:1
    }
  };
  const revealByGesture = () => {
    setRevealed(true);
    hapticSnap();
  };

  // 松手：transform 复位（揭晓由背景态接手：背面生长入场；未越阈弹回原位）；
  // 越阈用 changedTouches 收尾位置重算位移（同一触点，与 move 一致）。
  const onTouchEnd = (e: MainThread.TouchEvent) => {
    'main thread';
    const state = drag.current;
    drag.current = null;
    if (state === null) return;
    const dy = (e.changedTouches[0]?.clientY ?? 0) - state.startY;
    e.currentTarget.setStyleProperty('transform', 'translateY(0px)');
    if (state.locked && dy <= -REVEAL_THRESHOLD_PX) {
      runOnBackground(revealByGesture)(); // 吸附到位：揭晓 + 触觉（D1 ①）
    }
  };

  return (
    <view
      className="a2ui-card a2ui-grow"
      bindtap={() => setRevealed((prev) => !prev)}
      main-thread:bindtouchstart={onTouchStart}
      main-thread:bindtouchmove={onTouchMove}
      main-thread:bindtouchend={onTouchEnd}
    >
      <view className="rc-front">
        <text className="Text Text--card-title">{front}</text>
      </view>
      {revealed ? (
        <view className="rc-back a2ui-grow">
          <text className="Text Text--body">{back}</text>
        </view>
      ) : (
        <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
          想好再看答案（点击揭晓）
        </text>
      )}
    </view>
  );
}
