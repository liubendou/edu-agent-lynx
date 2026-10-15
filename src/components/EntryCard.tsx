/**
 * EntryCard —— 首页/资料库：资源型条目入口卡，打开即看，不进复习队列（§4.3 两层分流）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.EntryCard。
 * 端侧直渲染（clientOnly，ARCHITECTURE §10）；点击 → client Action 'open_url'
 * （外部资源页经 <webview> 承接，PRD §7.1）。
 */
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';
import { SourceCitation } from './primitives/SourceCitation';

export type EntryCardProps = ComponentPropsMap['EntryCard'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（打开链接=client） */
  onAction?: (action: A2UIAction) => void;
};

export function EntryCard({ title, url, sourceRef, nodeId, onAction }: EntryCardProps) {
  return (
    <view
      className="a2ui-card a2ui-grow pressable"
      bindtap={() => onAction?.({ kind: 'client', nodeId: nodeId ?? '', action: 'open_url', payload: { url } })}
    >
      <text className="Text Text--card-title">{title}</text>
      <text className="Text Text--aux ec-url" style={{ color: 'var(--ink-soft)' }}>
        {url}
      </text>
      <SourceCitation sourceRef={sourceRef} />
    </view>
  );
}
