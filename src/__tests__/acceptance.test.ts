// M7 T2 端到端验收测试：真实用户旅程（mock 云侧 + 时间可注入 + 内存 KV）。
// 断言全程走真 composition 装配（createAppMachine 一处装配五端口 + App.tsx 同款
// 首启灌库接线 bootLikeApp），非测试专用拼装。旅程覆盖：
//  ① 空库首启 → 种子灌库（幂等）→ 元课程小课（quick 不记账）→ 新学 standard 档答对出卡（硬规则2）；
//  ② T+1 到期 → 复习优先（D10）→ 记账/1s 撤销/模糊不记账（D8）/补讲（硬规则3）→ FSRS 0.9 骨架 → 冷加载一致；
//  ③ 工具链路：web_search 未配置/已配置（settings seam）、vision mock 降级与全链、成绩单解析入库；
//  ④ 工具连续失败 ≥2 → tool_failures 升级（pro 单次）→ skill_escalation 事件留痕。
import { describe, expect, test } from '@rstest/core';
import { State } from 'ts-fsrs';
import { createAppMachine, seedFirstRunContent, type AppMachine } from '../composition';
import { ALL_SEED_ALUS } from '../pipeline/seeds';
import { MockCloudClient } from '../cloud/mock';
import type {
  CloudLikeClient,
  CloudStreamResult,
  CompleteTextParams,
  CompleteTextResult,
  StreamChatParams,
} from '../cloud/client';
import { createMemoryKVStore, type KVStore } from '../storage/kv';
import { Repositories } from '../storage/repos';
import { SESSION_EVENTS_KEY } from '../storage/repos/collections';
import type { SessionEvent } from '../domain/events';
import { createScheduler } from '../domain/fsrs';
import { createToolInvoker, createKvToolUsageStore, type ToolEvent } from '../tools/registry';
import { GRADE_PARSE_SYSTEM, appendGradeEvent, parseGradeReport } from '../tools/grade-entry';

const BASE = new Date('2026-10-15T08:00:00.000Z');
const day = (n: number) => new Date(BASE.getTime() + n * 86_400_000);
const DATA_URL = 'data:image/jpeg;base64,QUJD';

/** 可注入时钟（时间推进/定点）。 */
function clock(start: Date) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advanceMs: (ms: number) => { current += ms; },
    setTo: (t: Date) => { current = t.getTime(); },
  };
}
type Clock = ReturnType<typeof clock>;

// ── mock cloud：MockCloudClient + validator 期望补齐（同 integration.test 范式）──

const WRAP_SIGNATURE: Record<string, string> = {
  'quick-learning': 'ConceptCard',
  review: 'FeedbackBar',
  'standard-learning': 'ExplainStep',
  'deep-learning': 'ExplainStep',
};

function surfaceLine(id: string, name: string): string {
  return JSON.stringify({ surfaceUpdate: { surfaceId: 'main', components: [{ id, name, props: {} }] } });
}

class PatchedMockCloud implements CloudLikeClient {
  constructor(readonly inner: MockCloudClient) {}

  async streamChat(params: StreamChatParams): Promise<CloudStreamResult> {
    const result = await this.inner.streamChat(params);
    const ti = params.segments.taskInstruction;
    const extras = ti.aluIds.length === 0
      ? [
          surfaceLine('mock-session-end', 'SessionEndCard'),
          surfaceLine('mock-wrap-sig', WRAP_SIGNATURE[ti.mode] ?? 'ExplainStep'),
        ]
      : [surfaceLine('mock-feedback', 'FeedbackBar')];
    for (const line of extras) params.callbacks?.onTextDelta?.(line);
    return { ...result, a2uiLines: [...result.a2uiLines, ...extras] };
  }

  completeText(params: CompleteTextParams): Promise<CompleteTextResult> {
    return this.inner.completeText(params);
  }

  get proCalls(): number {
    return this.inner.calls.filter((c) => c.kind === 'completeText').length;
  }
}

/** 注入 tool_call 的 mock 云（旅程④）：非空回合在合法流后追加一行 web_search 机器级调用。 */
class ToolCallCloud implements CloudLikeClient {
  constructor(readonly inner: MockCloudClient) {}

  async streamChat(params: StreamChatParams): Promise<CloudStreamResult> {
    const result = await this.inner.streamChat(params);
    const ti = params.segments.taskInstruction;
    const extras = ti.aluIds.length === 0
      ? [
          surfaceLine('mock-session-end', 'SessionEndCard'),
          surfaceLine('mock-wrap-sig', WRAP_SIGNATURE[ti.mode] ?? 'ExplainStep'),
        ]
      : [
          surfaceLine('mock-feedback', 'FeedbackBar'),
          JSON.stringify({ tool_call: { name: 'web_search', args: { query: '测试查询' } } }),
        ];
    for (const line of extras) params.callbacks?.onTextDelta?.(line);
    return { ...result, a2uiLines: [...result.a2uiLines, ...extras] };
  }

  completeText(params: CompleteTextParams): Promise<CompleteTextResult> {
    return this.inner.completeText(params);
  }

  get proCalls(): number {
    return this.inner.calls.filter((c) => c.kind === 'completeText').length;
  }
}

// ── App 接线模拟（App.tsx 同款：boot → 首启灌库 → re-boot）──────────

async function bootLikeApp(
  kv: KVStore,
  clk: Clock,
  cloud: CloudLikeClient,
): Promise<{ machine: AppMachine; seeded: number; isFirstRun: boolean }> {
  const machine = await createAppMachine({ kv, cloud, now: () => clk.now() });
  const outcome0 = await machine.orchestrator.boot(clk.now());
  if (!outcome0.isFirstRun) return { machine, seeded: 0, isFirstRun: false };
  const seeded = await seedFirstRunContent(machine.repos);
  if (seeded > 0) await machine.orchestrator.boot(clk.now()); // 灌库后重新决策
  return { machine, seeded, isFirstRun: true };
}

/** session_events 集合读取（SessionEvent 与工具流水 ToolEvent 同源落盘）。 */
async function readEvents(kv: KVStore): Promise<(SessionEvent | ToolEvent)[]> {
  const raw = await kv.get(SESSION_EVENTS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as (SessionEvent | ToolEvent)[]);
}

// ── 旅程①②：核心学习闭环 ──────────────────────────────────────────

describe('M7 验收：核心学习闭环（真 composition 装配）', () => {
  test('旅程①：空库首启 → 种子灌库（幂等）→ 元课程小课 → 新学 standard 档答对出卡', async () => {
    const kv = createMemoryKVStore();
    const clk = clock(BASE);
    const cloud = new PatchedMockCloud(new MockCloudClient());

    // 首启判定成立 → 灌入 M5 真种子（9 条 ALU），幂等重灌新增 0
    const first = await bootLikeApp(kv, clk, cloud);
    expect(first.seeded).toBe(ALL_SEED_ALUS.length);
    expect(first.isFirstRun).toBe(true); // 灌库只写主数据不产生记录，仍走首启引导
    const boot1 = await first.machine.orchestrator.boot(clk.now());
    expect(boot1.decision.kind).toBe('first_run');
    expect(boot1.activation.skill).toBe('quick-learning');
    expect(boot1.activation.aluIds).toEqual(['meta-001', 'meta-002', 'meta-003']); // 元课程种子批次
    await expect(seedFirstRunContent(first.machine.repos)).resolves.toBe(0); // 幂等

    // 首启小课（quick 档，4 回合）：不写 FSRS、禁出卡、零欠账
    const { orchestrator, repos, emitter } = first.machine;
    orchestrator.openSession(clk.now());
    const t1 = await orchestrator.runTurn({ kind: 'open' }, clk.now());
    expect(t1.ok).toBe(true);
    expect(t1.phase).toBe('teach');
    const t2 = await orchestrator.runTurn({ kind: 'answer', aluId: 'meta-001', grade: 'correct', latencyMs: 15_000 }, clk.now());
    expect(t2.judged?.fsrsApplied).toBe(false);
    const t3 = await orchestrator.runTurn({ kind: 'answer', aluId: 'meta-002', grade: 'correct', latencyMs: 15_000 }, clk.now());
    expect(t3.phase).toBe('teach');
    const t4 = await orchestrator.runTurn({ kind: 'answer', aluId: 'meta-003', grade: 'correct', latencyMs: 15_000 }, clk.now());
    expect(t4.phase).toBe('wrap_up');
    expect(t4.directives.some((d) => d.includes('已出卡'))).toBe(false); // 硬规则1：quick 禁出卡
    const end1 = await orchestrator.notifySessionEnd({ saidGoodbye: true }, clk.now());
    expect(end1?.trigger).toBe('goodbye');
    expect(end1?.persisted.reviewLogAppend.map((r) => r.grade)).toEqual(['correct', 'correct', 'correct']);
    expect(end1?.persisted.reviewLogAppend.every((r) => r.skill === 'quick-learning')).toBe(true);
    expect(Object.keys(await repos.listAluStates())).toEqual([]); // quick 零复习欠账

    // 回访：new_learn 建议 meta-001 → standard 档讲完自检答对自动出卡（硬规则2）
    const second = await bootLikeApp(kv, clk, cloud);
    expect(second.seeded).toBe(0);
    expect(second.isFirstRun).toBe(false);
    const boot2 = await second.machine.orchestrator.boot(clk.now());
    expect(boot2.decision.kind).toBe('new_learn');
    if (boot2.decision.kind !== 'new_learn') throw new Error('unreachable');
    expect(boot2.decision.suggestion.aluId).toBe('meta-001');
    expect(boot2.activation.skill).toBe('standard-learning');

    const o2 = second.machine.orchestrator;
    o2.openSession(clk.now());
    const s1 = await o2.runTurn({ kind: 'open' }, clk.now());
    expect(s1.phase).toBe('teach');
    const s2 = await o2.runTurn({ kind: 'answer', aluId: 'meta-001', grade: 'correct', latencyMs: 20_000 }, clk.now());
    expect(s2.judged?.fsrsApplied).toBe(false); // standard 插问不写 FSRS
    expect(s2.directives.some((d) => d.includes('已出卡：讲完并自检过'))).toBe(true);
    expect(s2.phase).toBe('wrap_up');
    await o2.notifySessionEnd({ saidGoodbye: true }, clk.now());

    // 出卡落盘：New 态、due=T+1、status learned_once；出处指向元课程文档 span
    const states = await repos.listAluStates();
    expect(states['meta-001']?.status).toBe('learned_once');
    expect(states['meta-001']?.fsrs.state).toBe(State.New);
    expect(states['meta-001']?.fsrs.due.getTime()).toBe(day(1).getTime());
    const events = await readEvents(kv);
    const cardEvents = events.filter((e) => e.type === 'card_generated');
    expect(cardEvents.length).toBe(1);
    expect(String(cardEvents[0] && (cardEvents[0] as { sourceChunkId: string }).sourceChunkId)
      .startsWith('score-boost-methodology#span-')).toBe(true);

    // A2UI 渐进下发：每回合一批、批内全为 surfaceUpdate 行（机器级行不下发）
    expect(emitter.batches.length).toBe(4);
    expect(second.machine.emitter.batches.length).toBe(2);
    for (const batches of [emitter.batches, second.machine.emitter.batches]) {
      expect(batches.every((b) => b.length > 0 && b.every((l) => l.includes('surfaceUpdate')))).toBe(true);
    }
  });

  test('旅程②：T+1 到期 → 复习优先（D10）→ 记账/撤销/模糊不记账/补讲 → FSRS 骨架 → 冷加载一致', async () => {
    const kv = createMemoryKVStore();
    const clk = clock(BASE);
    const cloud = new PatchedMockCloud(new MockCloudClient());

    // 铺垫：首启灌库 → 空会话收尾转回访 → 两条 standard 会话各出一张卡（due=T+1）
    const setup = await bootLikeApp(kv, clk, cloud);
    setup.machine.orchestrator.openSession(clk.now());
    await setup.machine.orchestrator.notifySessionEnd({ idleMs: 95_000 }, clk.now());
    for (const aluId of ['meta-001', 'meta-002']) {
      const m = await bootLikeApp(kv, clk, cloud);
      const b = await m.machine.orchestrator.boot(clk.now());
      expect(b.decision.kind).toBe('new_learn');
      m.machine.orchestrator.openSession(clk.now());
      await m.machine.orchestrator.runTurn({ kind: 'open' }, clk.now());
      const t = await m.machine.orchestrator.runTurn({ kind: 'answer', aluId, grade: 'correct', latencyMs: 20_000 }, clk.now());
      expect(t.directives.some((d) => d.includes('已出卡'))).toBe(true);
      await m.machine.orchestrator.notifySessionEnd({ saidGoodbye: true }, clk.now());
    }
    const before = await new Repositories(kv).listAluStates();
    expect(before['meta-001']?.fsrs.due.getTime()).toBe(day(1).getTime());
    expect(before['meta-002']?.fsrs.due.getTime()).toBe(day(1).getTime());

    // 时间推进到 T+1 后 1 小时 → 冷加载新机器 → 复习优先（D10：复习 > 补讲 > 新学）
    clk.setTo(new Date(day(1).getTime() + 3_600_000));
    const due = await bootLikeApp(kv, clk, cloud);
    const boot = await due.machine.orchestrator.boot(clk.now());
    expect(boot.decision.kind).toBe('review');
    if (boot.decision.kind !== 'review') throw new Error('unreachable');
    const batch = boot.decision.batch.map((q) => q.aluId);
    expect(batch).toEqual(['meta-001', 'meta-002']); // R 相同 → id 序，确定性
    expect(boot.activation.skill).toBe('review');
    expect(boot.boundedLine).toBe('再 2 张清完今天'); // 会话有界开场

    const ro = due.machine.orchestrator;
    const aId = batch[0]!;
    const bId = batch[1]!;
    const T_REV = clk.now();
    ro.openSession(T_REV);
    const r1 = await ro.runTurn({ kind: 'open' }, T_REV);
    expect(r1.ok).toBe(true);
    expect(r1.phase).toBe('present');
    expect(r1.targetAluId).toBe(aId);

    // correct 记账（New→Learning 骨架[1]=2 天）→ 1s 撤销：回滚 FSRS + 游标回退重呈
    const r2 = await ro.runTurn({ kind: 'answer', aluId: aId, grade: 'correct', latencyMs: 25_000 }, T_REV);
    expect(r2.judged?.fsrsApplied).toBe(true);
    const revoked = ro.revokeLastAnswer(aId);
    expect(revoked?.revoked).toBe(true);
    expect(revoked?.grade).toBe('correct');
    const r3 = await ro.runTurn({ kind: 'open' }, T_REV);
    expect(r3.targetAluId).toBe(aId); // 重呈

    // fuzzy（D8）：不记账、"再讲一遍"、本轮稍后重现
    const r4 = await ro.runTurn({ kind: 'answer', aluId: aId, grade: 'fuzzy', latencyMs: 9_000 }, T_REV);
    expect(r4.judged?.fsrsApplied).toBe(false);
    expect(r4.directives.some((d) => d.includes('再讲一遍'))).toBe(true);
    const r5 = await ro.runTurn({ kind: 'open' }, T_REV);
    expect(r5.targetAluId).toBe(aId); // fuzzy 重现

    // fuzzy→correct：struggleWin 高价值正反馈 + 正式记账
    const r6 = await ro.runTurn({ kind: 'answer', aluId: aId, grade: 'correct', latencyMs: 30_000 }, T_REV);
    expect(r6.judged?.fsrsApplied).toBe(true);
    expect(r6.phase).toBe('present'); // 推进到下一张

    // wrong（硬规则3）：Again 记账 + 自动拉起 90 秒补讲子会话
    const r7 = await ro.runTurn({ kind: 'open' }, T_REV);
    expect(r7.targetAluId).toBe(bId);
    const r8 = await ro.runTurn({ kind: 'answer', aluId: bId, grade: 'wrong', latencyMs: 8_000 }, T_REV);
    expect(r8.judged?.fsrsApplied).toBe(true);
    expect(r8.remediationStarted).toBe(true);
    expect(r8.phase).toBe('remediation');
    const r9 = await ro.runTurn({ kind: 'answer', aluId: bId, grade: 'correct', latencyMs: 12_000 }, T_REV);
    expect(r9.judged?.fsrsApplied).toBe(false); // 补讲期作答不写 FSRS（间隔按答错处理）
    const r10 = await ro.runTurn({ kind: 'remediation_done' }, T_REV);
    expect(r10.phase).toBe('wrap_up');

    // 收尾落盘：review_log 仅 correct/wrong（fuzzy/revoked 不落盘，D8），struggleWin 留痕
    const end = await ro.notifySessionEnd({ idleMs: 95_000 }, T_REV);
    expect(end?.trigger).toBe('idle_90s');
    expect(end?.persisted.reviewLogAppend.map((r) => r.grade)).toEqual(['correct', 'wrong', 'correct']);
    const log = await new Repositories(kv).listReviewLog();
    const reviewOnly = log.filter((r) => r.skill === 'review');
    expect(reviewOnly.map((r) => r.grade)).toEqual(['correct', 'wrong', 'correct']);
    expect(reviewOnly[0]?.struggleWin).toBe(true);
    expect(reviewOnly.every((r) => r.grade !== 'fuzzy' && !r.revoked)).toBe(true);

    // FSRS 落库：目标保持率 0.9（§4.6①）+ 艾宾浩斯骨架间隔（D6）
    expect(createScheduler().parameters.request_retention).toBe(0.9);
    const st = await new Repositories(kv).listAluStates();
    const stA = st[aId]!;
    expect(stA.fsrs.state).toBe(State.Learning);
    expect(stA.fsrs.reps).toBe(1); // 撤销回滚后 correct 重记一次
    expect(stA.fsrs.scheduled_days).toBe(2); // 骨架[1]=2
    expect(stA.fsrs.due.getTime()).toBe(T_REV.getTime() + 2 * 86_400_000);
    expect(stA.lastAnswers.map((r) => r.grade)).toEqual(['correct', 'fuzzy', 'correct']); // 出卡自检 + 撤销不计入 + fuzzy 留存
    const stB = st[bId]!;
    expect(stB.fsrs.state).toBe(State.Learning); // New + Again → Learning（短间隔）
    expect(stB.fsrs.reps).toBe(1);
    expect(stB.fsrs.lapses).toBe(0);
    expect(stB.fsrs.due.getTime()).toBeGreaterThan(T_REV.getTime());
    expect(stB.fsrs.due.getTime()).toBeLessThanOrEqual(T_REV.getTime() + 10 * 60_000);
    expect(stB.lastAnswers.map((r) => r.grade)).toEqual(['correct', 'wrong', 'correct']); // 出卡自检 + 答错 + 补讲答对

    // 冷加载一致：同刻第三次启动（无到期、无当日补讲）→ new_learn meta-003，状态逐字段一致
    const third = await bootLikeApp(kv, clk, cloud);
    const boot3 = await third.machine.orchestrator.boot(clk.now());
    expect(boot3.decision.kind).toBe('new_learn');
    if (boot3.decision.kind !== 'new_learn') throw new Error('unreachable');
    expect(boot3.decision.suggestion.aluId).toBe('meta-003');
    const st3 = await third.machine.repos.listAluStates();
    expect(st3[aId]?.fsrs.due.getTime()).toBe(stA.fsrs.due.getTime());
    expect(st3[aId]?.fsrs.reps).toBe(stA.fsrs.reps);
    expect(st3[aId]?.lastAnswers.map((r) => r.grade)).toEqual(['correct', 'fuzzy', 'correct']);
    expect(st3[bId]?.fsrs.due.getTime()).toBe(stB.fsrs.due.getTime());
    expect(st3[bId]?.lastAnswers.map((r) => r.grade)).toEqual(['correct', 'wrong', 'correct']);
  });
});

// ── 旅程③④：工具链路 ─────────────────────────────────────────────

describe('M7 验收：工具链路（web_search/vision/成绩单 + 限额升级）', () => {
  test('旅程③：web_search 未配置/已配置（settings seam）、vision mock 降级与全链、成绩单解析入库', async () => {
    const clk = clock(BASE);

    // ① 默认装配（mock 云）：web_search 未配置 → not_configured 业务失败不抛
    const kv1 = createMemoryKVStore();
    const m1 = await createAppMachine({ kv: kv1, cloud: new MockCloudClient(), now: () => clk.now() });
    const r1 = await m1.tools.callTool('web_search', { query: '间隔重复效应' }) as { ok: boolean; error: string };
    expect(r1.ok).toBe(false);
    expect(r1.error).toContain('not_configured');

    // ② mock 云无 Key：识图降级 {ok:false} 不抛（主流程可继续，UI 走兜底）
    const r2 = await m1.tools.callTool('vision_capture', { imageDataUrl: DATA_URL }) as { ok: boolean; error?: string };
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain('Mock');

    // ③ settings 配置 web_search 端点（composition 装配时读 settings 的真实 seam）+ stub fetch → 全链 ok
    const kv2 = createMemoryKVStore();
    const repos2 = new Repositories(kv2);
    await repos2.saveSettings({
      ...(await repos2.loadSettings()),
      webSearchEndpoint: 'https://search.example.com/api',
      webSearchKey: 'k-test',
    });
    const m2 = await createAppMachine({ kv: kv2, cloud: new MockCloudClient(), now: () => clk.now() });
    const originalFetch = globalThis.fetch;
    const seen: { url: string; auth: string } = { url: '', auth: '' };
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(url);
      seen.auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
      return new Response(
        JSON.stringify({ results: [{ title: '间隔重复', url: 'https://e.example.com', snippet: 'Ebbinghaus 1885' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const r3 = await m2.tools.callTool('web_search', { query: '间隔重复' }) as { ok: boolean; results: unknown[] };
      expect(r3.ok).toBe(true);
      expect(r3.results.length).toBe(1);
      expect(seen.url).toBe('https://search.example.com/api');
      expect(seen.auth).toBe('Bearer k-test');
      // composition 桥接：tool_call/tool_result 流水落 session_events（埋点同源）
      const events2 = await readEvents(kv2);
      expect(events2.some((e) => e.type === 'tool_call' && e.name === 'web_search')).toBe(true);
      expect(events2.some((e) => e.type === 'tool_result' && e.name === 'web_search' && e.ok === true)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // ④ vision 全链：经 composition 官方 tools 覆写 seam 注入 fake 识图端口
    const kv3 = createMemoryKVStore();
    let visionSystem = '';
    const m3 = await createAppMachine({
      kv: kv3,
      cloud: new MockCloudClient(),
      now: () => clk.now(),
      tools: createToolInvoker({
        vision: {
          completeVision: async (p) => {
            visionSystem = p.system;
            return '图里是一道一元一次方程题';
          },
        },
        speechBridge: null,
        usage: createKvToolUsageStore(kv3),
      }),
    });
    const r4 = await m3.tools.callTool('vision_capture', { imageDataUrl: DATA_URL, hint: '这道题怎么解' }) as { ok: boolean; text?: string };
    expect(r4.ok).toBe(true);
    expect(r4.text).toContain('一元一次方程');
    expect(visionSystem).toContain('识图子代理'); // sub-agent 独立窗口 system（§7.7⑤）

    // ⑤ 成绩单解析链路：GRADE_PARSE_SYSTEM 独立窗口 → 结构化 GradeEvent 入库（不存原图）
    const kv4 = createMemoryKVStore();
    const repos4 = new Repositories(kv4);
    let gradeSystem = '';
    const parse = await parseGradeReport(
      { imageDataUrl: DATA_URL, at: BASE.toISOString() },
      {
        completeVision: async (p) => {
          gradeSystem = p.system;
          return '```json\n{"subject":"数学","total":180,"sections":[{"name":"选择","score":88,"full":120}]}\n```';
        },
      },
    );
    expect(parse.ok).toBe(true);
    if (!parse.ok) throw new Error('unreachable');
    expect(parse.gradeEvent.total).toBe(180);
    expect(gradeSystem).toContain('成绩单解析子代理');
    await appendGradeEvent(repos4, parse.gradeEvent);
    const profile = await repos4.loadProfile();
    expect(profile?.facts.gradeEvents.length).toBe(1);
    expect(profile?.facts.gradeEvents[0]?.sections[0]?.score).toBe(88);
  });

  test('旅程④：工具连续失败 ≥2 → tool_failures 升级（pro 单次）→ skill_escalation 事件留痕', async () => {
    const kv = createMemoryKVStore();
    const clk = clock(BASE);
    const cloud = new ToolCallCloud(new MockCloudClient());
    const machine = await createAppMachine({
      kv,
      cloud,
      now: () => clk.now(),
      tools: { callTool: async () => { throw new Error('quota_exceeded: 注入测试'); } },
    });

    // 首启灌库后重新决策：first_run 激活元课程批次（quick 档白名单含 tool_call）
    await machine.orchestrator.boot(clk.now());
    await seedFirstRunContent(machine.repos);
    const boot = await machine.orchestrator.boot(clk.now());
    expect(boot.activation.aluIds).toEqual(['meta-001', 'meta-002', 'meta-003']);
    machine.orchestrator.openSession(clk.now());

    // 回合1：云流带 tool_call → 工具失败 1 次（未达阈值，不升级）
    const t1 = await machine.orchestrator.runTurn({ kind: 'open' }, clk.now());
    expect(t1.ok).toBe(true);
    expect(cloud.proCalls).toBe(0);

    // 回合2：第 2 次连续失败 → 达阈值 → 单次 pro 升级
    const t2 = await machine.orchestrator.runTurn({ kind: 'advance' }, clk.now());
    expect(t2.ok).toBe(true);
    expect(cloud.proCalls).toBe(1);

    // 主动再见收尾 → 会话事件落盘 → skill_escalation 事件 signal.type = tool_failures
    const end = await machine.orchestrator.notifySessionEnd({ saidGoodbye: true }, clk.now());
    expect(end?.trigger).toBe('goodbye');
    const events = await readEvents(kv);
    const esc = events.find((e) => e.type === 'skill_escalation');
    expect(esc).toBeDefined();
    if (esc?.type !== 'skill_escalation') throw new Error('unreachable');
    expect(esc.signal.type).toBe('tool_failures');
    expect(esc.result.nextStep.length).toBeGreaterThan(0);
  });
});
