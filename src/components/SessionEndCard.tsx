/**
 * SessionEndCard —— 会话尾：收尾"下一个"；给正向峰值不给欠账（§10.2 峰值-终点律）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.SessionEndCard（next=null → 不给按钮）。
 * 不是弹窗庆祝，是一句话收尾加一个"下一个"（UID §2.3）；点击 → agent Action 'next'。
 */
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';

export type SessionEndCardProps = ComponentPropsMap['SessionEndCard'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（下一个=agent，影响下一轮决策） */
  onAction?: (action: A2UIAction) => void;
};

export function SessionEndCard({ highlight, next, nodeId, onAction }: SessionEndCardProps) {
  return (
    <view className="a2ui-card a2ui-grow">
      <text className="Text Text--section-title">{highlight}</text>
      {next !== null && next !== undefined && next !== '' ? (
        <view
          className="sec-next pressable"
          bindtap={() => onAction?.({ kind: 'agent', nodeId: nodeId ?? '', action: 'next', payload: { next } })}
        >
          <text className="Text Text--body sec-next-text">下一个</text>
        </view>
      ) : null}
    </view>
  );
}
