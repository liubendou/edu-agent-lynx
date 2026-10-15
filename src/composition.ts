/**
 * Composition root（M2-int 依赖倒置闭环装配点）。
 *
 * 把 M2 五个并行模块的实现零成本适配成 orchestrator/ports.ts 的五个端口并
 * 一处装配出完整 Orchestrator（ARCHITECTURE §4）：
 *  - SkillRuntimePort ← skills/runtime.ts（SkillRuntimeImpl）+ skills/registry.ts（四档即四域路由）
 *  - CloudClientPort   ← cloud/client.ts|mock（CloudLikeClient）+ escalation.ts（单次 pro 升级）
 *                          + context-builder 八段并段（④~⑧ 由本层拼接，①②③ 稳定前缀注入）
 *  - A2UiEmitterPort   ← BufferingA2UiEmitter（缓冲收集器，测试可断言；真 renderer 是 M3
 *                          a2ui/stream-parser 渐进写入入口，届时替换实现即可，端口不动）
 *  - ToolInvokerPort   ← NoopToolInvoker（真工具是 M6 tools/registry.ts）
 *  - StoragePort       ← storage/repos（Repositories；SessionEvent 流水落 session_events 集合）
 *
 * cloud 缺省走 createCloudClient()：cloud.local.json 缺失/无 Key 自动 Mock（D7），
 * 无需 API Key 即可全链路运行与测试。
 *
 * 位置说明：ARCHITECTURE §1 目录树未单列本文件——作为补位放在 src/composition.ts，
 * M4 页面装配若需更贴切的位置再迁移（提交信息已注明）。
 */
import { Orchestrator, type OrchestratorOptions } from './orchestrator/machine';
import type {
  A2UiEmitterPort,
  CloudClientPort,
  CloudStreamCallbacks,
  CloudTurnRequest,
  EscalationRequest,
  OrchestratorPorts,
  SkillManifestPort,
  SkillRuntimePort,
  StorageCommitPatch,
  StoragePort,
  StorageSnapshot,
  ToolInvokerPort,
} from './orchestrator/ports';
import { SkillRuntimeImpl, type SkillManifest } from './skills/runtime';
import { createSkillRegistry } from './skills/registry';
import type { SessionEvent } from './domain/events';
import { MAX_SESSION_SUMMARIES } from './domain/profile';
import type { CloudLikeClient } from './cloud/client';
import { createCloudClient, DEFAULT_BASE_URL, MODEL_FLASH, MODEL_PRO } from './cloud';
import type { CloudConfig } from './cloud/config';
import type { CloudRequestSegments, StableSegments } from './cloud/context-builder';
import { EscalationManager, FALLBACK_NEXT_STEP, type EscalationResult, type EscalationSignal } from './cloud/escalation';
import { BudgetGuard } from './cloud/budget';
import type { MockCloudClientOptions } from './cloud/mock';
import { Repositories } from './storage/repos';
import { SESSION_EVENTS_KEY, type Collections } from './storage/repos/collections';
import { createMemoryKVStore, type KVStore } from './storage/kv';
import { A2UIStreamParser, type A2UISurfaceSnapshot } from './a2ui/stream-parser';
import { createToolInvoker, createKvToolUsageStore, type ToolEvent } from './tools/registry';
import { createDeepSeekVisionClient } from './tools/vision';
import { detectSpeechBridge } from './tools/tts';
import { ALL_SEED_ALUS } from './pipeline/seeds';
import { createSkillUpdater } from './skills/updater';

// ── ①②③ 稳定前缀默认内容（M2 占位；M3 catalog 本体建成后替换 catalog 段）──

/** ① System 约束：跨所有请求字节级不变（ARCHITECTURE §5 段表）。 */
const DEFAULT_SYSTEM_PROMPT = [
  '你是通用学习 Agent 的教学引擎，负责讲解、出题与判定。',
  '硬约束：讲完必须自检；复习卡必须可判对错；输出必须为 A2UI v0.9 JSONL（surfaceUpdate.components[]，每行一个完整 JSON）。',
  '安全：适配学习者画像偏好边界；数据仅用于本次教学，不引导偏离学习目标的话题。',
].join('\n');

/** ② 心理学策略库要点（随产品版本变；禁止时间戳/随机 id）。 */
const DEFAULT_PSYCHOLOGY_LIBRARY = [
  '提取练习优于重读；间隔重复与交错抽取；模糊不记账但触发"再讲一遍"（D8）。',
  '正向反馈优先：判定对错先给按压反馈，再异步补判定文案（UID §5.4）。',
  '心流护栏：答得快又对升难度给变式；卡住先降难度给脚手架，不直接判错（§10.1③）。',
].join('\n');

/** ③ A2UI catalog 全量常驻（产品级常量；16 零件 JSON Schema M3 注入，此处为占位声明）。 */
const DEFAULT_CATALOG_PLACEHOLDER =
  '16 零件：ConceptCard/QuestionCard/RevealCard/MapView/ProgressRing/ExplainStep/ChoiceGrid/MicButton/TTSBar/FeedbackBar/SourceLink/DueChip/TodayPlanPanel/EntryCard/StreamSkeleton/SessionEndCard（JSON Schema M3 注入）';

/** 稳定前缀默认内容（①②③；字节级稳定，吃 DeepSeek 硬盘缓存，§7.6）。 */
export const DEFAULT_STABLE_SEGMENTS: StableSegments = {
  system: DEFAULT_SYSTEM_PROMPT,
  psychologyLibrary: DEFAULT_PSYCHOLOGY_LIBRARY,
  catalog: DEFAULT_CATALOG_PLACEHOLDER,
};

// ── A2UiEmitterPort：缓冲收集器（M2-int 原始形态，保留供纯收集测试）──

/** A2UI 缓冲收集器：收集 emit 的 JSONL 片段，flush 按批归档并清空（测试可断言）。 */
export class BufferingA2UiEmitter implements A2UiEmitterPort {
  /** 当前回合已 emit、尚未 flush 的片段。 */
  private pending: string[] = [];
  /** 每次 flush 归档一批（[] 表示空 flush 也记次）。 */
  readonly batches: string[][] = [];

  emit(jsonlChunk: string): void {
    this.pending.push(jsonlChunk);
  }

  flush(): void {
    this.batches.push([...this.pending]);
    this.pending = [];
  }

  /** 当前未 flush 的片段（只读视图）。 */
  get buffered(): readonly string[] {
    return this.pending;
  }
}

// ── A2UiEmitterPort：组合发射器（M4 T1：渐进解析 + 批归档，双语义）──

/**
 * A2UI 组合发射器（M4 T1 装配产物）：emit 同时喂 A2UIStreamParser（UI 渐进渲染，
 * stream-parser.ts 自研 renderer 的唯一入口）并归档批；flush 收尾解析并按批归档。
 * 归档语义与 BufferingA2UiEmitter 完全一致（integration.test emitter.batches
 * 断言不变：每回合一批、批内全为 surfaceUpdate 行）；渲染语义由 parser 承担。
 */
export class ParsingA2UiEmitter implements A2UiEmitterPort {
  /** 当前回合已 emit、尚未 flush 的片段。 */
  private pending: string[] = [];
  /** 每次 flush 归档一批（[] 表示空 flush 也记次）。 */
  readonly batches: string[][] = [];

  constructor(private readonly parser: A2UIStreamParser) {}

  emit(jsonlChunk: string): void {
    this.pending.push(jsonlChunk);
    this.parser.feed(jsonlChunk);
  }

  flush(): void {
    this.parser.flush();
    this.batches.push([...this.pending]);
    this.pending = [];
  }

  /** 当前未 flush 的片段（只读视图）。 */
  get buffered(): readonly string[] {
    return this.pending;
  }

  /** 当前 surface 快照（parser 透传；Session 页 useA2UIStream 直接订阅 parser）。 */
  get snapshot(): A2UISurfaceSnapshot {
    return this.parser.getSnapshot();
  }
}

// ── ToolInvokerPort：真工具注册表（M6）+ no-op 适配器（保留测试用）─────

/**
 * no-op 工具调用器：记录调用并返回 unsupported 错误结果。
 * M6 起 composition 默认装配真注册表（createToolInvoker），本类保留给测试直用。
 */
export class NoopToolInvoker implements ToolInvokerPort {
  /** 调用记录（测试断言 TTS/工具分派是否发生）。 */
  readonly calls: { name: string; args: unknown }[] = [];

  async callTool(name: string, args: unknown): Promise<unknown> {
    this.calls.push({ name, args });
    return {
      ok: false,
      error: 'unsupported',
      tool: name,
      detail: 'M6 tools/registry.ts 已接线；本类仅测试用（composition 默认走真注册表）',
    };
  }
}

// ── SkillRuntimePort ← SkillRuntimeImpl + registry（四档即四域）───────

/** SkillManifest（runtime 形态，params 可选）→ SkillManifestPort（params 必填）：
 *  manifest 缺省 params 视为不可出卡（安全方向兜底）。 */
function toManifestPort(manifest: SkillManifest): SkillManifestPort {
  return {
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    mode: manifest.mode,
    promptTemplate: manifest.promptTemplate,
    components: manifest.components,
    tools: manifest.tools,
    params: manifest.params ?? { cardGeneration: false },
  };
}

/** 技能运行时端口适配：档位路由（registry）+ 正文按需装载（runtime）。 */
export function createSkillRuntimePort(
  runtime: SkillRuntimeImpl,
  registry: ReturnType<typeof createSkillRegistry> = createSkillRegistry(runtime),
): SkillRuntimePort {
  return {
    getActiveSkill: (mode) => toManifestPort(runtime.loadBody(registry.route(mode))),
    getBody: (name) => toManifestPort(runtime.loadBody(name)),
    listSummaries: () => runtime.listSummaries(),
  };
}

// ── CloudClientPort ← CloudLikeClient + escalation + context-builder ──

export interface CloudPortOptions {
  /** 底层客户端（CloudClient 或 MockCloudClient；D7 工厂产出）。 */
  client: CloudLikeClient;
  /** ①②③ 稳定前缀（字节级稳定；缺省 DEFAULT_STABLE_SEGMENTS）。 */
  stable?: StableSegments;
  /** 升级管理器（单次 pro + 去重 + 配额；缺省则每次直连 completeText）。 */
  escalation?: EscalationManager;
}

/**
 * 云侧端口适配器：CloudTurnRequest（④~⑧段+directives）→ 八段 CloudRequestSegments
 * → CloudLikeClient.streamChat；Promise 风格 → 回调风格（错误走 onError，不向上抛）。
 * directives 并入⑥段序列化：CONTRACTS §7 TaskInstruction 未设独立键，回合级指令与
 * 偏好边界同为硬约束语义 → 追加至 boundaries（M2 适配占位，契约扩展后迁移）。
 */
export class CloudClientPortAdapter implements CloudClientPort {
  private readonly client: CloudLikeClient;
  private readonly stable: StableSegments;
  private readonly escalation: EscalationManager | null;

  constructor(options: CloudPortOptions) {
    this.client = options.client;
    this.stable = options.stable ?? DEFAULT_STABLE_SEGMENTS;
    this.escalation = options.escalation ?? null;
  }

  stream(request: CloudTurnRequest, callbacks: CloudStreamCallbacks): void {
    const segments: CloudRequestSegments = {
      ...this.stable,
      skillTemplate: request.skillTemplate,          // ④ 当前档 Skill 模板
      profileFragment: request.profileFragment,      // ⑤ 画像最小片段（绝不进前缀）
      taskInstruction: {                              // ⑥ 每轮变
        ...request.taskInstruction,
        boundaries: [...request.taskInstruction.boundaries, ...request.directives],
      },
      history: request.history,                       // ⑦ 只追加
      retrieved: request.retrieved,                   // ⑧ 用完即弃
    };
    void this.client
      .streamChat({ segments, callbacks: { onTextDelta: (delta) => callbacks.onChunk(delta) } })
      .then(
        (result) => callbacks.onDone({ usage: result.usage, modelUsed: result.modelUsed }),
        (err: unknown) =>
          callbacks.onError(err instanceof Error ? err : new Error(String(err), { cause: err })),
      );
  }

  async escalate(request: EscalationRequest, signal: EscalationSignal): Promise<EscalationResult> {
    if (this.escalation !== null) {
      const outcome = await this.escalation.escalate(signal, request);
      if (outcome.escalated) return outcome.result;
      // 会话内重复信号或配额尽：拿兜底建议切回 flash 继续执行（不留空 nextStep）
      return { nextStep: FALLBACK_NEXT_STEP, loggedToFacts: false };
    }
    const { text } = await this.client.completeText({
      prompt: [
        '你是教学督导（Advisor 模式）。当前 Flash 模型在教学中卡死，给出"下一步怎么做"的一条可执行建议。',
        `卡在: ${request.stuckAt}`,
        `目标: ${request.goal}`,
        `当前档位: ${request.skill}`,
      ].join('\n'),
      modelRole: 'pro',
    });
    const trimmed = text.trim();
    return { nextStep: trimmed.length > 0 ? trimmed : FALLBACK_NEXT_STEP, loggedToFacts: true };
  }
}

// ── StoragePort ← Repositories（回合边界批量落盘 §7.7）──────────────

/**
 * 仓库层端口适配：loadSnapshot=冷启动全量读；commit=回合边界批量落盘
 * （profile/alu_state/review_log/session_summaries 经 saveAll 一次写，
 * SessionEvent 流水追加至 session_events 集合，§7.8④ 埋点同源）。
 */
export class RepositoriesStoragePort implements StoragePort {
  constructor(private readonly repos: Repositories) {}

  async loadSnapshot(): Promise<StorageSnapshot> {
    const [alus, aluStates, profile] = await Promise.all([
      this.repos.listAlus(),
      this.repos.listAluStates(),
      this.repos.loadProfile(),
    ]);
    return { alus, aluStates, profile };
  }

  async commit(patch: StorageCommitPatch): Promise<void> {
    const collections: Partial<Collections> = {};
    if (patch.profile !== undefined) collections.profile = patch.profile;
    if (patch.aluStates !== undefined) collections.alu_state = patch.aluStates;
    if (patch.reviewLogAppend !== undefined && patch.reviewLogAppend.length > 0) {
      // 追加式（机器侧已滤 fuzzy/revoked，D8）；读旧拼新一次写
      collections.review_log = [...await this.repos.listReviewLog(), ...patch.reviewLogAppend];
    }
    if (patch.sessionSummary !== undefined) {
      collections.session_summaries = [...await this.repos.listSessionSummaries(), patch.sessionSummary]
        .slice(-MAX_SESSION_SUMMARIES); // 截尾保留最近 N（CONTRACTS §4）
    }
    await this.repos.saveAll(collections);

    // SessionEvent 流水（session_events 集合，追加式；CONTRACTS §10 未列，
    // StorageCommitPatch.events 的落点补位，同 skill_packs 追加先例）
    if (patch.events !== undefined && patch.events.length > 0) {
      const raw = await this.repos.kv.get(SESSION_EVENTS_KEY);
      let log: SessionEvent[] = [];
      if (raw !== null) {
        try {
          log = JSON.parse(raw) as SessionEvent[];
        } catch {
          log = []; // 集合损坏 → 从空重记（事件流水可丢不可阻）
        }
      }
      await this.repos.kv.set(SESSION_EVENTS_KEY, JSON.stringify([...log, ...patch.events]));
    }
  }
}

// ── 种子灌库（M7 T1：首启接线）────────────────────────────────────

/**
 * 首启种子灌库（M7 T1）：把 M5 种子包的 ALU 幂等写入 alu 主数据集合——
 * 逐 id 比对，已有数据一律不覆盖（幂等），返回本次新增条数（0 = 库中已齐）。
 * 调用时机：App 冷启动 boot 判定 isFirstRun 成立后（App.tsx 接线）。
 */
export async function seedFirstRunContent(repos: Repositories): Promise<number> {
  const existing = await repos.listAlus();
  const additions = ALL_SEED_ALUS.filter((alu) => existing[alu.id] === undefined);
  if (additions.length === 0) return 0;
  const merged: Record<string, (typeof ALL_SEED_ALUS)[number]> = { ...existing };
  for (const alu of additions) merged[alu.id] = alu;
  await repos.saveAll({ alu: merged });
  return additions.length;
}

// ── 一处装配（composition root 本体）───────────────────────────────

/** tool_call/tool_result 流水追加（session_events 集合；与 StoragePort.events 同一落点，可丢不可阻）。 */
async function appendToolEvent(kv: KVStore, event: ToolEvent): Promise<void> {
  try {
    const raw = await kv.get(SESSION_EVENTS_KEY);
    let log: unknown[] = [];
    if (raw !== null) {
      try {
        log = JSON.parse(raw) as unknown[];
      } catch {
        log = [];
      }
    }
    await kv.set(SESSION_EVENTS_KEY, JSON.stringify([...log, event]));
  } catch {
    // 事件流水失败不阻塞工具调用
  }
}

export interface CompositionOptions {
  /** KV 桥；缺省内存实现（web 预览/测试）。真机由宿主注入 Native KV（§12 方案 A）。 */
  kv?: KVStore;
  /** 云侧客户端；缺省 createCloudClient()（cloud.local.json 缺失/无 Key → 自动 Mock，D7）。 */
  cloud?: CloudLikeClient;
  /** ①②③ 稳定前缀；缺省 DEFAULT_STABLE_SEGMENTS（M3 catalog 注入后替换）。 */
  stable?: StableSegments;
  /** 工具调用器覆写（测试注入 fake）；缺省 M6 真注册表（tools/registry.ts）。 */
  tools?: ToolInvokerPort;
  /** 时钟注入（测试）。 */
  now?: () => Date;
  /** Orchestrator 选项透传（纠偏上限等）。 */
  orchestrator?: OrchestratorOptions;
  /** Mock 模式参数（延迟/升级应答注入；仅未显式注入 cloud 时生效）。 */
  mockOptions?: MockCloudClientOptions;
}

/** 装配产物：machine + 五端口 + 各实现句柄（测试灌种子/断言用）。 */
export interface AppMachine {
  /** 装配完成的主状态机（boot/openSession/runTurn/notifySessionEnd 全路径可用）。 */
  orchestrator: Orchestrator;
  ports: OrchestratorPorts;
  /** A2UI 组合发射器（emit 渐进喂 parser + batches 逐回合归档）。 */
  emitter: ParsingA2UiEmitter;
  /** A2UI 流解析器（M4 Session 页 useA2UIStream(a2uiParser) 订阅渐进快照）。 */
  a2uiParser: A2UIStreamParser;
  /** 工具调用器（M6 真注册表：白名单/限额/offline 标注 + tool 事件流水；createToolInvoker 产物含 descriptors）。 */
  tools: ToolInvokerPort;
  /** 存储端口适配器。 */
  storage: RepositoriesStoragePort;
  /** 底层仓库（灌种子/断言集合用）。 */
  repos: Repositories;
  /** 底层云侧客户端（Mock 时可断言 calls）。 */
  cloud: CloudLikeClient;
  /** 技能运行时端口。 */
  skills: SkillRuntimePort;
  /** 技能运行时本体（D3 热更新 applyOverrides/hydrateFromStorage 入口）。 */
  runtime: SkillRuntimeImpl;
  /** D3 热更新客户端（checkAndApplyFromSettings：App 冷启动后台检查 + ProfilePage 保存端点后即时检查）。 */
  skillUpdater: ReturnType<typeof createSkillUpdater>;
}

/**
 * 一处装配出完整 machine 实例：storage（Repositories+KV）→ skills（runtime+registry，
 * 含 D3 热包冷启动装配）→ cloud（①②③前缀 + streamChat + escalation 配额护栏）→
 * emitter/tools → Orchestrator。所有依赖经 ports 注入，机器本体零实现耦合。
 */
export async function createAppMachine(options: CompositionOptions = {}): Promise<AppMachine> {
  const kv = options.kv ?? createMemoryKVStore();
  const repos = new Repositories(kv);
  const runtime = new SkillRuntimeImpl();
  await runtime.hydrateFromStorage(kv); // D3：冷启动装配热更新已应用包（缺失/损坏 → 内置兜底）
  const skills = createSkillRuntimePort(runtime);

  let visionCloudConfig: CloudConfig;
  let cloud: CloudLikeClient;
  if (options.cloud !== undefined) {
    cloud = options.cloud;
    visionCloudConfig = { apiKey: '', baseUrl: DEFAULT_BASE_URL, modelFlash: MODEL_FLASH, modelPro: MODEL_PRO, mock: true, source: 'none' };
  } else {
    const created = await createCloudClient({ mockOptions: options.mockOptions });
    cloud = created.client;
    visionCloudConfig = created.config;
  }
  const escalation = new EscalationManager({
    client: cloud,
    budget: new BudgetGuard({ repos, now: options.now }),
  });
  const cloudPort = new CloudClientPortAdapter({
    client: cloud,
    ...(options.stable !== undefined ? { stable: options.stable } : {}),
    escalation,
  });

  const a2uiParser = new A2UIStreamParser();
  const emitter = new ParsingA2UiEmitter(a2uiParser);
  // M7 T3b：web_search 可配置后端（settings 配 endpoint+key；空=工具返回 not-configured
  // 业务失败不抛错）。settings 在装配时读一次（KV 持久化），运行期改配置重启生效。
  const settings = await repos.loadSettings();
  const searchBackend =
    settings.webSearchEndpoint !== undefined && settings.webSearchEndpoint.trim() !== ''
      ? {
          endpoint: settings.webSearchEndpoint.trim(),
          ...(settings.webSearchKey !== undefined && settings.webSearchKey !== '' ? { apiKey: settings.webSearchKey } : {}),
        }
      : undefined;
  // M6：真工具注册表（白名单/限额/offline 标注）替换 NoopToolInvoker；tool_call/tool_result
  // 流水桥接进 session_events 集合（与 SessionEvent 同源落盘，可丢不可阻）。
  // 识图端口与云侧配置同源（Mock 模式下识图请求返回明确 unavailable，recognizeImage 兜底成结果对象）。
  const tools: ToolInvokerPort = options.tools
    ?? createToolInvoker({
      vision: createDeepSeekVisionClient(visionCloudConfig),
      speechBridge: detectSpeechBridge(),
      usage: createKvToolUsageStore(kv),
      onEvent: (event: ToolEvent) => {
        void appendToolEvent(kv, event);
      },
      ...(searchBackend !== undefined ? { search: searchBackend } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
  const storage = new RepositoriesStoragePort(repos);
  const skillUpdater = createSkillUpdater(runtime, kv);

  const ports: OrchestratorPorts = { skills, cloud: cloudPort, emitter, tools, storage };
  const orchestratorOpts: OrchestratorOptions = options.orchestrator
    ?? (options.now !== undefined ? { now: options.now } : {});
  const orchestrator = new Orchestrator(ports, orchestratorOpts);
  return { orchestrator, ports, emitter, a2uiParser, tools, storage, repos, cloud, skills, runtime, skillUpdater };
}
