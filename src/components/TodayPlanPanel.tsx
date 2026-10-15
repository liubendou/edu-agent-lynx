/**
 * TodayPlanPanel —— 回访第一屏：三行端侧算（到期 N / 补讲 X / 建议一条）+ 开始。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.TodayPlanPanel。
 * 数据来自端侧 FSRS/决策（离线零等待，UID §2.2；clientOnly，ARCHITECTURE §10）；
 * 点击开始 → client Action 'start_today'。
 */
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';

export type TodayPlanPanelProps = ComponentPropsMap['TodayPlanPanel'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（开始学习=client） */
  onAction?: (action: A2UIAction) => void;
};

export function TodayPlanPanel({ dueCount, remediationCount, suggestionText, nodeId, onAction }: TodayPlanPanelProps) {
  return (
    <view className="a2ui-card a2ui-grow">
      <view className="tpp-row">
        <text className="Text Text--body">{`复习 ${dueCount} 张到期卡`}</text>
      </view>
      <view className="tpp-row">
        <text className="Text Text--body">{`补讲 ${remediationCount}`}</text>
      </view>
      <view className="tpp-row">
        <text className="Text Text--body" style={{ color: 'var(--ink-soft)' }}>
          {`今天建议学：${suggestionText}`}
        </text>
      </view>
      <view
        className="tpp-start pressable"
        bindtap={() => onAction?.({ kind: 'client', nodeId: nodeId ?? '', action: 'start_today', payload: { dueCount, remediationCount } })}
      >
        <text className="Text Text--body tpp-start-text">开始</text>
      </view>
    </view>
  );
}
