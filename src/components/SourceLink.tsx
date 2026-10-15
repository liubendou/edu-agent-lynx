/**
 * SourceLink —— 全站：点回出处原句（句子级 span；§4.3 100% 可追溯硬门槛落点）。
 * 数据字段严格按 CONTRACTS §5 ComponentPropsMap.SourceLink。
 * 点击 → client Action 'open_source'（本地直处理：跳出处/回链高亮，§7.1 client 响应）。
 */
import type { A2UIAction, ComponentPropsMap } from '../a2ui/catalog';

export type SourceLinkProps = ComponentPropsMap['SourceLink'] & {
  /** 渲染层注入：组件实例 id */
  nodeId?: string;
  /** 渲染层注入：Action 回传（跳出处=client） */
  onAction?: (action: A2UIAction) => void;
};

export function SourceLink({ aluId, sourceRef, label, nodeId, onAction }: SourceLinkProps) {
  const open = () =>
    onAction?.({ kind: 'client', nodeId: nodeId ?? '', action: 'open_source', payload: { aluId, locator: sourceRef.locator } });
  return (
    <view>
      <text className="Text Text--body sl-link pressable" bindtap={open}>
        {label}
      </text>
      <text className="Text Text--aux sl-doc" style={{ color: 'var(--ink-soft)' }}>
        {sourceRef.docTitle}
      </text>
      <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
        {sourceRef.text}
      </text>
    </view>
  );
}
