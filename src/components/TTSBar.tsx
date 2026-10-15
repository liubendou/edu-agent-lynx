/**
 * TTSBar —— 快速/标准/高质量：播/停/倍速/重播（§7.3 TTS 覆盖四档）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.TTSBar。
 * M6 接 sherpa-onnx + Kokoro（端侧离线，语速接画像偏好 §5.1 C）；M3 就位：
 * 图标即时切换（播放中=暂停键）、点击 → client Action 'play'/'pause'/'replay'。
 * 进度线：M3 无播放位置回传，静态半透明填充；跟手拖动归 M6（主线程脚本）。
 */
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';

export type TTSBarProps = ComponentPropsMap['TTSBar'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（播/停/重播=client，本地直处理） */
  onAction?: (action: A2UIAction) => void;
};

export function TTSBar({ playing, rate, durationMs, nodeId, onAction }: TTSBarProps) {
  const emit = (action: string) =>
    onAction?.({ kind: 'client', nodeId: nodeId ?? '', action, payload: { playing, rate } });
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return (
    <view className="tts-bar">
      <view className="tts-btn pressable" bindtap={() => emit(playing ? 'pause' : 'play')}>
        <text className="Text Text--body tts-btn-text">{playing ? '❚❚' : '▶'}</text>
      </view>
      <view className="tts-mid">
        <view className="tts-track">
          <view className="tts-fill" style={{ width: playing ? '12%' : '0%' }} />
        </view>
      </view>
      <text
        className="Text Text--aux pressable"
        style={{ color: 'var(--ink-soft)', marginRight: 'var(--space-3)' }}
        bindtap={() => emit('replay')}
      >
        重播
      </text>
      <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
        {`${rate}x · ${seconds}s`}
      </text>
    </view>
  );
}
