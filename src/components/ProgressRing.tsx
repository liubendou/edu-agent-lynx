/**
 * ProgressRing —— 高质量/成长：掌握度；S 上涨时长一格（§10.2 信号1 落点）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.ProgressRing。
 * 视觉：进度是一条细线（UID §三：不做成横贯全屏的粗条，也不给百分比）；
 * grewBy>0 → 松绿"长了一格"（奖励幅度小、弹簧软——由 M4 会话容器驱动，本组件静态呈现）。
 */
import type { ComponentPropsMap } from '../a2ui/catalog';

export type ProgressRingProps = ComponentPropsMap['ProgressRing'];

export function ProgressRing({ progress, label, grewBy }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <view className="a2ui-card a2ui-grow">
      <text className="Text Text--body">{label}</text>
      <view className="pr-track">
        <view className="pr-fill" style={{ width: `${Math.round(clamped * 100)}%` }} />
      </view>
      <view className="pr-foot">
        <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
          {`${Math.round(clamped * 100)}%`}
        </text>
        {grewBy !== undefined && grewBy > 0 ? (
          <text className="Text Text--aux pr-grew">长了一格</text>
        ) : null}
      </view>
    </view>
  );
}
