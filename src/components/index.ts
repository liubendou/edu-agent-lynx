/**
 * 16 零件 ReactLynx 实现桶导出（catalog 的实现侧；ARCHITECTURE §1/§3）。
 *
 * props 约定：
 *  - 各组件数据字段严格按 CONTRACTS §5 ComponentPropsMap（catalog schema 的实现侧）；
 *  - `nodeId` / `onAction` 是 a2ui/surface.tsx 渲染层注入的运行时通道
 *    （CONTRACTS §5 A2UIAction 回传；kind 语义：作答/判定/下一个=agent，
 *    播停/跳出处/开链接/页面路由=client 本地直处理），不进 catalog JSON Schema。
 *
 * 占位组件：MicButton/TTSBar 视觉与事件就位，语音功能 M6 接（sherpa-onnx）。
 * 触觉（D1）：吸附到位/判定对错两处由 M6 components/haptics.ts 接线。
 */
export { ConceptCard, type ConceptCardProps } from './ConceptCard';
export { QuestionCard, type QuestionCardProps } from './QuestionCard';
export { RevealCard, type RevealCardProps } from './RevealCard';
export { MapView, type MapViewProps } from './MapView';
export { ProgressRing, type ProgressRingProps } from './ProgressRing';
export { ExplainStep, type ExplainStepProps } from './ExplainStep';
export { ChoiceGrid, type ChoiceGridProps } from './ChoiceGrid';
export { MicButton, type MicButtonProps } from './MicButton';
export { TTSBar, type TTSBarProps } from './TTSBar';
export { FeedbackBar, type FeedbackBarProps } from './FeedbackBar';
export { SourceLink, type SourceLinkProps } from './SourceLink';
export { DueChip, type DueChipProps } from './DueChip';
export { TodayPlanPanel, type TodayPlanPanelProps } from './TodayPlanPanel';
export { EntryCard, type EntryCardProps } from './EntryCard';
export { StreamSkeleton, type StreamSkeletonProps } from './StreamSkeleton';
export { SessionEndCard, type SessionEndCardProps } from './SessionEndCard';
export { SourceCitation, type SourceCitationProps } from './primitives/SourceCitation';
