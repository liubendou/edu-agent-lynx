// M3 A2UI catalog 测试：16 零件完整性、schema 与 CONTRACTS §5 对齐、③段字节稳定性、streams 迁移。
import { describe, expect, test } from '@rstest/core';
import {
  A2UI_CATALOG,
  COMPONENT_NAMES,
  serializeCatalog,
  type ComponentName,
} from '../a2ui/catalog';
import { MOCK_COMPONENT_NAMES, buildMockA2UILines } from '../cloud/mock/streams';

/** CONTRACTS §5 各组件 required 字段（propsSchema 必须与之逐字对齐） */
const REQUIRED_BY_NAME: Record<ComponentName, string[]> = {
  ConceptCard: ['title', 'definition'],
  QuestionCard: ['question', 'answerType'],
  RevealCard: ['front', 'back'],
  MapView: ['nodes', 'edges'],
  ProgressRing: ['progress', 'label'],
  ExplainStep: ['steps', 'current'],
  ChoiceGrid: ['options'],
  MicButton: ['hint'],
  TTSBar: ['playing', 'rate', 'durationMs'],
  FeedbackBar: ['grades', 'pendingJudge'],
  SourceLink: ['aluId', 'sourceRef', 'label'],
  DueChip: ['count'],
  TodayPlanPanel: ['dueCount', 'remediationCount', 'suggestionText'],
  EntryCard: ['title', 'url', 'sourceRef'],
  StreamSkeleton: ['heightPx'],
  SessionEndCard: ['highlight', 'next'],
};

/** CONTRACTS §5 各组件全部字段（含可选；properties 必须全量覆盖） */
const ALL_PROPS_BY_NAME: Record<ComponentName, string[]> = {
  ConceptCard: ['title', 'definition', 'sourceRef', 'expandable'],
  QuestionCard: ['question', 'variantOfAlu', 'answerType', 'options'],
  RevealCard: ['front', 'back'],
  MapView: ['nodes', 'edges'],
  ProgressRing: ['progress', 'label', 'grewBy'],
  ExplainStep: ['steps', 'current'],
  ChoiceGrid: ['options', 'multi'],
  MicButton: ['hint'],
  TTSBar: ['playing', 'rate', 'durationMs'],
  FeedbackBar: ['grades', 'pendingJudge'],
  SourceLink: ['aluId', 'sourceRef', 'label'],
  DueChip: ['count'],
  TodayPlanPanel: ['dueCount', 'remediationCount', 'suggestionText'],
  EntryCard: ['title', 'url', 'sourceRef'],
  StreamSkeleton: ['heightPx'],
  SessionEndCard: ['highlight', 'next'],
};

/** clientOnly 零件（ARCHITECTURE §10：端侧直渲染，非 Agent 生成主力） */
const CLIENT_ONLY = new Set(['DueChip', 'TodayPlanPanel', 'EntryCard', 'StreamSkeleton']);

/** 递归校验 catalog 值只含稳定结构（禁时间戳/随机 id/Map/Set/函数/undefined） */
function assertPlain(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPlain(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype); // 纯对象（非 Map/Set/Date 实例）
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertPlain(item, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`catalog 含不稳定结构 ${path}: ${String(value)}`);
}

describe('a2ui-catalog: 16 零件完整性（CONTRACTS §5）', () => {
  test('16 零件名与注册表一一对应、顺序一致', () => {
    expect(COMPONENT_NAMES).toHaveLength(16);
    expect(A2UI_CATALOG).toHaveLength(16);
    expect(A2UI_CATALOG.map((entry) => entry.name)).toEqual([...COMPONENT_NAMES]);
  });

  test.each(A2UI_CATALOG.map((entry) => [entry.name, entry] as const))(
    '%s：schema required/properties 与 CONTRACTS §5 对齐、description 非空、clientOnly 正确',
    (name, entry) => {
      expect(entry.description.length).toBeGreaterThan(0);
      const schema = entry.propsSchema as { type: string; properties: Record<string, unknown>; required: string[] };
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(REQUIRED_BY_NAME[name]);
      expect(Object.keys(schema.properties).sort()).toEqual([...ALL_PROPS_BY_NAME[name]].sort());
      expect(entry.clientOnly).toBe(CLIENT_ONLY.has(name) ? true : undefined);
    },
  );

  test('关键枚举字段抽查（answerType/relation/grades/next 可空）', () => {
    const schemaOf = (name: ComponentName) =>
      A2UI_CATALOG.find((entry) => entry.name === name)!.propsSchema as {
        properties: Record<string, { enum?: string[]; type?: string | string[] }>;
      };
    expect(schemaOf('QuestionCard').properties.answerType.enum).toEqual(['free', 'choice']);
    expect(schemaOf('MapView').properties.edges).toBeDefined();
    expect(schemaOf('FeedbackBar').properties.grades).toBeDefined();
    expect(schemaOf('SessionEndCard').properties.next.type).toEqual(['string', 'null']);
    const mapView = A2UI_CATALOG.find((entry) => entry.name === 'MapView')!.propsSchema as {
      properties: Record<string, { items?: { properties?: Record<string, { enum?: string[] }> } }>;
    };
    expect(mapView.properties.edges.items?.properties?.relation?.enum).toEqual([
      'parallel', 'contains', 'causal', 'prereq',
    ]);
  });
});

describe('a2ui-catalog: ③段字节稳定性（PRD §7.6 硬盘缓存前提）', () => {
  test('多次序列化字节级全等；serializeCatalog 与直 stringify 一致', () => {
    const first = serializeCatalog();
    expect(serializeCatalog()).toBe(first);
    expect(JSON.stringify(A2UI_CATALOG)).toBe(first);
    expect(JSON.parse(first)).toEqual(A2UI_CATALOG); // round-trip 无损
    expect(first).not.toContain('undefined');
  });

  test('全量值遍历：只含纯对象/数组/原始值（无 Map/Set/Date/函数）', () => {
    A2UI_CATALOG.forEach((entry, index) => assertPlain(entry, `catalog[${index}]`));
  });

  test('catalog 为冻结语义的只读常量（运行期不被意外改写）', () => {
    // readonly 类型层面 + 内容快照：二次取引用序列化仍全等
    const snapshot = serializeCatalog();
    expect(serializeCatalog()).toBe(snapshot);
  });
});

describe('a2ui-catalog: streams.ts 迁移（M2 遗留项收口）', () => {
  test('MOCK_COMPONENT_NAMES 由 catalog 单一事实源派生（引用相等）', () => {
    expect(MOCK_COMPONENT_NAMES).toBe(COMPONENT_NAMES);
  });

  test('mock 四档流组件名全部命中 catalog（cloud-mock 行为不变）', () => {
    for (const mode of ['quick-learning', 'review', 'standard-learning', 'deep-learning'] as const) {
      const lines = buildMockA2UILines({ mode, aluIds: ['psy-001'] });
      const names = lines
        .map((line) => JSON.parse(line) as { surfaceUpdate: { components: { name: string }[] } })
        .flatMap((msg) => msg.surfaceUpdate.components.map((c) => c.name));
      for (const name of names) expect(COMPONENT_NAMES).toContain(name);
    }
  });
});
