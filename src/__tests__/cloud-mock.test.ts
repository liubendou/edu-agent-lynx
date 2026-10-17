// M2c Mock 测试：无 Key 显式报错（不静默 Mock）、显式 allowMock 走 Mock、四档确定性 JSONL 合法性、流式分块与延迟注入、升级行为。
import { describe, expect, test } from '@rstest/core';
import {
  CloudClientError,
  MOCK_COMPONENT_NAMES,
  MockCloudClient,
  UnconfiguredCloudClient,
  buildMockA2UILines,
  createCloudClient,
} from '../cloud';
import { segments, taskInstruction } from './cloud-fixtures';

export type A2UIMessageLike = {
  surfaceUpdate: { surfaceId: string; components: { name: string; props: Record<string, unknown> }[] };
};

/** 逐行 JSON.parse（A2UI v0.9 JSONL；非法行直接抛错）。 */
export function parseA2UILines(lines: string[]): A2UIMessageLike[] {
  return lines.map((line) => JSON.parse(line) as A2UIMessageLike);
}

const ALL_SKILLS = ['quick-learning', 'review', 'standard-learning', 'deep-learning'] as const;

describe('cloud-mock: 无 Key 显式报错（S1.8 / R-P3，不静默 Mock）', () => {
  test('配置缺失 → createCloudClient 返回 UnconfiguredCloudClient（非 MockCloudClient）', async () => {
    const { client, config } = await createCloudClient({ loadConfigOptions: { read: () => null } });
    expect(config.mock).toBe(true);
    expect(client).toBeInstanceOf(UnconfiguredCloudClient);
    expect(client).not.toBeInstanceOf(MockCloudClient);
  });

  test('UnconfiguredCloudClient：任一方法抛 CloudClientError(code=not_configured, 不可重试/未产出)', async () => {
    const { client } = await createCloudClient({ loadConfigOptions: { read: () => null } });
    const err = await client
      .streamChat({ segments: segments({ taskInstruction: taskInstruction('quick-learning') }) })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(CloudClientError);
    expect((err as CloudClientError).code).toBe('not_configured');
    expect((err as CloudClientError).retryable).toBe(false);
    expect((err as CloudClientError).producedOutput).toBe(false);
    // completeText 同口径
    const err2 = await client.completeText({ prompt: 'x' }).then(() => null, (e: unknown) => e);
    expect(err2).toBeInstanceOf(CloudClientError);
    expect((err2 as CloudClientError).code).toBe('not_configured');
  });

  test('显式 allowMock:true → 仍返回 MockCloudClient（测试 fixture 通道）', async () => {
    const { client } = await createCloudClient({
      loadConfigOptions: { read: () => null },
      allowMock: true,
    });
    expect(client).toBeInstanceOf(MockCloudClient);
  });

  test('有 Key → 返回真实 CloudClient（非 Mock）', async () => {
    const { client, config } = await createCloudClient({
      loadConfigOptions: { read: () => '{"apiKey":"sk-test"}' },
    });
    expect(config.mock).toBe(false);
    expect(client).not.toBeInstanceOf(MockCloudClient);
    expect(client).not.toBeInstanceOf(UnconfiguredCloudClient);
  });
});

describe('cloud-mock: 四档典型流（确定性 + JSONL 合法 + 组件名合法）', () => {
  test.each(ALL_SKILLS)('%s：每行可解析、surfaceId=main、组件名在 16 零件清单内', (skill) => {
    const lines = buildMockA2UILines({ mode: skill, aluIds: ['psy-001', 'psy-002'] });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const messages = parseA2UILines(lines);
    for (const msg of messages) {
      expect(msg.surfaceUpdate.surfaceId).toBe('main');
      for (const comp of msg.surfaceUpdate.components) {
        expect(MOCK_COMPONENT_NAMES).toContain(comp.name);
      }
    }
  });

  test('四档组件构成：quick=MapView+QuestionCard / review=RevealCard+FeedbackBar / standard=ExplainStep+QuestionCard / deep=MapView+ProgressRing+变式QuestionCard', () => {
    const names = (skill: string) =>
      parseA2UILines(buildMockA2UILines({ mode: skill, aluIds: ['psy-001'] }))
        .flatMap((m) => m.surfaceUpdate.components.map((c) => c.name));

    expect(names('quick-learning')).toEqual(expect.arrayContaining(['MapView', 'QuestionCard']));
    expect(names('review')).toEqual(expect.arrayContaining(['RevealCard', 'FeedbackBar']));
    expect(names('standard-learning')).toEqual(expect.arrayContaining(['ExplainStep', 'QuestionCard']));
    const deep = names('deep-learning');
    expect(deep).toEqual(expect.arrayContaining(['MapView', 'ProgressRing', 'QuestionCard']));
    // standard 的 ExplainStep 为四段式（概念→例子→反例→常见坑）
    const standardMessages = parseA2UILines(buildMockA2UILines({ mode: 'standard-learning', aluIds: ['psy-001'] }));
    const explain = standardMessages.flatMap((m) => m.surfaceUpdate.components).find((c) => c.name === 'ExplainStep');
    expect((explain?.props.steps as { title: string }[]).map((s) => s.title)).toEqual(['概念', '例子', '反例', '常见坑']);
    // review 的 FeedbackBar 为三档判定
    const reviewMessages = parseA2UILines(buildMockA2UILines({ mode: 'review', aluIds: ['psy-001'] }));
    const feedback = reviewMessages.flatMap((m) => m.surfaceUpdate.components).find((c) => c.name === 'FeedbackBar');
    expect(feedback?.props.grades).toEqual(['correct', 'fuzzy', 'wrong']);
  });

  test('remediation 按 standard 补讲处理；aluIds 参与派生（变式可寻址）', () => {
    const lines = buildMockA2UILines({ mode: 'remediation', aluIds: ['meta-007'] });
    const messages = parseA2UILines(lines);
    const names = messages.flatMap((m) => m.surfaceUpdate.components.map((c) => c.name));
    expect(names).toContain('ExplainStep');
    const question = messages.flatMap((m) => m.surfaceUpdate.components).find((c) => c.name === 'QuestionCard');
    expect(String(question?.props.variantOfAlu)).toBe('meta-007');
    expect(String(question?.props.question)).toContain('meta-007');
  });

  test('确定性：同输入两次产出字节级全等；空 aluIds 也可产出', () => {
    const a = buildMockA2UILines({ mode: 'deep-learning', aluIds: ['a', 'b'] });
    const b = buildMockA2UILines({ mode: 'deep-learning', aluIds: ['a', 'b'] });
    expect(a).toEqual(b);
    const empty = buildMockA2UILines({ mode: 'quick-learning', aluIds: [] });
    expect(parseA2UILines(empty).length).toBeGreaterThan(0);
  });
});

describe('cloud-mock: MockCloudClient 流式行为', () => {
  test('streamChat 产出与 buildMockA2UILines 全等的 JSONL + 流式分块回调', async () => {
    const client = new MockCloudClient();
    const deltas: string[] = [];
    const result = await client.streamChat({
      segments: segments({ taskInstruction: taskInstruction('standard-learning') }),
      callbacks: { onTextDelta: (t) => deltas.push(t) },
    });
    const expected = buildMockA2UILines({ mode: 'standard-learning', aluIds: ['psy-001', 'psy-002'] });
    expect(result.a2uiLines).toEqual(expected);
    expect(result.modelUsed).toBe('flash');
    expect(result.usage.cacheHit).toBe(true);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    // 流式分块：每行一个 chunk
    expect(deltas).toHaveLength(expected.length);
    expect(deltas.join('')).toBe(`${expected.join('\n')}\n`);
    // 回调里的每一块本身可解析（渐进渲染）
    for (const d of deltas) expect(() => JSON.parse(d.trim())).not.toThrow();
  });

  test('延迟可注入：deep 档 3 行、delayMs=30 → 总耗时 ≥ 60ms', async () => {
    const client = new MockCloudClient({ delayMs: 30 });
    const start = Date.now();
    await client.streamChat({ segments: segments({ taskInstruction: taskInstruction('deep-learning') }) });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(60 - 5); // 2 个块间延迟（容差 5ms）
  });

  test('升级行为：completeText 返回确定性建议（可注入）', async () => {
    const client = new MockCloudClient();
    const a = await client.completeText({ prompt: '卡在: x\n目标: y', modelRole: 'pro' });
    expect(a.text.length).toBeGreaterThan(0);
    expect(a.usage.cacheHit).toBe(false);

    const injected = new MockCloudClient({ completeTextResponse: '建议X' });
    expect((await injected.completeText({ prompt: 'p' })).text).toBe('建议X');
  });
});
