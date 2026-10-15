/**
 * RevealCard —— 复习/快速：上滑揭晓，答案在背面（UID §5.2"揭晓"）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.RevealCard。
 * M3：点击揭晓（背面条件渲染 + 生长入场）；上滑跟手 + 弹簧吸附的手势版
 * 归 M4 会话容器（主线程数值驱动，UID §7.1），本组件不预做半吊子跟手。
 */
import { useState } from '@lynx-js/react';
import type { ComponentPropsMap } from '../a2ui/catalog';

export type RevealCardProps = ComponentPropsMap['RevealCard'];

export function RevealCard({ front, back }: RevealCardProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <view className="a2ui-card a2ui-grow" bindtap={() => setRevealed((prev) => !prev)}>
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
