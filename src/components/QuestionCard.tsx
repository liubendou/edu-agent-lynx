/**
 * QuestionCard —— 复习/标准/高质量：正题或变式，等他答（UID §四）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.QuestionCard。
 * 作答回传：answerType='choice' 时点选项 → agent Action 'answer'（连点防抖 300ms）；
 * 'free' 时 M3 只留作答提示（文字输入/左右滑作答的手势归属 M4 会话容器，UID §5.2）。
 */
import { useRef, useState } from '@lynx-js/react';
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';
import { TAP_DEBOUNCE_MS } from '../design-system/motion';

export type QuestionCardProps = ComponentPropsMap['QuestionCard'] & {
  /** 渲染层注入：组件实例 id（Action 回传引用，CONTRACTS §5 A2UIAction.nodeId） */
  nodeId?: string;
  /** 渲染层注入：Action 回传（作答=agent，进 SessionLoop observation） */
  onAction?: (action: A2UIAction) => void;
};

export function QuestionCard({ question, variantOfAlu, answerType, options, nodeId, onAction }: QuestionCardProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const lastTapAt = useRef(0);

  const choose = (index: number) => {
    const now = Date.now();
    if (now - lastTapAt.current < TAP_DEBOUNCE_MS) return; // 连点防抖：同语义 300ms 只认一次
    lastTapAt.current = now;
    const next = selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index];
    setSelected(next);
    onAction?.({ kind: 'agent', nodeId: nodeId ?? '', action: 'answer', payload: { variantOfAlu, selected: next } });
  };

  return (
    <view className="a2ui-card a2ui-grow">
      <text className="Text Text--card-title">{question}</text>
      {variantOfAlu !== undefined ? (
        <text className="Text Text--aux qc-variant" style={{ color: 'var(--ink-soft)' }}>
          {`变式 · ${variantOfAlu}`}
        </text>
      ) : null}
      {answerType === 'choice' && options !== undefined ? (
        <view className="cg-grid" style={{ marginTop: 'var(--space-3)' }}>
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
      ) : (
        <text className="Text Text--aux qc-hint" style={{ color: 'var(--ink-soft)' }}>
          先自己想，再作答（检索练习优于重读）
        </text>
      )}
    </view>
  );
}
