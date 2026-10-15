/**
 * ConceptCard —— 快速/标准：一个定义加出处，能展开（UID §四）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.ConceptCard；
 * nodeId/onAction 为 a2ui/surface.tsx 渲染层注入的运行时通道，不进 catalog schema。
 * 动效：生长入场（a2ui-grow）；展开/收起 120ms（--dur-select，UID 附录"选中/取消"）。
 */
import { useState } from '@lynx-js/react';
import type { ComponentPropsMap } from '../a2ui/catalog';
import { SourceCitation } from './primitives/SourceCitation';

export type ConceptCardProps = ComponentPropsMap['ConceptCard'];

/** 摘要截断（纸面每行 20~25 字口径，UID §1.1；超长收窄，不缩字号） */
function summarize(text: string): string {
  return text.length > 50 ? `${text.slice(0, 50)}…` : text;
}

export function ConceptCard({ title, definition, sourceRef, expandable }: ConceptCardProps) {
  const [expanded, setExpanded] = useState(false);
  const showFull = expandable !== true || expanded;
  return (
    <view className="a2ui-card a2ui-grow">
      <view className="cc-head">
        <text className="Text Text--card-title">{title}</text>
        {expandable === true ? (
          <text
            className="Text Text--aux cc-toggle pressable"
            bindtap={() => setExpanded((prev) => !prev)}
          >
            {expanded ? '收起' : '展开'}
          </text>
        ) : null}
      </view>
      <text className="Text Text--body cc-def">{showFull ? definition : summarize(definition)}</text>
      {sourceRef !== undefined ? <SourceCitation sourceRef={sourceRef} /> : null}
    </view>
  );
}
