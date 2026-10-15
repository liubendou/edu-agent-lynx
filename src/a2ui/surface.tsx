/**
 * surface —— A2UISurface 渲染宿主（ARCHITECTURE §1；M4 Session.tsx 可嵌入）。
 * M3 2026-10-15。T1 Spike 裁决：自研轻量 renderer（裁决依据见 stream-parser.ts 头注），
 * 协议形状仍为 CONTRACTS §5 的 A2UI v0.9 投影（surfaceUpdate.components[]）。
 *
 * 职责：
 *  - useA2UIStream(parser)：订阅 A2UIStreamParser 快照（渐进渲染：每吸收一条
 *    surfaceUpdate 即更新，已完整组件先渲染，不整屏等待——PRD §7.1）；
 *  - A2UISurface({state, onAction})：组件树 → 16 零件 ReactLynx 组件分发，
 *    catalog 外名称 → FallbackBlock 降级纯文本（UID §四规则2，绝不白屏）；
 *  - Action 回传：组件经注入的 onAction 上抛（CONTRACTS §5 A2UIAction 两类，
 *    agent 进 SessionLoop observation / client 本地直处理——由宿主路由）。
 *
 * 动效：生长入场（.a2ui-grow，180ms）；stagger 40ms×6 条由 M4 首屏流编排
 * （UID §八：stagger 只对首 6 条生效），本组件不预做。
 */
import { useEffect, useState, type ComponentType, type ReactNode } from '@lynx-js/react';
import type { A2UIAction } from './catalog';
import type { A2UIStreamNode, A2UISurfaceSnapshot } from './stream-parser';
import type { A2UIStreamParser } from './stream-parser';
import { FallbackBlock } from './fallback';
import {
  ConceptCard, QuestionCard, RevealCard, MapView, ProgressRing,
  ExplainStep, ChoiceGrid, MicButton, TTSBar, FeedbackBar,
  SourceLink, DueChip, TodayPlanPanel, EntryCard, StreamSkeleton, SessionEndCard,
} from '../components';

import '../design-system/tokens.css';
import '../design-system/typography.css';
import '../design-system/motion.css';
import '../components/components.css';

/** 渲染层注入组件的运行时通道（不进 catalog JSON Schema，见 components/index.ts） */
export type A2UIRuntimeProps = {
  nodeId?: string;
  onAction?: (action: A2UIAction) => void;
  children?: ReactNode; // 协议节点的嵌套 children（CONTRACTS §5；当前 16 零件均为叶子渲染）
};

/** 16 零件注册表（渲染侧 catalog 实现；键 = ComponentName） */
export const A2UI_COMPONENT_REGISTRY: Record<string, ComponentType<A2UIRuntimeProps>> = {
  ConceptCard: ConceptCard as ComponentType<A2UIRuntimeProps>,
  QuestionCard: QuestionCard as ComponentType<A2UIRuntimeProps>,
  RevealCard: RevealCard as ComponentType<A2UIRuntimeProps>,
  MapView: MapView as ComponentType<A2UIRuntimeProps>,
  ProgressRing: ProgressRing as ComponentType<A2UIRuntimeProps>,
  ExplainStep: ExplainStep as ComponentType<A2UIRuntimeProps>,
  ChoiceGrid: ChoiceGrid as ComponentType<A2UIRuntimeProps>,
  MicButton: MicButton as ComponentType<A2UIRuntimeProps>,
  TTSBar: TTSBar as ComponentType<A2UIRuntimeProps>,
  FeedbackBar: FeedbackBar as ComponentType<A2UIRuntimeProps>,
  SourceLink: SourceLink as ComponentType<A2UIRuntimeProps>,
  DueChip: DueChip as ComponentType<A2UIRuntimeProps>,
  TodayPlanPanel: TodayPlanPanel as ComponentType<A2UIRuntimeProps>,
  EntryCard: EntryCard as ComponentType<A2UIRuntimeProps>,
  StreamSkeleton: StreamSkeleton as ComponentType<A2UIRuntimeProps>,
  SessionEndCard: SessionEndCard as ComponentType<A2UIRuntimeProps>,
};

/** 订阅流解析器 → surface 快照（React 侧；配合 <A2UISurface state={...}/>） */
export function useA2UIStream(parser: A2UIStreamParser): A2UISurfaceSnapshot {
  const [snapshot, setSnapshot] = useState<A2UISurfaceSnapshot>(() => parser.getSnapshot());
  useEffect(() => {
    setSnapshot(parser.getSnapshot());
    return parser.subscribe(() => setSnapshot(parser.getSnapshot()));
  }, [parser]);
  return snapshot;
}

function renderNode(
  node: A2UIStreamNode,
  key: string,
  onAction: ((action: A2UIAction) => void) | undefined,
  depth: number,
): ReactNode {
  if (depth > 16) return <FallbackBlock name={node.name} props={{ _depth: '组件树超深，已降级' }} />;
  const Component = A2UI_COMPONENT_REGISTRY[node.name];
  if (Component === undefined) {
    return <FallbackBlock key={key} name={node.name} props={node.props} />; // UID §四规则2：降级不白屏
  }
  const children = node.children?.map((child, index) =>
    renderNode(child, `${key}/${child.id || index}`, onAction, depth + 1),
  );
  return (
    <Component key={key} {...node.props} nodeId={node.id} onAction={onAction}>
      {children}
    </Component>
  );
}

export interface A2UISurfaceProps {
  /** surface 快照（useA2UIStream 产出；受控渲染，本组件不持有解析状态） */
  state: A2UISurfaceSnapshot;
  /** Action 回传（两类路由由宿主决定：agent → orchestrator / client → 本地） */
  onAction?: (action: A2UIAction) => void;
  /** 宿主追加 className（M4 Session.tsx 布局用） */
  className?: string;
}

/** A2UI v0.9 渲染宿主：组件树渐进渲染入口 */
export function A2UISurface({ state, onAction, className }: A2UISurfaceProps) {
  return (
    <view className={className !== undefined ? `a2ui-surface ${className}` : 'a2ui-surface'}>
      {state.components.map((node, index) =>
        renderNode(node, node.id || `idx-${index}`, onAction, 0),
      )}
    </view>
  );
}
