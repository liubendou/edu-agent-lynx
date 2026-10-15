/**
 * A2UI catalog —— 16 零件产品级全局常量（CONTRACTS §5 唯一接口依据）。
 * M3 2026-10-15。
 *
 * 职责（ARCHITECTURE §3 / §10）：
 *  - ComponentName / ComponentPropsMap / A2UIMessage / A2UIComponentNode / A2UIAction：
 *    与 CONTRACTS §5 逐字一致（16 零件联合类型 + 各组件声明字段）。
 *  - A2UI_CATALOG：16 零件注册表（name + description + propsSchema(JSON Schema)
 *    + clientOnly），全量常驻云侧上下文第③段（PRD §7.2/§7.6：产品级常量、
 *    字节级稳定吃 DeepSeek 硬盘缓存）——serializeCatalog() 是唯一注入形态。
 *  - 技能包只按名引用（skills/packs manifest.components），禁止内嵌目录副本。
 *
 * 字节稳定性纪律（③段吃硬盘缓存的前提，PRD §7.6）：
 *  - 本文件不得出现时间戳 / 随机 id / Date.now() / Math.random() / Map / Set；
 *  - 常量为纯字面量对象（键序即插入序，JSON.stringify 序列化确定）；
 *  - propsSchema 为手写 JSON Schema，字段与 ComponentPropsMap 一一对应，
 *    变更必须同步改接口与 schema（改 catalog = 走 CONTRACTS 变更记录）。
 */
import type { AluId, Grade } from '../domain/types';
import type { SourceRef } from '../domain/alu';

// ── 16 零件名（CONTRACTS §5 联合类型）──────────────────────────────────

export type ComponentName =
  | 'ConceptCard' | 'QuestionCard' | 'RevealCard' | 'MapView' | 'ProgressRing'
  | 'ExplainStep' | 'ChoiceGrid' | 'MicButton' | 'TTSBar' | 'FeedbackBar'
  | 'SourceLink' | 'DueChip' | 'TodayPlanPanel' | 'EntryCard' | 'StreamSkeleton'
  | 'SessionEndCard';

/** 零件名元组（as const 单一事实源；streams.ts/组件注册表均由此派生）。 */
export const COMPONENT_NAMES = [
  'ConceptCard', 'QuestionCard', 'RevealCard', 'MapView', 'ProgressRing',
  'ExplainStep', 'ChoiceGrid', 'MicButton', 'TTSBar', 'FeedbackBar',
  'SourceLink', 'DueChip', 'TodayPlanPanel', 'EntryCard', 'StreamSkeleton',
  'SessionEndCard',
] as const satisfies readonly ComponentName[];

// ── 各组件声明字段（CONTRACTS §5 ComponentPropsMap，逐字一致）──────────

export interface ComponentPropsMap {
  /** 快速/标准：一个定义加出处，能展开（UID §四） */
  ConceptCard: { title: string; definition: string; sourceRef?: SourceRef; expandable?: boolean };
  /** 复习/标准/高质量：正题或变式，等他答（答题类型：自由/选择） */
  QuestionCard: { question: string; variantOfAlu?: AluId; answerType: 'free' | 'choice'; options?: string[] };
  /** 复习/快速：上滑揭晓，答案在背面（UID §5.2"揭晓"） */
  RevealCard: { front: string; back: string };
  /** 快速/高质量/地图页：概念关系图，能拖能点（关系=并列/包含/因果/前置，quick 方法1） */
  MapView: {
    nodes: { id: string; label: string; definition: string }[];
    edges: { from: string; to: string; relation: 'parallel' | 'contains' | 'causal' | 'prereq' }[];
  };
  /** 高质量/成长：掌握度；S 上涨时长一格（§10.2 信号1 落点） */
  ProgressRing: { progress: number; label: string; grewBy?: number };
  /** 标准/高质量：步骤序列，一步步走（四段式：概念→例子→反例→常见坑） */
  ExplainStep: { steps: { title: string; body: string }[]; current: number };
  /** 复习/标准：选项，可单选可多选 */
  ChoiceGrid: { options: string[]; multi?: boolean };
  /** 档4 费曼复述：长按说话（350ms 判定，UID §5.2；首页入口 V1 是文字版不是本组件） */
  MicButton: { hint: string };
  /** 快速/标准/高质量：播/停/倍速/重播（§7.3 TTS 覆盖四档） */
  TTSBar: { playing: boolean; rate: number; durationMs: number };
  /** 复习/标准：对/模糊/错三档；按下反馈先行、判定异步补上（UID §5.4）；判定对错到达时触发触觉（D1） */
  FeedbackBar: { grades: Grade[]; pendingJudge: boolean };
  /** 全站：点回出处原句（句子级 span；§4.3 硬门槛落点） */
  SourceLink: { aluId: AluId; sourceRef: SourceRef; label: string };
  /** 首页："还有几张"，点开就还 */
  DueChip: { count: number };
  /** 回访第一屏：三行端侧算（到期 N / 补讲 X / 建议一条） */
  TodayPlanPanel: { dueCount: number; remediationCount: number; suggestionText: string };
  /** 首页/资料库：资源型条目入口卡，打开即看，不进复习队列（§4.3 两层分流） */
  EntryCard: { title: string; url: string; sourceRef: SourceRef };
  /** 首屏：骨架，必须定高（UID §2.1） */
  StreamSkeleton: { heightPx: number };
  /** 会话尾：收尾"下一个"；给正向峰值不给欠账（§10.2 峰值-终点律） */
  SessionEndCard: { highlight: string; next: string | null };
}

// ── A2UI v0.9 消息（CONTRACTS §5 顶层消息与组件节点，逐字一致）─────────

/** A2UI v0.9 顶层消息（流式块：一行一条，Agent 边推理边发） */
export interface A2UIMessage {
  surfaceUpdate: {
    surfaceId: 'main';                    // V1 单 surface
    components: A2UIComponentNode[];      // 组件树（按 catalog 声明字段）
  };
}

/** 组件节点：name 必须命中 catalog（UID §四规则1：Skill 只能填声明的字段） */
export interface A2UIComponentNode {
  id: string;                 // 组件实例 id（Action 回传引用）
  name: ComponentName;        // 16 零件之一；catalog 外名称 → fallback.tsx 降级纯文本块（UID §四规则2）
  props: ComponentPropsMap[ComponentName];
  children?: A2UIComponentNode[];
}

/** 用户操作回传（A2UI Action，两类；UID/PRD §7.1） */
export type A2UIAction =
  | { kind: 'agent'; nodeId: string; action: string; payload: unknown }  // 影响下一轮生成 → 进 SessionLoop observation
  | { kind: 'client'; nodeId: string; action: string; payload: unknown }; // 本地直处理：TTS 播放/暂停、跳出处、埋点

// ── catalog 注册表（JSON Schema 形态同步给云侧③段）────────────────────

/** catalog 声明项（CONTRACTS §5 CatalogEntry） */
export interface CatalogEntry {
  name: ComponentName;
  description: string;      // 何时上场（UID §四表格一句话）
  propsSchema: Record<string, unknown>;  // JSON Schema（由 props 接口生成）
  clientOnly?: boolean;     // TodayPlanPanel/DueChip/EntryCard/StreamSkeleton 主要由端侧直渲染
}

/** 出处 SourceRef 的 JSON Schema 片段（CONTRACTS §1；三处组件复用，展开内联保持各条目自包含） */
const SOURCE_REF_SCHEMA = {
  type: 'object',
  properties: {
    docId: { type: 'string' },
    docTitle: { type: 'string' },
    locator: {
      oneOf: [
        { type: 'object', properties: { kind: { const: 'span' }, start: { type: 'integer' }, end: { type: 'integer' }, sentenceIndex: { type: 'integer' } }, required: ['kind', 'start', 'end'] },
        { type: 'object', properties: { kind: { const: 'url' }, url: { type: 'string' } }, required: ['kind', 'url'] },
      ],
    },
    text: { type: 'string' },
  },
  required: ['docId', 'docTitle', 'locator', 'text'],
} as const;

/** JSON Schema 条目简写（type:object + properties + required；无额外修饰，保字节稳定） */
function schema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: 'object', properties, required };
}

/** 16 零件注册表（顺序 = COMPONENT_NAMES；description 逐字取 UID §四表格） */
export const A2UI_CATALOG: readonly CatalogEntry[] = [
  {
    name: 'ConceptCard',
    description: '快速/标准：一个定义加出处，能展开',
    propsSchema: schema(
      {
        title: { type: 'string' },
        definition: { type: 'string' },
        sourceRef: SOURCE_REF_SCHEMA,
        expandable: { type: 'boolean' },
      },
      ['title', 'definition'],
    ),
  },
  {
    name: 'QuestionCard',
    description: '复习/标准/高质量：正题或变式，等他答',
    propsSchema: schema(
      {
        question: { type: 'string' },
        variantOfAlu: { type: 'string' },
        answerType: { type: 'string', enum: ['free', 'choice'] },
        options: { type: 'array', items: { type: 'string' } },
      },
      ['question', 'answerType'],
    ),
  },
  {
    name: 'RevealCard',
    description: '复习/快速：上滑揭晓，答案在背面',
    propsSchema: schema({ front: { type: 'string' }, back: { type: 'string' } }, ['front', 'back']),
  },
  {
    name: 'MapView',
    description: '快速/高质量/地图页：概念关系图，能拖能点',
    propsSchema: schema(
      {
        nodes: {
          type: 'array',
          items: schema({ id: { type: 'string' }, label: { type: 'string' }, definition: { type: 'string' } }, ['id', 'label', 'definition']),
        },
        edges: {
          type: 'array',
          items: schema(
            { from: { type: 'string' }, to: { type: 'string' }, relation: { type: 'string', enum: ['parallel', 'contains', 'causal', 'prereq'] } },
            ['from', 'to', 'relation'],
          ),
        },
      },
      ['nodes', 'edges'],
    ),
  },
  {
    name: 'ProgressRing',
    description: '高质量/成长：掌握度；S 上涨时长一格',
    propsSchema: schema(
      { progress: { type: 'number', minimum: 0, maximum: 1 }, label: { type: 'string' }, grewBy: { type: 'number' } },
      ['progress', 'label'],
    ),
  },
  {
    name: 'ExplainStep',
    description: '标准/高质量：步骤序列，一步步走（四段式：概念→例子→反例→常见坑）',
    propsSchema: schema(
      {
        steps: { type: 'array', items: schema({ title: { type: 'string' }, body: { type: 'string' } }, ['title', 'body']) },
        current: { type: 'integer', minimum: 0 },
      },
      ['steps', 'current'],
    ),
  },
  {
    name: 'ChoiceGrid',
    description: '复习/标准：选项，可单选可多选',
    propsSchema: schema(
      { options: { type: 'array', items: { type: 'string' } }, multi: { type: 'boolean' } },
      ['options'],
    ),
  },
  {
    name: 'MicButton',
    description: '档4 费曼复述：长按说话（首页入口 V1 是文字版不是本零件）',
    propsSchema: schema({ hint: { type: 'string' } }, ['hint']),
  },
  {
    name: 'TTSBar',
    description: '快速/标准/高质量：播、停、倍速、重播（§7.3 TTS 覆盖四档）',
    propsSchema: schema(
      { playing: { type: 'boolean' }, rate: { type: 'number' }, durationMs: { type: 'integer' } },
      ['playing', 'rate', 'durationMs'],
    ),
  },
  {
    name: 'FeedbackBar',
    description: '复习/标准：对/模糊/错，三档；按下反馈先行，判定异步补上',
    propsSchema: schema(
      { grades: { type: 'array', items: { type: 'string', enum: ['correct', 'fuzzy', 'wrong'] } }, pendingJudge: { type: 'boolean' } },
      ['grades', 'pendingJudge'],
    ),
  },
  {
    name: 'SourceLink',
    description: '全站：点回出处原句（句子级 span）；§4.3 可追溯硬门槛落点',
    propsSchema: schema(
      { aluId: { type: 'string' }, sourceRef: SOURCE_REF_SCHEMA, label: { type: 'string' } },
      ['aluId', 'sourceRef', 'label'],
    ),
  },
  {
    name: 'DueChip',
    description: '首页："还有几张"，点开就还',
    propsSchema: schema({ count: { type: 'integer', minimum: 0 } }, ['count']),
    clientOnly: true,
  },
  {
    name: 'TodayPlanPanel',
    description: '回访第一屏：三行端侧算（到期 N 张 / 待补讲 X 张 / 今天建议学的一条）',
    propsSchema: schema(
      { dueCount: { type: 'integer', minimum: 0 }, remediationCount: { type: 'integer', minimum: 0 }, suggestionText: { type: 'string' } },
      ['dueCount', 'remediationCount', 'suggestionText'],
    ),
    clientOnly: true,
  },
  {
    name: 'EntryCard',
    description: '首页/资料库：资源型条目入口卡，打开即看，不进复习队列',
    propsSchema: schema(
      { title: { type: 'string' }, url: { type: 'string' }, sourceRef: SOURCE_REF_SCHEMA },
      ['title', 'url', 'sourceRef'],
    ),
    clientOnly: true,
  },
  {
    name: 'StreamSkeleton',
    description: '首屏：骨架，必须定高',
    propsSchema: schema({ heightPx: { type: 'integer', minimum: 0 } }, ['heightPx']),
    clientOnly: true,
  },
  {
    name: 'SessionEndCard',
    description: '会话尾：收尾，"下一个"；给正向峰值不给欠账',
    propsSchema: schema(
      { highlight: { type: 'string' }, next: { type: ['string', 'null'] } },
      ['highlight', 'next'],
    ),
  },
];

/**
 * ③段注入形态（PRD §7.6/§7.7：产品级常量、跨所有用户/所有档字节级不变）。
 * 固定 JSON.stringify（数组字面量键序确定）；无时间戳/随机 id/Map/Set，
 * 同进程多次序列化字节全等（字节稳定性用例见 __tests__/a2ui-catalog.test.ts）。
 */
export function serializeCatalog(): string {
  return JSON.stringify(A2UI_CATALOG);
}
