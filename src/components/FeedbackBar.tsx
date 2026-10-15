/**
 * FeedbackBar —— 复习/标准：对/模糊/错三档（UID §5.4）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.FeedbackBar。
 * 判定有快有慢（§10.3）→ 按下反馈先行、判定异步补上：pendingJudge 只降低整条
 * 透明度（0.7），不禁用——他按下去了界面就得有反应，不留空等。
 * 落下（被判定）：对=轻上移 4px、模糊/错=下沉 4px（错不抖，UID §5.4 修订版）；
 * 连点防抖 300ms；选择 → agent Action 'grade'（判定对错到达时的触觉由 M6
 * haptics.ts 接线，D1：吸附到位/判定对错两处）。
 * "模糊"是脚手架的入口（再讲一遍，不记账 D8），不是废票。
 */
import { useRef, useState } from '@lynx-js/react';
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';
import type { Grade } from '../domain/types';
import { TAP_DEBOUNCE_MS } from '../design-system/motion';
import { hapticJudge } from './haptics';

export type FeedbackBarProps = ComponentPropsMap['FeedbackBar'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（判定=agent，进 SessionLoop observation） */
  onAction?: (action: A2UIAction) => void;
};

const GRADE_LABEL = { correct: '对', fuzzy: '模糊', wrong: '错' } as const;

export function FeedbackBar({ grades, pendingJudge, nodeId, onAction }: FeedbackBarProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const lastTapAt = useRef(0);

  const judge = (grade: string) => {
    if (!grades.includes(grade as Grade)) return;
    const now = Date.now();
    if (now - lastTapAt.current < TAP_DEBOUNCE_MS) return;
    lastTapAt.current = now;
    setChosen(grade);
    hapticJudge(grade as Grade); // M4 T5 接线：判定对错触觉（D1 ②；真机手感 M7 回归）
    onAction?.({ kind: 'agent', nodeId: nodeId ?? '', action: 'grade', payload: { grade } });
  };

  return (
    <view className={`fb-bar${pendingJudge ? ' fb-pending' : ''}`}>
      {(['correct', 'fuzzy', 'wrong'] as const).map((grade) => {
        const enabled = grades.includes(grade);
        const classes = [
          'fb-btn',
          `fb-btn--${grade}`,
          enabled ? 'pressable' : 'disabled',
          chosen === grade ? `fb-btn--chosen-${grade}` : '',
        ].filter(Boolean).join(' ');
        return (
          <view key={grade} className={classes} bindtap={() => judge(grade)}>
            <text className="Text Text--body">{GRADE_LABEL[grade]}</text>
          </view>
        );
      })}
    </view>
  );
}
