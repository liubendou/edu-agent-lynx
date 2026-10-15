// M3 A2UI 流式解析测试：分块到达/渐进合并/乱序容错/非法行容错/机器行跳过/流中断/Emitter 适配。
import { describe, expect, test } from '@rstest/core';
import { A2UIStreamEmitter, A2UIStreamParser } from '../a2ui/stream-parser';
import { buildMockA2UILines } from '../cloud/mock/streams';

function line(components: unknown[]): string {
  return JSON.stringify({ surfaceUpdate: { surfaceId: 'main', components } });
}

function conceptNode(id: string, title: string): unknown {
  return { id, name: 'ConceptCard', props: { title, definition: `${title} 的定义` } };
}

describe('a2ui-stream-parser: 完整行解析与渐进合并', () => {
  test('单条 surfaceUpdate → 组件树入快照；revision/surfaceId 正确', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${line([conceptNode('c1', '信度'), conceptNode('c2', '效度')])}\n`);
    const snap = parser.getSnapshot();
    expect(snap.surfaceId).toBe('main');
    expect(snap.components.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(snap.components[0]!.props).toMatchObject({ title: '信度' });
    expect(snap.revision).toBe(1);
    expect(snap.errors).toEqual([]);
    expect(snap.pendingChars).toBe(0);
  });

  test('渐进渲染：第一条到达即可渲染，不整屏等待', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${line([conceptNode('c1', '信度')])}\n`);
    expect(parser.getSnapshot().components).toHaveLength(1);
    parser.feed(`${line([conceptNode('c2', '效度')])}\n`);
    expect(parser.getSnapshot().components).toHaveLength(2);
    expect(parser.getSnapshot().revision).toBe(2);
  });

  test('同 id 组件再次到达 → 原位替换（更新语义），首次插入序稳定', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${line([conceptNode('c1', '旧标题'), conceptNode('c2', '效度')])}\n`);
    parser.feed(`${line([conceptNode('c1', '新标题')])}\n`);
    const snap = parser.getSnapshot();
    expect(snap.components).toHaveLength(2);
    expect(snap.components.map((c) => c.id)).toEqual(['c1', 'c2']); // 插入序不变
    expect(snap.components[0]!.props).toMatchObject({ title: '新标题' }); // 原位替换
    expect(snap.revision).toBe(2);
  });

  test('嵌套 children 保留；非法子节点剔除且不伤兄弟', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${line([
      {
        id: 'parent',
        name: 'ConceptCard',
        props: { title: '父', definition: 'd' },
        children: [
          { id: 'child-ok', name: 'SourceLink', props: { label: 'l', aluId: 'a', sourceRef: {} } },
          { name: 'NoId', props: {} }, // 缺 id → 剔除
          'garbage', // 非对象 → 剔除
        ],
      },
    ])}\n`);
    const snap = parser.getSnapshot();
    expect(snap.components).toHaveLength(1);
    expect(snap.components[0]!.children!.map((c) => c.id)).toEqual(['child-ok']);
    expect(snap.errors.length).toBe(2);
  });
});

describe('a2ui-stream-parser: 分块到达与流中断', () => {
  test('分块切在行中间 → 残余留 buffer 不误解析；补齐后立即成行', () => {
    const parser = new A2UIStreamParser();
    const full = `${line([conceptNode('c1', '信度')])}\n`;
    const cut = Math.floor(full.length / 2);
    parser.feed(full.slice(0, cut));
    let snap = parser.getSnapshot();
    expect(snap.components).toHaveLength(0);
    expect(snap.errors).toHaveLength(0);
    expect(snap.pendingChars).toBe(cut);
    parser.feed(full.slice(cut));
    snap = parser.getSnapshot();
    expect(snap.components).toHaveLength(1);
    expect(snap.pendingChars).toBe(0);
  });

  test('中途流中断：flush 明确记错并丢弃残片，已完整组件仍可渲染', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${line([conceptNode('c1', '信度')])}\n{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"x"`);
    expect(parser.getSnapshot().pendingChars).toBeGreaterThan(0); // 中断痕迹在 flush 前可见
    parser.flush();
    const snap = parser.getSnapshot();
    expect(snap.components.map((c) => c.id)).toEqual(['c1']); // 渐进渲染不受影响
    expect(snap.errors.length).toBe(1);
    expect(snap.errors[0]).toContain('流中断');
    expect(snap.pendingChars).toBe(0); // 残片已收尾（丢弃），surface 干净
  });

  test('流正常收尾但末行无换行符：flush 吸收完整尾行、无中断痕迹', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${line([conceptNode('c1', '信度')])}\n${line([conceptNode('c2', '效度')])}`);
    expect(parser.getSnapshot().components).toHaveLength(1); // 尾行 flush 前不误解析
    parser.flush();
    const snap = parser.getSnapshot();
    expect(snap.components).toHaveLength(2);
    expect(snap.errors).toEqual([]);
    expect(snap.pendingChars).toBe(0);
  });

  test('flush 空转（无残余）不产生错误', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${line([conceptNode('c1', '信度')])}\n`);
    parser.flush();
    expect(parser.getSnapshot().errors).toEqual([]);
  });
});

describe('a2ui-stream-parser: 容错（坏行不断流、机器行跳过、未知组件保留）', () => {
  test('非法 JSON 行记错跳过，后续行继续解析', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`not-json-at-all\n${line([conceptNode('c1', '信度')])}\n`);
    const snap = parser.getSnapshot();
    expect(snap.errors).toHaveLength(1);
    expect(snap.components).toHaveLength(1); // 容错：一条坏行不断整流
    expect(snap.revision).toBe(1);
  });

  test('机器行（tts/tool_call）跳过计数，不进组件树', () => {
    const parser = new A2UIStreamParser();
    parser.feed([
      JSON.stringify({ tts: { text: '你好' } }),
      JSON.stringify({ tool_call: { name: 'web_search', args: {} } }),
      line([conceptNode('c1', '信度')]),
      '',
    ].join('\n'));
    const snap = parser.getSnapshot();
    expect(snap.skippedMachineLines).toBe(2);
    expect(snap.components).toHaveLength(1);
    expect(snap.revision).toBe(1);
  });

  test('非 surfaceUpdate 消息记错跳过', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${JSON.stringify({ other: true })}\n${line([conceptNode('c1', '信度')])}\n`);
    const snap = parser.getSnapshot();
    expect(snap.errors).toHaveLength(1);
    expect(snap.components).toHaveLength(1);
  });

  test('catalog 外组件名保留节点（渲染端降级，解析层不丢弃）', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`${line([{ id: 'f1', name: 'FutureWidget', props: { x: 1 } }])}\n`);
    const snap = parser.getSnapshot();
    expect(snap.components[0]!.name).toBe('FutureWidget');
    expect(snap.errors).toEqual([]);
  });

  test('mock 四档全流可被解析器吸收（端到端形状）', () => {
    for (const mode of ['quick-learning', 'review', 'standard-learning', 'deep-learning'] as const) {
      const parser = new A2UIStreamParser();
      parser.feed(`${buildMockA2UILines({ mode, aluIds: ['psy-001'] }).join('\n')}\n`);
      const snap = parser.getSnapshot();
      expect(snap.errors).toEqual([]);
      expect(snap.components.length).toBeGreaterThanOrEqual(2);
      expect(snap.skippedMachineLines).toBe(0);
    }
  });
});

describe('a2ui-stream-parser: 状态与订阅', () => {
  test('reset 清空全部状态', () => {
    const parser = new A2UIStreamParser();
    parser.feed(`bad\n${line([conceptNode('c1', '信度')])}\n`);
    parser.reset();
    const snap = parser.getSnapshot();
    expect(snap.components).toHaveLength(0);
    expect(snap.errors).toEqual([]);
    expect(snap.revision).toBe(0);
  });

  test('feed/flush 触发订阅回调（React 渐进渲染通道）', () => {
    const parser = new A2UIStreamParser();
    let notified = 0;
    const unsubscribe = parser.subscribe(() => {
      notified += 1;
    });
    parser.feed(`${line([conceptNode('c1', '信度')])}\n`);
    parser.flush();
    unsubscribe();
    parser.feed(`${line([conceptNode('c2', '效度')])}\n`);
    expect(notified).toBe(2); // 退订后不再通知
  });

  test('A2UIStreamEmitter 满足 A2UiEmitterPort 语义（emit→feed、flush→flush）', () => {
    const parser = new A2UIStreamParser();
    const emitter = new A2UIStreamEmitter(parser);
    const lines = buildMockA2UILines({ mode: 'review', aluIds: ['psy-001'] });
    emitter.emit(`${lines[0]}\n`);
    emitter.emit(lines[1]!); // 末行无换行符：emit 不误解析，flush 前是残余
    expect(parser.getSnapshot().components).toHaveLength(1);
    emitter.flush();
    const snap = parser.getSnapshot();
    expect(snap.components).toHaveLength(2);
    expect(snap.errors).toEqual([]); // 换行结尾的完整流 flush 无中断痕迹
  });
});
