/**
 * MicButton —— 档4 费曼复述：长按说话（350ms 判定，UID §5.2/§八全站唯一长按标准）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.MicButton。
 * M6 接 sherpa-onnx ASR（仅档4 + 文字兜底，PRD §7.3）；本组件 M3 就位：
 * 长按 350ms 达标 → client Action 'mic_hold_start'（波形/识别 M6 接），
 * 提前松手 → 'mic_hold_cancel'，达标后松手 → 'mic_hold_end'。
 */
import { useRef, useState } from '@lynx-js/react';
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';
import { LONG_PRESS_MS } from '../design-system/motion';

export type MicButtonProps = ComponentPropsMap['MicButton'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（按住/松开=client，本地直处理：M6 起接录音状态） */
  onAction?: (action: A2UIAction) => void;
};

export function MicButton({ hint, nodeId, onAction }: MicButtonProps) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const emit = (action: string) =>
    onAction?.({ kind: 'client', nodeId: nodeId ?? '', action, payload: null });

  const onTouchStart = () => {
    startedRef.current = false;
    timerRef.current = setTimeout(() => {
      startedRef.current = true;
      setHolding(true);
      emit('mic_hold_start'); // 350ms 达标，全站唯一长按标准
    }, LONG_PRESS_MS);
  };

  const onTouchEnd = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (startedRef.current) {
      setHolding(false);
      startedRef.current = false;
      emit('mic_hold_end');
    } else {
      emit('mic_hold_cancel'); // 提前松手就是取消（UID §5.2）
    }
  };

  return (
    <view className="mic-wrap">
      <view
        className={`mic-btn pressable${holding ? ' mic-btn--holding' : ''}`}
        bindtouchstart={onTouchStart}
        bindtouchend={onTouchEnd}
        bindtouchcancel={onTouchEnd}
      >
        <text className="Text Text--body mic-icon">●</text>
      </view>
      <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
        {hint}
      </text>
    </view>
  );
}
