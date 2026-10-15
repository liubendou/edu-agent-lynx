/**
 * SourceCitation —— 出处引用的共享无样式 primitive（UID §四规则3）。
 * 概念卡/入口卡内嵌出处行；可点回原句的独立零件是 SourceLink（本文件不替代它）。
 */
import type { SourceRef } from '../../domain/alu';

export interface SourceCitationProps {
  sourceRef: SourceRef;
}

function locatorText(sourceRef: SourceRef): string {
  const loc = sourceRef.locator;
  return loc.kind === 'url' ? loc.url : `句子 ${loc.sentenceIndex ?? 0} · 字 ${loc.start}~${loc.end}`;
}

export function SourceCitation({ sourceRef }: SourceCitationProps) {
  return (
    <view className="cc-src">
      <text className="Text Text--aux">
        {`${sourceRef.docTitle} · ${locatorText(sourceRef)}`}
      </text>
      <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
        {sourceRef.text}
      </text>
    </view>
  );
}
