// M2c 压缩器测试：只压④~⑧（①②③绝不改写）、五类保命清单、久远回合可丢。
import { describe, expect, test } from '@rstest/core';
import { compressSegments } from '../cloud';
import { SKILL_TEMPLATE_QUICK, STABLE, segments, taskInstruction } from './cloud-fixtures';

function longHistory() {
  return [
    { role: 'user' as const, content: '很久以前：讲讲这门课 overview' },               // 久远普通回合（可丢）
    { role: 'assistant' as const, content: 'overview 讲完了，自检通过' },                 // 已完成回合（可丢）
    { role: 'user' as const, content: '还是报错：TypeError: cannot read property of undefined，第 3 步就失败' }, // 未解决错误原文（必保）
    { role: 'user' as const, content: '久远的闲聊：今天天气不错' },                       // 久远普通回合（可丢）
    { role: 'assistant' as const, content: '刚才那步讲的是概念' },
    { role: 'user' as const, content: '继续，下一步是什么？' },                           // 最近回合（未完成步骤）
  ];
}

describe('cloud-compressor: ①②③绝不改写（F15 裁决口径）', () => {
  test('①②③④压缩前后引用级全等', () => {
    const input = segments({ history: longHistory(), skillTemplate: SKILL_TEMPLATE_QUICK });
    const { segments: out } = compressSegments(input, { keepRecentTurns: 2, maxChars: 1000 });
    expect(out.system).toBe(input.system);
    expect(out.psychologyLibrary).toBe(input.psychologyLibrary);
    expect(out.catalog).toBe(input.catalog);
    expect(out.skillTemplate).toBe(input.skillTemplate);
    // 稳定前缀在压缩后逐字节不变
    expect(
      `${out.system}${out.psychologyLibrary}${out.catalog}`,
    ).toBe(`${STABLE.system}${STABLE.psychologyLibrary}${STABLE.catalog}`);
  });
});

describe('cloud-compressor: 五类保命清单', () => {
  test('当前目标+用户约束（⑥段原样）与关键引用（⑧元信息）必保', () => {
    const task = taskInstruction('standard-learning');
    const input = segments({ history: longHistory(), taskInstruction: task });
    const { segments: out } = compressSegments(input, { keepRecentTurns: 2, maxChars: 1000 });
    expect(out.taskInstruction).toBe(task); // 引用全等：aluIds/mode/boundaries 原样
    expect(out.taskInstruction.boundaries).toContain('别用太多类比');
    expect(out.retrieved[0].aluId).toBe('psy-001'); // 关键引用：alu-id 保留
    expect(out.retrieved[0].sourceRef?.docId).toBe('doc-1');
  });

  test('未解决错误原文保留 + 最近回合保留（未完成步骤）', () => {
    const input = segments({ history: longHistory() });
    const { segments: out, report } = compressSegments(input, { keepRecentTurns: 2, maxChars: 1000 });
    const contents = out.history.map((t) => t.content).join('\n');
    expect(contents).toContain('还是报错：TypeError: cannot read property of undefined'); // 错误原文不摘要
    expect(contents).toContain('继续，下一步是什么？'); // 最近回合
    expect(report.keptErrorTurns).toBeGreaterThanOrEqual(1);
    // 历史相对顺序不变（只追加语义）
    const errIndex = out.history.findIndex((t) => t.content.includes('TypeError'));
    const recentIndex = out.history.findIndex((t) => t.content.includes('下一步'));
    expect(errIndex).toBeLessThan(recentIndex);
  });

  test('久远对话与已完成回合可丢：removedTurns>0 且历史变短', () => {
    const input = segments({ history: longHistory() });
    const { segments: out, report } = compressSegments(input, { keepRecentTurns: 2, maxChars: 1000 });
    expect(report.removedTurns).toBeGreaterThanOrEqual(2); // overview/闲聊被丢
    expect(out.history.length).toBeLessThan(input.history.length);
    expect(out.history.map((t) => t.content).join('\n')).not.toContain('天气不错');
  });

  test('⑤画像截断与⑧digest 紧截断', () => {
    const input = segments({
      profileFragment: 'p'.repeat(2000),
      retrieved: [{ kind: 'search_digest', digest: 'y'.repeat(500) }],
    });
    const { segments: out, report } = compressSegments(input, { maxProfileChars: 300, maxChars: 1000 });
    expect(out.profileFragment.length).toBeLessThanOrEqual(301); // 300 + 省略号
    expect(report.profileTruncatedChars).toBeGreaterThan(1600);
    expect(out.retrieved[0].digest.length).toBeLessThanOrEqual(201);
    expect(report.retrievedTruncated).toBe(1);
  });
});
