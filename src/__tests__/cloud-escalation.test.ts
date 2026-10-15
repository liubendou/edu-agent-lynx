// M2c 卡死升级测试：五类信号检测、单次升级（会话内去重）、上下文最小化、事件留痕、配额护栏。
import { describe, expect, test } from '@rstest/core';
import {
  EscalationManager,
  MockCloudClient,
  RETRY_NO_CONVERGE_THRESHOLD,
  StuckDetector,
  TOOL_FAILURE_THRESHOLD,
  buildEscalationPrompt,
  escalationKey,
} from '../cloud';
import type { EscalationSignal } from '../cloud/escalation';
import type { SessionEvent } from '../domain/events';
import { BudgetGuard } from '../cloud';
import { Repositories } from '../storage/repos';
import { createMemoryKVStore } from '../storage/kv';
import { SKILL_TEMPLATE_QUICK, STABLE } from './cloud-fixtures';

const SIGNAL_RETRY: EscalationSignal = { type: 'retry_no_converge', turns: 3 };

function manager(options: { escalationLimit?: number; completeTextResponse?: string } = {}) {
  const repos = new Repositories(createMemoryKVStore());
  const budget = new BudgetGuard({
    repos,
    now: () => new Date('2026-10-15T08:00:00.000Z'),
    defaults: options.escalationLimit !== undefined ? { escalationLimit: options.escalationLimit } : {},
  });
  const client = new MockCloudClient(options.completeTextResponse !== undefined
    ? { completeTextResponse: options.completeTextResponse }
    : {});
  const events: SessionEvent[] = [];
  const escalation = new EscalationManager({
    client,
    budget,
    onEvent: (e) => events.push(e),
  });
  return { escalation, client, budget, events };
}

describe('cloud-escalation: 五类卡死信号检测', () => {
  test('同义重试连续不收敛与工具连续失败按阈值触发，收敛后清零', () => {
    const detector = new StuckDetector();
    expect(detector.observe({ kind: 'user_retry' })).toBeNull();
    expect(detector.observe({ kind: 'user_retry' })).toBeNull();
    const signal = detector.observe({ kind: 'user_retry' });
    expect(signal).toEqual({ type: 'retry_no_converge', turns: RETRY_NO_CONVERGE_THRESHOLD });

    const toolDetector = new StuckDetector();
    expect(toolDetector.observe({ kind: 'tool_failure' })).toBeNull();
    expect(toolDetector.observe({ kind: 'tool_failure' })).toEqual({ type: 'tool_failures', consecutive: TOOL_FAILURE_THRESHOLD });

    toolDetector.reset();
    expect(toolDetector.observe({ kind: 'tool_failure' })).toBeNull(); // 不跨故障累积
  });

  test('三类直通信号：输出偏离/用户纠错/模型自评低置信', () => {
    const detector = new StuckDetector();
    expect(detector.observe({ kind: 'output_deviation', detail: '连续三轮没有产出 QuestionCard' }))
      .toEqual({ type: 'output_deviation', detail: '连续三轮没有产出 QuestionCard' });
    expect(detector.observe({ kind: 'user_correction', detail: '你讲错了，重讲' }))
      .toEqual({ type: 'user_correction', detail: '你讲错了，重讲' });
    expect(detector.observe({ kind: 'model_low_confidence', selfReport: '不确定该用哪个判据' }))
      .toEqual({ type: 'low_confidence', selfReport: '不确定该用哪个判据' });
  });
});

describe('cloud-escalation: 单次升级（每次卡死只升一次）', () => {
  const request = { stuckAt: 'psy-001 第二问，用户连续三次同义重试', goal: '让用户独立说出 p 值定义', skill: 'quick-learning' as const };

  test('触发后向 pro 发一次最小化请求；第二次同信号不再升', async () => {
    const { escalation, client, events } = manager();
    const first = await escalation.escalate(SIGNAL_RETRY, request);
    expect(first.escalated).toBe(true);
    if (first.escalated) {
      expect(first.result.loggedToFacts).toBe(true);
      expect(first.result.nextStep.length).toBeGreaterThan(0);
    }
    // 单次 pro 请求
    const proCalls = client.calls.filter((c) => c.modelRole === 'pro');
    expect(proCalls).toHaveLength(1);

    // 第二次同信号：不再升
    const second = await escalation.escalate(SIGNAL_RETRY, request);
    expect(second).toEqual({ escalated: false, reason: 'duplicate' });
    expect(client.calls.filter((c) => c.modelRole === 'pro')).toHaveLength(1); // 仍只有一次
    expect(events).toHaveLength(1); // 只产一次事件
    expect(escalation.hasEscalated(SIGNAL_RETRY)).toBe(true);
  });

  test('升级请求上下文最小化：只带"卡在哪+目标"，不带八段长上下文', async () => {
    const { client } = manager();
    const prompt = buildEscalationPrompt(request);
    expect(prompt).toContain(request.stuckAt);
    expect(prompt).toContain(request.goal);
    expect(prompt).toContain('quick-learning');
    expect(prompt.length).toBeLessThan(500); // 最小化（对比八段动辄数千字符）
    expect(prompt).not.toContain(STABLE.catalog);
    expect(prompt).not.toContain(SKILL_TEMPLATE_QUICK);

    await client.completeText({ prompt, modelRole: 'pro' });
    expect(client.calls[0].modelRole).toBe('pro');
    expect(client.calls[0].promptChars).toBe(prompt.length);
  });

  test('事件留痕：skill_escalation 事件含信号与结果（画像"这个点在 Flash 上卡过"）', async () => {
    const { escalation, events } = manager();
    await escalation.escalate(SIGNAL_RETRY, request);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.type).toBe('skill_escalation');
    if (event.type === 'skill_escalation') {
      expect(event.signal.type).toBe('retry_no_converge');
      expect(event.result.loggedToFacts).toBe(true);
      expect(event.result.nextStep.length).toBeGreaterThan(0);
    }
  });

  test('升级建议可注入；pro 空响应回落兜底建议', async () => {
    const injected = await manager({ completeTextResponse: '先回到上一个答对的例子' }).escalation.escalate(SIGNAL_RETRY, request);
    expect(injected.escalated).toBe(true);
    if (injected.escalated) expect(injected.result.nextStep).toBe('先回到上一个答对的例子');

    const empty = new EscalationManager({
      client: new MockCloudClient({ completeTextResponse: '' }),
      budget: new BudgetGuard({ repos: new Repositories(createMemoryKVStore()) }),
    });
    const fallback = await empty.escalate(SIGNAL_RETRY, request);
    expect(fallback.escalated).toBe(true);
    if (fallback.escalated) expect(fallback.result.nextStep.length).toBeGreaterThan(0); // 兜底非空
  });

  test('升级配额耗尽 → budget_exhausted，不发 pro 请求', async () => {
    const { escalation, client, events } = manager({ escalationLimit: 0 });
    const outcome = await escalation.escalate(SIGNAL_RETRY, request);
    expect(outcome).toEqual({ escalated: false, reason: 'budget_exhausted' });
    expect(client.calls).toHaveLength(0); // 未发任何请求
    expect(events).toHaveLength(0);
  });

  test('去重键：计数型同类型归一，带详情的按详情区分', () => {
    expect(escalationKey({ type: 'retry_no_converge', turns: 3 })).toBe(escalationKey({ type: 'retry_no_converge', turns: 5 }));
    expect(escalationKey({ type: 'tool_failures', consecutive: 2 })).toBe('tool_failures');
    expect(escalationKey({ type: 'output_deviation', detail: 'A' }))
      .not.toBe(escalationKey({ type: 'output_deviation', detail: 'B' }));
    expect(escalationKey({ type: 'low_confidence', selfReport: '不确定' })).toBe('low_confidence:不确定');
  });
});
