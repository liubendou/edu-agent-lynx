/**
 * DueChip —— 首页："还有几张"，点开就还（UID §四；像本子上夹的一张便签，不是红点）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.DueChip。
 * 端侧直渲染（clientOnly，ARCHITECTURE §10）；点击 → client Action 'open_review'。
 */
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';

export type DueChipProps = ComponentPropsMap['DueChip'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（进复习=client，页面路由本地处理） */
  onAction?: (action: A2UIAction) => void;
};

export function DueChip({ count, nodeId, onAction }: DueChipProps) {
  return (
    <view className="due-chip pressable" bindtap={() => onAction?.({ kind: 'client', nodeId: nodeId ?? '', action: 'open_review', payload: { count } })}>
      <text className="Text Text--body">
        {count > 0 ? `今天有 ${count} 张要还` : '今天没有欠账'}
      </text>
    </view>
  );
}
