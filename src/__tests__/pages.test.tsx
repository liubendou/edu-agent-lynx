// M4 页面与会话测试（T2~T8）：machine 装配 + 页面渲染 + 关键交互链路。
// 范式与 integration.test.ts 同构：PatchedMockCloud（补 FeedbackBar/收尾卡）保证
// validator 全绿零纠偏；渲染用 @lynx-js/react/testing-library。
// 覆盖：Session 宿主渐进渲染/判定推进/撤销重呈/收工正向峰值退场、Home 两分支六卡流、
// Library 收藏切换（D11）、Map 节点+板块环、Growth 掌握点数（无打卡红线）、Profile 开关/边界、
// machine.revokeLastAnswer 撤销窗口（1s 真实计时）。
import '@testing-library/jest-dom';
import { describe, expect, test } from '@rstest/core';
import { fireEvent, render, waitFor } from '@lynx-js/react/testing-library';
import { State, type Card } from 'ts-fsrs';
import { createAlu, type Alu, type AluUserState } from '../domain/alu';
import { createEmptyProfile, type LearnerProfile } from '../domain/profile';
import { createMemoryKVStore, type KVStore } from '../storage/kv';
import { createAppMachine, type AppMachine } from '../composition';
import { MockCloudClient } from '../cloud/mock';
import type {
  CloudLikeClient,
  CloudStreamResult,
  CompleteTextParams,
  CompleteTextResult,
  StreamChatParams,
} from '../cloud/client';
import { Home } from '../pages/Home';
import { ChatPage } from '../pages/Chat';
import { FIRST_RUN_OPENING, TURN_FAILURE_NOTICE, TURN_NO_KEY_NOTICE } from '../chat';
import { SessionPage } from '../pages/Session';
import { MapPage } from '../pages/MapPage';
import { LibraryPage } from '../pages/LibraryPage';
import { ProfilePage } from '../pages/ProfilePage';
import { GrowthPage } from '../pages/GrowthPage';

const BASE = new Date('2026-10-15T08:00:00.000Z');
const day = (n: number) => new Date(BASE.getTime() + n * 86_400_000);

// ── 种子（与 integration.test.ts 同构）────────────────────────────

function makeAlu(id: string, opts: { moduleId?: string; prereq?: string[]; kind?: 'concept' | 'resource' } = {}): Alu {
  const kind = opts.kind ?? 'concept';
  return createAlu({
    id, subjectId: 'psy', moduleId: opts.moduleId ?? 'm1', kind,
    front: `${id} 正题？`, back: `${id} 背面`,
    difficulty: kind === 'resource' ? 0 : 2,
    ...(opts.prereq !== undefined ? { prereq: opts.prereq } : {}),
    source: kind === 'resource'
      ? { docId: 'doc-web', docTitle: '网络讲义', locator: { kind: 'url', url: 'https://example.com/lakens' }, text: '资源原句' }
      : { docId: 'doc-1', docTitle: '样例文档', locator: { kind: 'span', start: 0, end: 10 }, text: '原句' },
  });
}

function dueCard(stability: number): Card {
  return {
    due: day(-1), stability, difficulty: 5, elapsed_days: 20, scheduled_days: 20,
    learning_steps: 0, reps: 6, lapses: 0, state: State.Review, last_review: day(-21),
  };
}

function stateOf(aluId: string, card: Card, bookmarked = false): AluUserState {
  return {
    aluId, status: 'learned_once', fromMode: 'standard', fsrs: card,
    ...(bookmarked ? { bookmarked } : {}),
    lastAnswers: [], createdAt: BASE.toISOString(), updatedAt: BASE.toISOString(),
  };
}

// ── mock cloud：MockCloudClient + validator 期望补齐（同 integration）──

const WRAP_SIGNATURE: Record<string, string> = {
  'quick-learning': 'ConceptCard',
  review: 'FeedbackBar',
  'standard-learning': 'ExplainStep',
  'deep-learning': 'ExplainStep',
};

/** 补齐行 props：页面渲染测试里 surface 组件会真实上屏，空 props 会让组件崩/缺内容。 */
const EXTRA_PROPS: Record<string, Record<string, unknown>> = {
  FeedbackBar: { grades: ['correct', 'fuzzy', 'wrong'], pendingJudge: true },
  SessionEndCard: { highlight: '今天你变强在哪', next: '效度与信度' },
};

function surfaceLine(id: string, name: string): string {
  return JSON.stringify({
    surfaceUpdate: { surfaceId: 'main', components: [{ id, name, props: EXTRA_PROPS[name] ?? {} }] },
  });
}

class PatchedMockCloud implements CloudLikeClient {
  constructor(readonly inner: MockCloudClient) {}

  async streamChat(params: StreamChatParams): Promise<CloudStreamResult> {
    const result = await this.inner.streamChat(params);
    const ti = params.segments.taskInstruction;
    // review 档 mock 流自带带 props 的 FeedbackBar（streams.ts reviewLines），
    // 再补一条会重复渲染判定条；补条仅服务 quick/standard/deep 的 validator 期望组。
    const extras = ti.aluIds.length === 0
      ? [
          surfaceLine('mock-session-end', 'SessionEndCard'),
          surfaceLine('mock-wrap-sig', WRAP_SIGNATURE[ti.mode] ?? 'ExplainStep'),
        ]
      : ti.mode === 'review'
        ? []
        : [surfaceLine('mock-feedback', 'FeedbackBar')];
    // 补齐行必须以 \n 结尾（parser 按行缓冲切分；不带换行会滞留 buffer 永不上屏）
    for (const line of extras) params.callbacks?.onTextDelta?.(`${line}\n`);
    return { ...result, a2uiLines: [...result.a2uiLines, ...extras] };
  }

  completeText(params: CompleteTextParams): Promise<CompleteTextResult> {
    return this.inner.completeText(params);
  }
}

/** 三级兜底复现器：任何回合都失败（等价云侧 5xx / 断网），用于验证"不留白、不静默"。 */
class FailingCloud implements CloudLikeClient {
  streamChat(): Promise<CloudStreamResult> {
    return Promise.reject(new Error('boom: 云侧不可用'));
  }

  completeText(): Promise<CompleteTextResult> {
    return Promise.reject(new Error('boom'));
  }
}

/** 首回合云侧失败、随后成功：复现"无关回合成功被误当成全局清场"的回归。
 *  首回合（开场）失败 → 落一条可重试提示；随后回合成功 → 只能消费它自己那条提示。
 *  inner 稍慢（delayMs），让"回合进行中"（打字骨架）这一态在 DOM 上可观察。 */
class FailFirstCloud implements CloudLikeClient {
  private calls = 0;
  private readonly inner: CloudLikeClient = new PatchedMockCloud(new MockCloudClient({ delayMs: 150 }));

  async streamChat(params: StreamChatParams): Promise<CloudStreamResult> {
    this.calls += 1;
    if (this.calls === 1) throw new Error('boom: 首回合云侧不可用');
    return this.inner.streamChat(params);
  }

  completeText(params: CompleteTextParams): Promise<CompleteTextResult> {
    return this.inner.completeText(params);
  }
}

/** 复习场景机器：两张到期卡（r-low R 更低先出）+ 历史画像（非首启） */
async function makeReviewMachine(
  cloud: CloudLikeClient = new PatchedMockCloud(new MockCloudClient()),
): Promise<{ kv: KVStore; machine: AppMachine }> {
  const kv = createMemoryKVStore();
  const machine = await createAppMachine({
    kv,
    cloud,
    now: () => BASE,
  });
  await machine.repos.putAlu(makeAlu('r-low'));
  await machine.repos.putAlu(makeAlu('r-high', { prereq: ['r-low'] }));
  await machine.repos.putAlu(makeAlu('res-1', { kind: 'resource' }));
  await machine.repos.putAluState(stateOf('r-low', dueCard(10)));
  // r-high 预置收藏（Library D11 用）——收藏同日到期优先（queue.ts priorityRank），
  // 会把 r-high 排到 r-low 前面打乱会话呈现顺序；错开到期日让 R 升序干净生效。
  await machine.repos.putAluState(stateOf('r-high', { ...dueCard(20), due: day(-2) }, true));
  const profile: LearnerProfile = createEmptyProfile();
  profile.sessionSummaries = [{
    sessionId: 's-0', skill: 'standard-learning', at: '2026-10-10T08:00:00.000Z',
    whatHappened: '旧会话：standard 4 次作答', stuckAt: [], nextSuggestion: '继续效度这一块',
  }];
  await machine.repos.saveProfile(profile);
  return { kv, machine };
}

// ── Session：四档共用容器 ────────────────────────────────────────

describe('M4 Session：A2UISurface 宿主 + 撤销窗口 + 收尾', () => {
  test('宿主渐进渲染：有界开场语 + mock 复习流（RevealCard 正题 + FeedbackBar 三档）', async () => {
    const { machine } = await makeReviewMachine();
    const boot = await machine.orchestrator.boot(BASE);
    expect(boot.decision.kind).toBe('review');
    const { findByText } = render(
      <SessionPage machine={machine} boot={boot} onExit={() => {}} />,
    );
    expect(await findByText(/再 2 张清完今天/)).toBeInTheDocument(); // §10.1① 有界开场
    expect(await findByText(/r-low：正题是什么？/)).toBeInTheDocument();
    expect(await findByText('对')).toBeInTheDocument();
    expect(await findByText('模糊')).toBeInTheDocument();
    expect(await findByText('错')).toBeInTheDocument();
  });

  test('三级兜底：回合失败不留白——会话内可见提示 + 「接着讲」重试入口', async () => {
    const { machine } = await makeReviewMachine(new FailingCloud());
    const boot = await machine.orchestrator.boot(BASE);
    const { findByText, queryByText } = render(
      <SessionPage machine={machine} boot={boot} onExit={() => {}} />,
    );
    expect(await findByText(TURN_FAILURE_NOTICE)).toBeInTheDocument(); // 失败进可见提示（不白屏）
    expect(await findByText('接着讲')).toBeInTheDocument(); // 可重试入口
    expect(queryByText(/boom/)).toBeNull(); // 不暴露内部错误信息
  });

  test('判定推进 + 1s 撤销重呈：对→下一张 → 撤销→游标回退重呈原卡', async () => {
    const { machine } = await makeReviewMachine();
    const boot = await machine.orchestrator.boot(BASE);
    const { findByText } = render(
      <SessionPage machine={machine} boot={boot} onExit={() => {}} />,
    );
    await findByText(/r-low：正题是什么？/);
    fireEvent.tap(await findByText('对')); // FeedbackBar 判定对
    await findByText(/r-high：正题是什么？/); // 推进到下一张
    fireEvent.tap(await findByText('撤销刚才的判定')); // 1s 窗口内反悔
    await findByText(/r-low：正题是什么？/); // 重呈原卡
    // 撤销后 FSRS 回滚：作答记录标 revoked（domain.revokeAnswer）
    // （继续答完的场景由 machine 撤销单测覆盖，此处断言 UI 回环）
  }, 15_000);

  test('收工（goodbye）→ 正向峰值收尾卡（SessionEndCard"下一个"）→ 退场回调', async () => {
    const { machine } = await makeReviewMachine();
    const boot = await machine.orchestrator.boot(BASE);
    let exits = 0;
    const { findByText, queryByText } = render(
      <SessionPage machine={machine} boot={boot} onExit={() => { exits += 1; }} />,
    );
    await findByText(/r-low：正题是什么？/);
    fireEvent.tap(await findByText('收工'));
    expect(await findByText('下一个')).toBeInTheDocument(); // 正向峰值收尾（§10.2）
    await waitFor(() => expect(queryByText('收工')).toBeNull()); // ended 置位（收尾落盘完成）再点
    fireEvent.tap(await findByText('下一个'));
    expect(exits).toBe(1);
  }, 15_000);

  test('machine.revokeLastAnswer：撤销标 revoked、二次撤销返回 null', async () => {
    const { machine } = await makeReviewMachine();
    await machine.orchestrator.boot(BASE);
    machine.orchestrator.openSession();
    await machine.orchestrator.runTurn({ kind: 'open' }, BASE);
    const judged = await machine.orchestrator.runTurn(
      { kind: 'answer', aluId: 'r-low', grade: 'correct', latencyMs: 5_000 },
      BASE,
    );
    expect(judged.judged?.fsrsApplied).toBe(true);
    const record = machine.orchestrator.revokeLastAnswer('r-low');
    expect(record?.aluId).toBe('r-low');
    expect(record?.revoked).toBe(true);
    expect(machine.orchestrator.revokeLastAnswer('r-low')).toBeNull(); // 已撤销，无可撤
  });
});

// ── Home：条件式首屏两分支 + 六卡流 ──────────────────────────────

describe('M4 Home：条件首屏（PRD §6）', () => {
  test('回访分支：TodayPlanPanel 三行 + 今天该学的一件事 + DueChip + 上次没走完的', async () => {
    const { machine } = await makeReviewMachine();
    const boot = await machine.orchestrator.boot(BASE);
    const { findByText } = render(
      <Home machine={machine} boot={boot} navigate={() => {}} onOpenSession={() => {}} />,
    );
    expect(await findByText('复习 2 张到期卡')).toBeInTheDocument();
    expect(await findByText('补讲 0')).toBeInTheDocument();
    expect(await findByText(/先还清 2 张到期卡/)).toBeInTheDocument();
    expect(await findByText('今天该学的一件事')).toBeInTheDocument();
    expect(await findByText('今天有 2 张要还')).toBeInTheDocument();
    expect(await findByText('上次没走完的')).toBeInTheDocument();
    expect(await findByText('继续效度这一块')).toBeInTheDocument();
  });

  test('首启分支：方案 D 小课引导（先把方法装进来；对话化后已无「开始小课」按钮）', async () => {
    const kv = createMemoryKVStore();
    const machine = await createAppMachine({ kv, cloud: new PatchedMockCloud(new MockCloudClient()) });
    const boot = await machine.orchestrator.boot(BASE);
    expect(boot.isFirstRun).toBe(true);
    const { findByText, queryByText } = render(
      <Home machine={machine} boot={boot} navigate={() => {}} onOpenSession={() => {}} />,
    );
    expect(await findByText('先把方法装进来')).toBeInTheDocument();
    // 对话化后开场自动发生（脚本 §1.3），首启不再有「开始小课」这类需要点击的入口按钮
    expect(queryByText('开始小课')).toBeNull();
    expect(queryByText('今天该学的一件事')).toBeNull(); // 首启不出现回访卡流
  });

  test('首启分支：真实首屏是对话页（开场自动发生 + 输入框 + 建议 chips）', async () => {
    const kv = createMemoryKVStore();
    const machine = await createAppMachine({ kv, cloud: new PatchedMockCloud(new MockCloudClient()) });
    const boot = await machine.orchestrator.boot(BASE);
    expect(boot.isFirstRun).toBe(true);
    // App.tsx 的唯一首屏路由到 pages/Chat.tsx（route 默认 'chat'）——以真实页面为准断言
    const { findByText, findByPlaceholderText, queryByText, container } = render(
      <ChatPage machine={machine} boot={boot} navigate={() => {}} cloudMock={false} />,
    );
    expect(await findByText(FIRST_RUN_OPENING)).toBeInTheDocument(); // 开场消息自动落进流，无需点击
    expect(await findByPlaceholderText('直接说你想学什么…')).toBeInTheDocument(); // 常驻输入框
    expect(await findByText('讲透「检索练习」')).toBeInTheDocument(); // 建议 chips（用户一开口即收起）
    expect(queryByText('开始小课')).toBeNull();
    // 正常回合收口后不留兜底提示（防"每回合误报失败"）；打字骨架必被真实内容顶掉（脚本 §4-4）
    await waitFor(() => expect(queryByText(TURN_FAILURE_NOTICE)).toBeNull());
    await waitFor(() => expect(container.querySelectorAll('.chat-bubble--typing')).toHaveLength(0));
  });
});

// ── 三级兜底 + 无 Key 引导（验收 S1.8 / 红线 R-P3）──────────────────

describe('M4 首屏三级兜底：回合失败不留白、不静默', () => {
  test('云侧异常：开场仍在 + 流内可见失败提示 + 「接着讲」重试入口（无堆栈外泄）', async () => {
    const kv = createMemoryKVStore();
    const machine = await createAppMachine({ kv, cloud: new FailingCloud() });
    const boot = await machine.orchestrator.boot(BASE);
    const { findByText, queryByText } = render(
      <ChatPage machine={machine} boot={boot} navigate={() => {}} cloudMock={false} />,
    );
    expect(await findByText(FIRST_RUN_OPENING)).toBeInTheDocument(); // 开场消息照常可见
    expect(await findByText(TURN_FAILURE_NOTICE)).toBeInTheDocument(); // 失败提示进会话流（不白屏）
    expect(await findByText('接着讲')).toBeInTheDocument(); // 可重试入口
    expect(queryByText(/boom/)).toBeNull(); // 不暴露内部错误信息/堆栈
  });

  test('无 Key（cloudMock=true）：失败提示引导去设置页填 API Key（不做首屏拦截）', async () => {
    const kv = createMemoryKVStore();
    const machine = await createAppMachine({ kv, cloud: new FailingCloud() });
    const boot = await machine.orchestrator.boot(BASE);
    const { findByText } = render(
      <ChatPage machine={machine} boot={boot} navigate={() => {}} cloudMock />,
    );
    expect(await findByText(TURN_NO_KEY_NOTICE)).toBeInTheDocument();
    expect(await findByText('去设置页填 API Key')).toBeInTheDocument();
  });

  test('回归：无关回合成功不误抹其它提示的「接着讲」；被重放成功的那条提示移出流', async () => {
    const kv = createMemoryKVStore();
    const machine = await createAppMachine({ kv, cloud: new FailFirstCloud() });
    const boot = await machine.orchestrator.boot(BASE);
    const { container, findByText, queryByText } = render(
      <ChatPage machine={machine} boot={boot} navigate={() => {}} cloudMock={false} />,
    );

    // 开场回合失败 → 流内一条带「接着讲」的失败提示（其 retry 绑定开场那条 observation 的引用）
    expect(await findByText(TURN_FAILURE_NOTICE)).toBeInTheDocument();
    expect(await findByText('接着讲')).toBeInTheDocument();

    // 与之无关的另一回合（用户发言）成功：不得被当成全局清场，连带抹掉上一条提示的重试入口
    fireEvent.tap(await findByText('讲透「检索练习」'));
    await waitFor(() => expect(container.querySelector('.chat-bubble--typing')).not.toBeNull()); // 回合确实在跑
    await waitFor(() => {
      // 无关回合成功上屏（卡片出现）+ 收口（骨架撤下）：与提示更新同一批提交，此刻提示状态已定
      expect(container.querySelector('.chat-cards')).not.toBeNull();
      expect(container.querySelectorAll('.chat-bubble--typing')).toHaveLength(0);
    });
    expect(queryByText(TURN_FAILURE_NOTICE)).toBeInTheDocument(); // 与本回合无关，提示仍留在流里
    expect(queryByText('接着讲')).toBeInTheDocument(); // 重试入口未被误抹（bug 回归点）

    // 点「接着讲」真正重放那条失败回合 → 成功 → 该条提示整条移出流（不再自相矛盾地留着）
    fireEvent.tap(await findByText('接着讲'));
    await waitFor(() => expect(queryByText(TURN_FAILURE_NOTICE)).toBeNull());
  }, 15_000);
});

// ── 四页面 ───────────────────────────────────────────────────────

describe('M4 四页面', () => {
  test('LibraryPage：知识型可测卡 + 收藏切换（D11）+ 资源型入口卡 + 可追溯回链', async () => {
    const { machine } = await makeReviewMachine();
    const { findByText, findAllByText } = render(<LibraryPage machine={machine} onBack={() => {}} />);
    expect(await findByText('r-low 正题？')).toBeInTheDocument();
    expect(await findByText('★ 已收藏（点取消）')).toBeInTheDocument(); // r-high 预置收藏
    expect(await findByText('☆ 收藏（抽取优先）')).toBeInTheDocument(); // r-low 未收藏
    expect((await findAllByText('样例文档')).length).toBeGreaterThanOrEqual(1); // SourceLink 回链（两张同文档）
    expect(await findByText('res-1 正题？')).toBeInTheDocument(); // 资源型入口卡
    fireEvent.tap(await findByText('☆ 收藏（抽取优先）'));
    expect(await findByText('★ 已收藏（点取消）')).toBeInTheDocument(); // 切换后两张都收藏
    const states = await machine.repos.listAluStates();
    expect(states['r-low']?.bookmarked).toBe(true); // 落库（仅优先级，不改间隔，D11）
  }, 15_000);

  test('MapPage：节点=学习单元 + 前置关系 + 板块掌握度环', async () => {
    const { machine } = await makeReviewMachine();
    const { findByText, findAllByText } = render(<MapPage machine={machine} onBack={() => {}} />);
    expect(await findAllByText(/r-low 正题？/).then((a) => a.length)).toBeGreaterThanOrEqual(1);
    expect(await findByText('—前置→')).toBeInTheDocument();
    expect(await findByText(/m1 · 2 个单元/)).toBeInTheDocument();
    expect(await findByText('← 返回')).toBeInTheDocument();
  });

  test('GrowthPage：掌握点数（学过/已稳固）+ 板块稳定度；不做打卡/排行榜（§10.2 红线）', async () => {
    const { machine } = await makeReviewMachine();
    const { findByText, queryByText } = render(<GrowthPage machine={machine} onBack={() => {}} />);
    expect(await findByText('个已稳固的掌握点（学过 2 个）')).toBeInTheDocument();
    expect(await findByText(/平均稳定度 15.0 天/)).toBeInTheDocument(); // (10+20)/2
    expect(queryByText(/连续打卡/)).toBeNull();
    expect(queryByText(/排行榜/)).toBeNull();
  });

  test('ProfilePage：隐私开关（§5.5 ①②）+ 偏好边界 + 记录可见', async () => {
    const { machine } = await makeReviewMachine();
    const profile = (await machine.repos.loadProfile())!;
    await machine.repos.saveProfile({
      ...profile,
      preferences: {
        ...profile.preferences,
        boundaries: [{
          id: 'b-1', text: '别用太多类比', source: 'declared' as const, observedCount: 1, createdAt: BASE.toISOString(),
        }],
      },
    });
    const { findByText } = render(<ProfilePage machine={machine} onBack={() => {}} />);
    expect(await findByText('别用太多类比')).toBeInTheDocument();
    expect(await findByText('学习数据用于端侧自适应')).toBeInTheDocument();
    expect(await findByText(/旧会话：standard 4 次作答/)).toBeInTheDocument(); // 记录可见（前缀为日期）
    fireEvent.tap(await findByText('学习数据用于端侧自适应'));
    const settings = await machine.repos.loadSettings();
    expect(settings.privacyAdaptive).toBe(false); // 开关落库
  }, 15_000);
});
