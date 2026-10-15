// M2c 八段拼装器测试：前缀字节级稳定（硬指标）、八段顺序、标签分段、可寻址引用、history 只追加。
import { describe, expect, test } from '@rstest/core';
import { buildRequest, buildStablePrefix, formatLocator, formatRetrievedChunk } from '../cloud';
import type { RetrievedChunk } from '../cloud';
import { PROFILE_FRAGMENT, SKILL_TEMPLATE_QUICK, SKILL_TEMPLATE_STANDARD, STABLE, segments } from './cloud-fixtures';

describe('cloud-context: ①②③前缀字节级稳定（缓存硬指标）', () => {
  test('同输入多次构建，①②③字节级相等（diff 为零）', () => {
    const a = buildStablePrefix(STABLE);
    const b = buildStablePrefix(STABLE);
    const c = buildStablePrefix(STABLE);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(Buffer.byteLength(a)).toBe(Buffer.byteLength(b));
  });

  test('④~⑧任意变化，prefix 字节级不变', () => {
    const base = buildRequest(segments());
    const changed = buildRequest(segments({
      skillTemplate: SKILL_TEMPLATE_STANDARD,
      profileFragment: '画像更新：当前板块掌握度 0.6',
      history: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '答' },
        { role: 'user', content: '第二问' },
      ],
      retrieved: [],
      taskInstruction: {
        aluIds: ['meta-001'],
        mode: 'standard-learning',
        params: { cardGeneration: true },
        budget: { newCards: 1, reviewCards: 2 },
        boundaries: [],
      },
    }));
    expect(changed.prefix).toBe(base.prefix);
    expect(changed.systemContent).not.toBe(base.systemContent); // ④起确实失效
  });

  test('整包请求确定性：同输入两次构建 messages 全等（无时间戳/随机 id 混入）', () => {
    const first = buildRequest(segments());
    const second = buildRequest(segments());
    expect(JSON.stringify(first.messages)).toBe(JSON.stringify(second.messages));
    expect(first.messages).not.toBe(second.messages); // 新数组（history 只追加语义下不共享引用）
  });
});

describe('cloud-context: 八段顺序与物理消息序（代码硬约束）', () => {
  test('①~④在 system 消息内按 <system><psychology><catalog><skill> 顺序出现', () => {
    const built = buildRequest(segments({ skillTemplate: SKILL_TEMPLATE_QUICK }));
    const content = built.messages[0].content;
    expect(built.messages[0].role).toBe('system');
    const iSystem = content.indexOf(`<system>\n${STABLE.system}`);
    const iPsych = content.indexOf(`<psychology>\n${STABLE.psychologyLibrary}`);
    const iCatalog = content.indexOf(`<catalog>\n${STABLE.catalog}`);
    const iSkill = content.indexOf(`<skill>\n${SKILL_TEMPLATE_QUICK}`);
    expect(iSystem).toBeGreaterThanOrEqual(0);
    expect(iPsych).toBeGreaterThan(iSystem);
    expect(iCatalog).toBeGreaterThan(iPsych);
    expect(iSkill).toBeGreaterThan(iCatalog);
  });

  test('消息序：①~④ system → ⑤ memory → ⑦历史（只追加映射）→ ⑥⑧最新 user 消息', () => {
    const history = [
      { role: 'user' as const, content: 'u1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'u2' },
    ];
    const built = buildRequest(segments({ history }));
    expect(built.messages).toHaveLength(2 + history.length + 1);
    expect(built.messages[1].role).toBe('system');
    expect(built.messages[1].content).toContain(`<memory>\n${PROFILE_FRAGMENT}`);
    expect(built.messages[2]).toEqual({ role: 'user', content: 'u1' });
    expect(built.messages[3]).toEqual({ role: 'assistant', content: 'a1' });
    expect(built.messages[4]).toEqual({ role: 'user', content: 'u2' });
    const last = built.messages[built.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('<task>');
    expect(last.content).toContain('"aluIds":["psy-001","psy-002"]'); // ⑥任务指令序列化注入
  });

  test('结构化标签分段齐备：<skill> <memory> <alu> <catalog>（PRD §7.7⑥）', () => {
    const built = buildRequest(segments());
    expect(built.messages[0].content).toContain('<catalog>');
    expect(built.messages[0].content).toContain('<skill>');
    expect(built.messages[1].content).toContain('<memory>');
    expect(built.messages[built.messages.length - 1].content).toContain('<alu>');
    // 无检索时 <alu> 段省略
    const noRetrieved = buildRequest(segments({ retrieved: [] }));
    expect(noRetrieved.messages[noRetrieved.messages.length - 1].content).not.toContain('<alu>');
  });
});

describe('cloud-context: ⑧可寻址引用（§7.7③）', () => {
  test('alu-id + 出处 + 句子级 span + 截断 digest 代替原文粘贴', () => {
    const longDigest = 'x'.repeat(600);
    const chunk: RetrievedChunk = {
      kind: 'alu_ref',
      aluId: 'psy-009',
      sourceRef: {
        docId: 'doc-9',
        docTitle: '某书',
        locator: { kind: 'span', start: 3, end: 66, sentenceIndex: 2 },
        text: '原句',
      },
      digest: longDigest,
    };
    const formatted = formatRetrievedChunk(chunk);
    expect(formatted).toContain('alu=psy-009');
    expect(formatted).toContain('span(3-66#2)');
    expect(formatted).toContain('doc="某书"');
    expect(formatted.length).toBeLessThan(600); // digest 截断后入窗
    expect(formatted.endsWith('…"')).toBe(true);

    const built = buildRequest(segments({ retrieved: [chunk] }));
    const last = built.messages[built.messages.length - 1];
    expect(last.content).toContain('alu=psy-009');
  });

  test('URL 出处定位', () => {
    expect(formatLocator({ kind: 'url', url: 'https://example.com/p' })).toBe('url(https://example.com/p)');
  });
});
