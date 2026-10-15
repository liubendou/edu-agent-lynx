/**
 * ChoiceGrid —— 复习/标准：选项，可单选可多选（UID §四）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.ChoiceGrid。
 * 交互（UID §5.2"选一个答案"）：按下 0.97（:active 引擎侧）、选中亮 accent 描边
 * 120ms、连点防抖 300ms；选择 → agent Action 'select'（影响下一轮生成）。
 */
import { useRef, useState } from '@lynx-js/react';
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';
import { TAP_DEBOUNCE_MS } from '../design-system/motion';

export type ChoiceGridProps = ComponentPropsMap['ChoiceGrid'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（选择=agent） */
  onAction?: (action: A2UIAction) => void;
};

export function ChoiceGrid({ options, multi, nodeId, onAction }: ChoiceGridProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const lastTapAt = useRef(0);

  const choose = (index: number) => {
    const now = Date.now();
    if (now - lastTapAt.current < TAP_DEBOUNCE_MS) return;
    lastTapAt.current = now;
    const next = multi === true
      ? (selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index])
      : (selected.length === 1 && selected[0] === index ? [] : [index]);
    setSelected(next);
    onAction?.({ kind: 'agent', nodeId: nodeId ?? '', action: 'select', payload: { selected: next, multi: multi === true } });
  };

  return (
    <view className="cg-grid">
      {options.map((option, index) => (
        <view
          key={`${index}-${option}`}
          className={`cg-opt pressable${selected.includes(index) ? ' cg-opt--selected' : ''}`}
          bindtap={() => choose(index)}
        >
          <text className="Text Text--body">{option}</text>
        </view>
      ))}
    </view>
  );
}
