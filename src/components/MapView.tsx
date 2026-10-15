/**
 * MapView —— 快速/高质量/地图页：概念关系图（UID §四；关系=并列/包含/因果/前置）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.MapView。
 * M3：节点 chip + 关系清单（确定性布局）。点节点 → 高亮 + client Action 'focus_node'。
 * M4 T5 手势版：单指拖图平移跟手（主线程脚本 1:1 累计位移，UID §5.2"地图上走"；
 * 跨线程上报节流禁令——平移只在主线程改 transform，不走后台 setState）；点节点
 * 保持 tap（拖动结束的 touchend 与 tap 不冲突：Lynx 有位移不触发 tap）。
 */
import { useRef, useState } from '@lynx-js/react';
import { useMainThreadRef } from '@lynx-js/react';
import type { MainThread } from '@lynx-js/types';
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';
import { TAP_DEBOUNCE_MS } from '../design-system/motion';

export type MapViewProps = ComponentPropsMap['MapView'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（点节点=client，本地直处理：点亮连线/埋点） */
  onAction?: (action: A2UIAction) => void;
};

const RELATION_LABEL = {
  parallel: '并列',
  contains: '包含',
  causal: '因果',
  prereq: '前置',
} as const;

export function MapView({ nodes, edges, nodeId, onAction }: MapViewProps) {
  const [litId, setLitId] = useState<string | null>(null);
  const lastTapAt = useRef(0);
  const pan = useMainThreadRef<{ lastX: number; lastY: number; x: number; y: number } | null>(null);

  const onPanStart = (e: MainThread.TouchEvent) => {
    'main thread';
    const touch = e.touches[0];
    if (touch === undefined) return;
    pan.current = { lastX: touch.clientX, lastY: touch.clientY, x: 0, y: 0 };
  };
  const onPanMove = (e: MainThread.TouchEvent) => {
    'main thread';
    const state = pan.current;
    const touch = e.touches[0];
    if (state === null || touch === undefined) return;
    state.x += touch.clientX - state.lastX; // 1:1 累计，不做平滑（UID §5.1 原则2）
    state.y += touch.clientY - state.lastY;
    state.lastX = touch.clientX;
    state.lastY = touch.clientY;
    e.currentTarget.setStyleProperty('transform', `translate(${state.x}px, ${state.y}px)`);
  };
  const onPanEnd = () => {
    'main thread';
    pan.current = null; // 平移停留原地（图跟手；不做回弹）
  };

  const focus = (id: string) => {
    const now = Date.now();
    if (now - lastTapAt.current < TAP_DEBOUNCE_MS) return;
    lastTapAt.current = now;
    setLitId((prev) => (prev === id ? null : id));
    onAction?.({ kind: 'client', nodeId: nodeId ?? '', action: 'focus_node', payload: { nodeId: id } });
  };

  const labelOf = (id: string): string => nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <view
      className="a2ui-card a2ui-grow"
      main-thread:bindtouchstart={onPanStart}
      main-thread:bindtouchmove={onPanMove}
      main-thread:bindtouchend={onPanEnd}
      main-thread:bindtouchcancel={onPanEnd}
    >
      <view className="mv-chips">
        {nodes.map((n) => (
          <view
            key={n.id}
            className={`pressable${litId === n.id ? ' mv-chip--lit' : ' mv-chip'}`}
            bindtap={() => focus(n.id)}
          >
            <text className="Text Text--body">{n.label}</text>
          </view>
        ))}
      </view>
      {edges.map((edge, index) => (
        <view key={`${edge.from}-${edge.to}-${index}`} className="mv-edge">
          <text className="Text Text--aux">{labelOf(edge.from)}</text>
          <text className="Text Text--aux mv-rel">{`—${RELATION_LABEL[edge.relation]}→`}</text>
          <text className="Text Text--aux">{labelOf(edge.to)}</text>
        </view>
      ))}
      {nodes.length === 0 ? (
        <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
          地图还没有节点
        </text>
      ) : null}
    </view>
  );
}
