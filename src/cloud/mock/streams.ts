/**
 * Mock A2UI 消息流（M2c，无 Key 模式；CONTRACTS §5 A2UI v0.9）。
 * 按当前 Skill 模板与任务指令产出确定性的合法 A2UI JSONL（每行一个完整
 * surfaceUpdate 消息）；四档各有典型流：
 *  quick=MapView骨架+QuestionCard自检 / review=RevealCard+FeedbackBar /
 *  standard=ExplainStep四段式+QuestionCard / deep=MapView+ProgressRing+变式QuestionCard。
 * 确定性：无随机、无时间戳——同输入字节级相等（可测）。
 */
import { COMPONENT_NAMES, type ComponentName } from '../../a2ui/catalog';

/** 16 零件清单（CONTRACTS §5；M3 起由 a2ui/catalog.ts 单一事实源派生）。 */
export const MOCK_COMPONENT_NAMES = COMPONENT_NAMES;

export type MockComponentName = ComponentName;

export interface MockComponentNode {
  id: string;
  name: MockComponentName;
  props: Record<string, unknown>;
}

export interface MockA2UIMessage {
  surfaceUpdate: {
    surfaceId: 'main';
    components: MockComponentNode[];
  };
}

export interface MockStreamInput {
  mode: string;   // TaskInstruction.mode（remediation 按 standard 补讲处理）
  aluIds: string[];
}

function firstAlu(aluIds: string[]): string {
  return aluIds[0] ?? 'alu-0';
}

function line(components: MockComponentNode[]): string {
  const message: MockA2UIMessage = { surfaceUpdate: { surfaceId: 'main', components } };
  return JSON.stringify(message);
}

function mapNode(alu: string) {
  return { id: `map-${alu}`, label: alu, definition: `${alu} 的核心定义（出处回链见 SourceLink）` };
}

/** quick 档：MapView 骨架 + QuestionCard 自检。 */
function quickLines(aluIds: string[]): string[] {
  const alu = firstAlu(aluIds);
  const others = aluIds.slice(1, 3).map((id) => mapNode(id));
  return [
    line([{
      id: 'mock-quick-map',
      name: 'MapView',
      props: {
        nodes: [mapNode(alu), ...others],
        edges: others.map((n) => ({ from: `map-${alu}`, to: n.id, relation: 'prereq' as const })),
      },
    }]),
    line([{
      id: 'mock-quick-check',
      name: 'QuestionCard',
      props: { question: `用自己的话说：${alu} 的定义是什么？`, variantOfAlu: alu, answerType: 'free' },
    }]),
  ];
}

/** review 档：RevealCard（上滑揭晓）+ FeedbackBar（三档判定）。 */
function reviewLines(aluIds: string[]): string[] {
  const alu = firstAlu(aluIds);
  return [
    line([{
      id: `mock-review-reveal-${alu}`,
      name: 'RevealCard',
      props: { front: `${alu}：正题是什么？`, back: `${alu} 的背面判据（出处原句回链）` },
    }]),
    line([{
      id: 'mock-review-feedback',
      name: 'FeedbackBar',
      props: { grades: ['correct', 'fuzzy', 'wrong'], pendingJudge: true },
    }]),
  ];
}

/** standard 档：ExplainStep 四段式（概念→例子→反例→常见坑）+ QuestionCard。 */
function standardLines(aluIds: string[]): string[] {
  const alu = firstAlu(aluIds);
  return [
    line([{
      id: `mock-standard-steps-${alu}`,
      name: 'ExplainStep',
      props: {
        steps: [
          { title: '概念', body: `${alu} 是什么：定义与边界` },
          { title: '例子', body: `${alu} 的一个具体例子` },
          { title: '反例', body: `容易和 ${alu} 混淆的反例` },
          { title: '常见坑', body: `用 ${alu} 时最常见的错误` },
        ],
        current: 0,
      },
    }]),
    line([{
      id: `mock-standard-check-${alu}`,
      name: 'QuestionCard',
      props: { question: `检验一下：${alu} 的判据是什么？`, variantOfAlu: alu, answerType: 'free' },
    }]),
  ];
}

/** deep 档：MapView + ProgressRing + 变式 QuestionCard。 */
function deepLines(aluIds: string[]): string[] {
  const alu = firstAlu(aluIds);
  const rest = aluIds.slice(1, 3).map((id) => mapNode(id));
  return [
    line([{
      id: `mock-deep-map-${alu}`,
      name: 'MapView',
      props: {
        nodes: [mapNode(alu), ...rest],
        edges: rest.map((n) => ({ from: `map-${alu}`, to: n.id, relation: 'contains' as const })),
      },
    }]),
    line([{
      id: `mock-deep-progress-${alu}`,
      name: 'ProgressRing',
      props: { progress: 0.4, label: `${alu} 掌握度`, grewBy: 0.1 },
    }]),
    line([{
      id: `mock-deep-variant-${alu}`,
      name: 'QuestionCard',
      props: { question: `换个问法：在什么情况下 ${alu} 不成立？`, variantOfAlu: alu, answerType: 'free' },
    }]),
  ];
}

/** 四档典型流入口（确定性：同 mode+aluIds 字节级相等）。remediation 按 standard 补讲。 */
export function buildMockA2UILines(input: MockStreamInput): string[] {
  const aluIds = input.aluIds;
  switch (input.mode) {
    case 'quick-learning':
      return quickLines(aluIds);
    case 'review':
      return reviewLines(aluIds);
    case 'deep-learning':
      return deepLines(aluIds);
    case 'standard-learning':
    case 'remediation':
    default:
      return standardLines(aluIds);
  }
}
