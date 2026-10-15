/**
 * fallback —— 未知组件名 → 纯文本块降级，绝不白屏（UID §四规则2；ARCHITECTURE §1）。
 * 渲染端收到 catalog 外组件名时的唯一出口：组件名 + props 摘要文本化，
 * 不抛错、不空渲染；首屏直出 + 降级兜底永远不留空屏。
 */
import type { A2UIStreamNode } from './stream-parser';

/** 单值摘要：字符串截 60 字，其余 JSON 序列化截 60 字（避免长文本刷屏） */
function summarizeValue(value: unknown): string {
  const text = typeof value === 'string' ? value : safeStringify(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return '[不可序列化]';
  }
}

/** props → "k: v；k: v" 摘要（总长截 200 字） */
export function summarizeProps(props: Record<string, unknown>): string {
  const entries = Object.keys(props).map((key) => `${key}: ${summarizeValue(props[key])}`);
  const joined = entries.join('；');
  return joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;
}

export interface FallbackBlockProps {
  /** 未知组件名（catalog 外） */
  name: string;
  /** 原始 props（文本化展示，保证 Agent 产出内容不静默丢失） */
  props: Record<string, unknown>;
}

export function FallbackBlock({ name, props }: FallbackBlockProps) {
  const summary = summarizeProps(props);
  return (
    <view className="a2ui-fallback a2ui-grow">
      <text className="Text Text--aux" style={{ color: 'var(--ink-soft)' }}>
        {`[未知组件 ${name}，已降级为文本]`}
      </text>
      {summary.length > 0 ? <text className="Text Text--body">{summary}</text> : null}
    </view>
  );
}

/** 便捷构造：直接从流节点降级（surface.tsx 渲染分发用） */
export function FallbackFromNode({ node }: { node: A2UIStreamNode }) {
  return <FallbackBlock name={node.name} props={node.props} />;
}
