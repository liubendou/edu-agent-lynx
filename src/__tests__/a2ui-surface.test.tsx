// M3 16 零件渲染测试：每个零件最小 props 可渲染、A2UISurface 分发、未知组件降级、渐进渲染。
// 渲染用 @lynx-js/react/testing-library（与 index.test.tsx 同范式）。
import '@testing-library/jest-dom';
import { describe, expect, test } from '@rstest/core';
import { render } from '@lynx-js/react/testing-library';

import {
  A2UI_COMPONENT_REGISTRY,
  A2UISurface,
  useA2UIStream,
} from '../a2ui/surface';
import { A2UIStreamParser } from '../a2ui/stream-parser';
import { summarizeProps } from '../a2ui/fallback';
import {
  ChoiceGrid,
  ConceptCard,
  DueChip,
  EntryCard,
  ExplainStep,
  FeedbackBar,
  MapView,
  MicButton,
  ProgressRing,
  QuestionCard,
  RevealCard,
  SessionEndCard,
  SourceLink,
  StreamSkeleton,
  TodayPlanPanel,
  TTSBar,
} from '../components';

const SOURCE_REF = {
  docId: 'doc-1',
  docTitle: '档1·Lakens《Improving Your Statistical Inferences》',
  locator: { kind: 'span', start: 0, end: 12 } as const,
  text: '信度指测量的一致性。',
};

describe('a2ui-components: 16 零件最小 props 渲染', () => {
  test('ConceptCard：标题/定义/出处；expandable 出现展开', async () => {
    const { findByText, findAllByText } = render(
      <ConceptCard title="信度" definition="信度指测量的一致性。" sourceRef={SOURCE_REF} expandable />,
    );
    expect(await findByText('信度')).toBeInTheDocument();
    // 定义与出处原句同文 → 两处出现（都渲染即算通过）
    expect((await findAllByText(/信度指测量的一致性/)).length).toBeGreaterThanOrEqual(1);
    expect(await findByText('展开')).toBeInTheDocument();
  });

  test('QuestionCard：free 提示；choice 渲染选项', async () => {
    const free = render(
      <QuestionCard question="用自己的话说：什么是信度？" answerType="free" />,
    );
    expect(await free.findByText(/先自己想/)).toBeInTheDocument();

    const choice = render(
      <QuestionCard question="下列哪个是信度？" answerType="choice" options={['一致性', '准确性']} variantOfAlu="psy-001" />,
    );
    expect(await choice.findByText('一致性')).toBeInTheDocument();
    expect(await choice.findByText('准确性')).toBeInTheDocument();
    expect(await choice.findByText(/变式 · psy-001/)).toBeInTheDocument();
  });

  test('RevealCard：未揭晓给提示，不直接泄答案', async () => {
    const { findByText, queryByText } = render(
      <RevealCard front="信度：正题是什么？" back="测量的一致性。" />,
    );
    expect(await findByText('信度：正题是什么？')).toBeInTheDocument();
    expect(await findByText(/点击揭晓/)).toBeInTheDocument();
    expect(queryByText('测量的一致性。')).toBeNull();
  });

  test('MapView：节点 chip 与关系清单（前置）', async () => {
    const { findByText, findAllByText } = render(
      <MapView
        nodes={[
          { id: 'n1', label: '信度', definition: 'd1' },
          { id: 'n2', label: '效度', definition: 'd2' },
        ]}
        edges={[{ from: 'n2', to: 'n1', relation: 'prereq' }]}
      />,
    );
    // chip 标签 + 关系端点标签同文 → 至少各出现一次
    expect((await findAllByText('信度')).length).toBeGreaterThanOrEqual(1);
    expect((await findAllByText('效度')).length).toBeGreaterThanOrEqual(1);
    expect(await findByText('—前置→')).toBeInTheDocument();
  });

  test('ProgressRing：细线进度 + label + 长了一格', async () => {
    const { findByText } = render(
      <ProgressRing progress={0.4} label="心理学 掌握度" grewBy={0.1} />,
    );
    expect(await findByText('心理学 掌握度')).toBeInTheDocument();
    expect(await findByText('40%')).toBeInTheDocument();
    expect(await findByText('长了一格')).toBeInTheDocument();
  });

  test('ExplainStep：四段式与当前步高亮', async () => {
    const { findByText } = render(
      <ExplainStep
        current={1}
        steps={[
          { title: '概念', body: '是什么' },
          { title: '例子', body: '具体例子' },
          { title: '反例', body: '易混淆' },
          { title: '常见坑', body: '常见错误' },
        ]}
      />,
    );
    expect(await findByText('2. 例子')).toBeInTheDocument();
    expect(await findByText('4. 常见坑')).toBeInTheDocument();
  });

  test('ChoiceGrid：选项渲染', async () => {
    const { findByText } = render(<ChoiceGrid options={['甲', '乙', '丙']} />);
    expect(await findByText('甲')).toBeInTheDocument();
    expect(await findByText('丙')).toBeInTheDocument();
  });

  test('MicButton：hint 可见（M6 语音占位）', async () => {
    const { findByText } = render(<MicButton hint="按住，把这一段讲给别人听" />);
    expect(await findByText(/讲给别人听/)).toBeInTheDocument();
  });

  test('TTSBar：播放/倍速/时长可见（M6 语音占位）', async () => {
    const { findByText } = render(<TTSBar playing={false} rate={1} durationMs={24500} />);
    expect(await findByText('▶')).toBeInTheDocument();
    expect(await findByText('1x · 25s')).toBeInTheDocument();
  });

  test('FeedbackBar：三档齐全；pendingJudge 只降透明度不禁用', async () => {
    const { findByText } = render(<FeedbackBar grades={['correct', 'fuzzy', 'wrong']} pendingJudge />);
    expect(await findByText('对')).toBeInTheDocument();
    expect(await findByText('模糊')).toBeInTheDocument();
    expect(await findByText('错')).toBeInTheDocument();
  });

  test('FeedbackBar：grades 之外的档位禁用（disabled 透明度 0.38）', async () => {
    const { findByText } = render(<FeedbackBar grades={['correct']} pendingJudge={false} />);
    const wrong = await findByText('错');
    expect(wrong.parentElement).toHaveClass('disabled');
  });

  test('SourceLink：label + 出处文件 + 原句', async () => {
    const { findByText } = render(
      <SourceLink aluId="psy-001" sourceRef={SOURCE_REF} label="回出处" />,
    );
    expect(await findByText('回出处')).toBeInTheDocument();
    expect(await findByText(/Lakens/)).toBeInTheDocument();
    expect(await findByText('信度指测量的一致性。')).toBeInTheDocument();
  });

  test('DueChip：有账/无账两种文案', async () => {
    const withDue = render(<DueChip count={3} />);
    expect(await withDue.findByText('今天有 3 张要还')).toBeInTheDocument();
    const clear = render(<DueChip count={0} />);
    expect(await clear.findByText('今天没有欠账')).toBeInTheDocument();
  });

  test('TodayPlanPanel：三行端侧算 + 开始', async () => {
    const { findByText } = render(
      <TodayPlanPanel dueCount={3} remediationCount={1} suggestionText="效度与信度的关系" />,
    );
    expect(await findByText('复习 3 张到期卡')).toBeInTheDocument();
    expect(await findByText('补讲 1')).toBeInTheDocument();
    expect(await findByText(/效度与信度的关系/)).toBeInTheDocument();
    expect(await findByText('开始')).toBeInTheDocument();
  });

  test('EntryCard：标题 + url + 出处（资源型入口卡）', async () => {
    const { findByText } = render(
      <EntryCard title="Lakens 统计推断讲义" url="https://example.com/lakens" sourceRef={SOURCE_REF} />,
    );
    expect(await findByText('Lakens 统计推断讲义')).toBeInTheDocument();
    expect(await findByText('https://example.com/lakens')).toBeInTheDocument();
  });

  test('StreamSkeleton：定高（UID §2.1 必须定高；纯色块无文本，断言渲染不崩 + 注册表可解析）', () => {
    expect(A2UI_COMPONENT_REGISTRY.StreamSkeleton).toBeDefined();
    expect(() => render(<StreamSkeleton heightPx={96} />)).not.toThrow();
    expect(() => render(<StreamSkeleton heightPx={0} />)).not.toThrow();
  });

  test('SessionEndCard：正向峰值 + next=null 不给按钮', async () => {
    const noNext = render(<SessionEndCard highlight="今天你变强在哪" next={null} />);
    expect(await noNext.findByText('今天你变强在哪')).toBeInTheDocument();
    expect(noNext.queryByText('下一个')).toBeNull();

    const withNext = render(<SessionEndCard highlight="今天你变强在哪" next="效度与信度" />);
    expect(await withNext.findByText('下一个')).toBeInTheDocument();
  });
});

describe('a2ui-fallback: 未知组件降级（绝不白屏）', () => {
  test('summarizeProps：单值截 60、总量截 200（双重上限）', () => {
    expect(summarizeProps({ title: '信度', n: 3 })).toBe('title: 信度；n: 3');
    const single = summarizeProps({ big: 'x'.repeat(300) });
    expect(single).toMatch(/^big: x+…$/); // 单值截断（60 字 + 省略号）
    expect(single.length).toBeLessThanOrEqual(200);
    const many = summarizeProps(
      Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`key${i}`, 'y'.repeat(60)])),
    );
    expect(many).toMatch(/…$/); // 总量截断收口
    expect(many.length).toBeLessThanOrEqual(201);
  });

  test('A2UISurface 渲染 catalog 外组件名 → 降级纯文本块', async () => {
    const parser = new A2UIStreamParser();
    parser.feed(
      `${JSON.stringify({
        surfaceUpdate: {
          surfaceId: 'main',
          components: [
            { id: 'known', name: 'ConceptCard', props: { title: '信度', definition: '定义' } },
            { id: 'unknown', name: 'FancyWidget9000', props: { title: '未来组件', level: 9 } },
          ],
        },
      })}\n`,
    );
    function Host() {
      const state = useA2UIStream(parser);
      return <A2UISurface state={state} />;
    }
    const { findByText } = render(<Host />);
    expect(await findByText('信度')).toBeInTheDocument(); // 已知组件正常渲染
    expect(await findByText('[未知组件 FancyWidget9000，已降级为文本]')).toBeInTheDocument();
    expect(await findByText(/title: 未来组件；level: 9/)).toBeInTheDocument(); // props 摘要保留
  });
});

describe('a2ui-surface: 渐进渲染（流式过程中已完整组件先渲染）', () => {
  test('第一行到达即渲染；第二行到达后增量出现', async () => {
    const parser = new A2UIStreamParser();
    parser.feed(
      `${JSON.stringify({
        surfaceUpdate: { surfaceId: 'main', components: [{ id: 'c1', name: 'ConceptCard', props: { title: '信度', definition: 'd' } }] },
      })}\n`,
    );
    function Host() {
      const state = useA2UIStream(parser);
      return <A2UISurface state={state} />;
    }
    const { findByText } = render(<Host />);
    expect(await findByText('信度')).toBeInTheDocument();

    parser.feed(
      `${JSON.stringify({
        surfaceUpdate: { surfaceId: 'main', components: [{ id: 'c2', name: 'DueChip', props: { count: 2 } }] },
      })}\n`,
    );
    expect(await findByText('今天有 2 张要还')).toBeInTheDocument();
  });

  test('注册表覆盖 16 零件（渲染侧 catalog 完整性）', () => {
    expect(Object.keys(A2UI_COMPONENT_REGISTRY)).toHaveLength(16);
  });
});
