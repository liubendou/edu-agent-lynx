/**
 * TTSBar —— 快速/标准/高质量：播/停/倍速/重播（§7.3 TTS 覆盖四档）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.TTSBar。
 * M6 接线：play → tools/tts.speak（sherpa-onnx + Kokoro 端侧离线，语速用 props.rate 接画像
 * §5.1 C 层），播报文本取 tools 层最近一次合成内容（getLastSpokenText；A2UI 下发的 TTS 文本
 * 经 tools/tts.speak 落在那里）；pause → stopSpeak；replay → 重新 speak。
 * 播报文本为空（无可播）时回退 emit 原有 Action（宿主/Session 层自行处理）。
 * 跟手拖动进度线仍归 M7（主线程脚本）；playing 状态仍由 A2UI props 驱动。
 */
import { useState } from '@lynx-js/react';
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';
import { getLastSpokenText, speak, stopSpeak } from '../tools/tts';

export type TTSBarProps = ComponentPropsMap['TTSBar'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（播/停/重播=client，本地直处理） */
  onAction?: (action: A2UIAction) => void;
};

export function TTSBar({ playing, rate, durationMs, nodeId, onAction }: TTSBarProps) {
  // 本地播放态（props.playing 是 A2UI 快照；本地操作立即反映，不等下一帧下发）
  const [localPlaying, setLocalPlaying] = useState(false);
  const isPlaying = localPlaying || playing;
  const emit = (action: string) =>
    onAction?.({ kind: 'client', nodeId: nodeId ?? '', action, payload: { playing: isPlaying, rate } });

  const onPlayPause = () => {
    if (isPlaying) {
      stopSpeak();
      setLocalPlaying(false);
      emit('pause');
      return;
    }
    emit('play');
    const text = getLastSpokenText();
    if (text.length > 0) {
      void speak(text, { rate }).then((result) => {
        setLocalPlaying(result.ok); // 合成失败（无桥/模型缺失）静默回落：Action 已 emit，宿主可兜底
      });
    }
  };

  const onReplay = () => {
    emit('replay');
    const text = getLastSpokenText();
    if (text.length > 0) {
      void speak(text, { rate }).then((result) => setLocalPlaying(result.ok));
    }
  };

  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return (
    <view className="tts-bar">
      <view className="tts-btn pressable" bindtap={onPlayPause}>
        <text className="Text Text--body tts-btn-text">{isPlaying ? '❚❚' : '▶'}</text>
      </view>
      <view className="tts-mid">
        <view className="tts-track">
          <view className="tts-fill" style={{ width: isPlaying ? '12%' : '0%' }} />
        </view>
      </view>
      <text
        className="Text Text--aux pressable"
        style={{ color: 'var(--ink-soft)', marginRight: 'var(--space-3)' }}
        bindtap={onReplay}
      >
        重播
      </text>
      <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
        {`${rate}x · ${seconds}s`}
      </text>
    </view>
  );
}
