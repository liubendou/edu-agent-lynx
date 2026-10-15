/**
 * MapView —— 快速/高质量/地图页：概念关系图（UID §四；关系=并列/包含/因果/前置）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.MapView。
 * M3：节点 chip + 关系清单（确定性布局）；单指拖图/平移跟手归 M4 地图页
 * （主线程脚本，UID §5.2"地图上走"）。点节点 → 高亮 + client Action 'focus_node'。
 */
import { useRef, useState } from '@lynx-js/react';
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

  const focus = (id: string) => {
    const now = Date.now();
    if (now - lastTapAt.current < TAP_DEBOUNCE_MS) return;
    lastTapAt.current = now;
    setLitId((prev) => (prev === id ? null : id));
    onAction?.({ kind: 'client', nodeId: nodeId ?? '', action: 'focus_node', payload: { nodeId: id } });
  };

  const labelOf = (id: string): string => nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <view className="a2ui-card a2ui-grow">
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
