/**
 * SuggestionChips —— 首屏示例问题（豆包式入口；用户体验裁决 2026-10-17）。
 * 纯本地渲染：不进 a2ui catalog / registry（catalog = 云侧字节级稳定前缀③）。
 * 只在还没有用户消息时出现（用户一开口即收起，不再占画面）；点一下 = 当成一句话发出去。
 */
export interface SuggestionChipsProps {
  /** 点击某个示例问题 → 当作 user 消息发送（走现成 turn({kind:'user_text'}) 通道） */
  onPick: (text: string) => void;
}

/** 示例问题文案（3~4 条；口语问句，不含任何内部代号） */
export const SUGGESTIONS = [
  '讲透「检索练习」',
  '讲透「错题管理」',
  '讲透「间隔复习」',
  '我该从哪开始',
];

export function SuggestionChips({ onPick }: SuggestionChipsProps) {
  return (
    <view className="chat-chips">
      {SUGGESTIONS.map((text) => (
        <view key={text} className="chat-chip pressable" bindtap={() => onPick(text)}>
          <text className="Text Text--aux chat-chip-text">{text}</text>
        </view>
      ))}
    </view>
  );
}
