/**
 * Composer —— 底部常驻输入框 + 发送键（体验脚本 §1.1-5；V1 只做文字，§7-2 无麦克风）。
 * 纯本地渲染：不进 a2ui catalog / registry。
 * 发送走现成通道 turn({kind:'user_text'})（orchestrator / 云侧零改动，改造清单 §3）。
 * 输入框非受控（Lynx InputProps 无 value，Home.tsx 同款）：发送后清空待批次 3 用 setValue 补。
 */
import { useState } from '@lynx-js/react';

export interface ChatComposerProps {
  /** 发送一句话（已 trim；空串不触发） */
  onSend: (text: string) => void;
}

export function ChatComposer({ onSend }: ChatComposerProps) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setText('');
    onSend(trimmed);
  };

  return (
    <view className="chat-composer">
      <input
        className="chat-composer-input"
        placeholder="直接说你想学什么…"
        bindinput={(e) => setText(e.detail.value)}
      />
      <view className="chat-composer-send pressable" bindtap={submit}>
        <text className="Text Text--body chat-composer-send-text">➤</text>
      </view>
    </view>
  );
}
