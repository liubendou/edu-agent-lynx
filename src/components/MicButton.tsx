/**
 * MicButton —— 档4 费曼复述：长按说话（350ms 判定，UID §5.2/§八全站唯一长按标准）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.MicButton。
 * M6 接线：长按 350ms 达标 → asr.startListening（sherpa-onnx 流式 zipformer，仅档4 启用由
 * Session 层把关爱控，本组件按 asr 可用性降级）；识别中间结果实时上屏（partial），
 * 松手 → stop() 取累计全文回传 'mic_asr_result'；ASR 不可用 → 'mic_text_fallback'
 * （PRD §7.3 文字兜底：ASR 质量不得阻塞 V1）。
 * 既有 Action（mic_hold_start/cancel/end）契约不变，新增 Action 仅向后兼容追加。
 */
import { useRef, useState } from '@lynx-js/react';
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';
import { LONG_PRESS_MS } from '../design-system/motion';
import { startListening, type AsrSession } from '../tools/asr';

export type MicButtonProps = ComponentPropsMap['MicButton'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（按住/松开=client，本地直处理：M6 起接录音状态） */
  onAction?: (action: A2UIAction) => void;
};

export function MicButton({ hint, nodeId, onAction }: MicButtonProps) {
  const [holding, setHolding] = useState(false);
  /** 识别中间结果上屏（空串=未在识别；不改动 hint 字段本身，仅本地展示层）。 */
  const [partialText, setPartialText] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  const sessionRef = useRef<AsrSession | null>(null);

  const emit = (action: string, payload: unknown = null) =>
    onAction?.({ kind: 'client', nodeId: nodeId ?? '', action, payload });

  const onTouchStart = () => {
    startedRef.current = false;
    timerRef.current = setTimeout(() => {
      startedRef.current = true;
      setHolding(true);
      emit('mic_hold_start'); // 350ms 达标，全站唯一长按标准
      // M6：长按达标即开录（端侧流式识别）；不可用/失败走文字兜底 Action
      void startListening({
        onPartial: (partial) => setPartialText(partial),
        onError: (err) => {
          setPartialText('');
          emit('mic_text_fallback', { reason: err }); // 文字兜底入口（Session 层接线 M7）
        },
      }).then((session) => {
        if ('stop' in session) {
          sessionRef.current = session;
        } else {
          setPartialText('');
          emit('mic_text_fallback', { reason: (session as { error: string }).error });
        }
      });
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
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session !== null) {
        void session.stop().then((text) => {
          setPartialText('');
          if (text.length > 0) emit('mic_asr_result', { text }); // 识别全文回传（Session 层消费，M7 接线）
        });
      }
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
        <text className="Text Text--body mic-icon">{holding ? '◉' : '●'}</text>
      </view>
      <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
        {partialText.length > 0 ? partialText : hint}
      </text>
    </view>
  );
}
