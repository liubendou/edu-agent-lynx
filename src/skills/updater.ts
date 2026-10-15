/**
 * 技能包热更新客户端（用户裁决 D3：V1 就要；CONTRACTS §6 协议唯一依据；ARCHITECTURE §11/§16-D3）。
 * 流程：读 AppSettings.skillUpdateManifestUrl → fetch 远端 manifest（版本清单）→ 与本地已装版本比对（只升不降）
 *  → 逐包下载 → sha256 校验 → 形状校验 → 全部就绪后整体原子写入 skill_packs 集合 → runtime.applyOverrides 注入。
 * 任一包失败 → 整体回滚（存储恢复应用前快照、runtime 不动，内置/既有热包兜底），返回 'rolled_back'。
 * 远端仅需静态托管（manifest JSON + 包 JSON），无需自建逻辑后端（开发期本地 fixture 端到端验证，M6 联网联调）。
 * 签名：V1 为 sha256 清单级校验（仅防传输损坏；manifest 本身未受哈希保护，防篡改依赖 ed25519 验签，M6 补）。
 */
import type { KnowledgeSkillName, SkillName } from '../domain/types';
import type { KVStore } from '../storage/kv';
import type { AppSettings, InstalledSkillPack } from '../storage/repos/collections';
import { DEFAULT_APP_SETTINGS, SKILL_PACKS_KEY } from '../storage/repos/collections';
import { COLLECTION_KEYS, createJsonCollection } from '../storage/repos/common';
import { BUILT_IN_PACK_MAP } from './packs';
import type { OverridePack } from './runtime';
import { compareVersions } from './runtime';

/** 远端 manifest：版本清单（CONTRACTS §6 逐字；远端静态托管的 JSON）。 */
export interface SkillPackRemoteManifest {
  packs: {
    name: SkillName | KnowledgeSkillName;
    version: string;              // 与内置 SkillManifest.version 比对
    url: string;                  // 包文件下载地址（静态托管）
    sha256: string;               // 完整性校验
    signature?: string;           // 可选签名校验（公钥随端点配置）
  }[];
  generatedAt: string;            // ISODate
}

/** 热更新端点（CONTRACTS §6 逐字）。 */
export interface SkillUpdateEndpoint { manifestUrl: string; publicKey?: string }

/** 热更新结果（CONTRACTS §6 逐字）：updated=至少一包应用 / skipped=无可更新且无变更 / rolled_back=任一失败整体回滚。 */
export type SkillUpdateResult = 'updated' | 'skipped' | 'rolled_back';

/** 热更新客户端接口（CONTRACTS §6 逐字）。 */
export interface SkillUpdater {
  /** 检查并应用更新；任一包校验/应用失败 → 整体回滚内置 packs，返回 'rolled_back' */
  checkAndApply(endpoint: SkillUpdateEndpoint): Promise<SkillUpdateResult>;
}

/** 可注入 fetch（参数化设计：测试注入 fixture、真机用全局 fetch；返回最小响应形状）。 */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * 签名校验器——ed25519 预留接口（M6 真实端点联调时接入实现并注入 createSkillUpdater）。
 * V1：manifest 带 signature 且端点带 publicKey 而 verifier 未注入时跳过强验签（V1 安全边界为 sha256 清单级校验，
 * 见文件头注释）；M6 接入后该组合改为 fail-closed。
 */
export interface SkillPackSignatureVerifier {
  verify(payload: string, signature: string, publicKey: string): Promise<boolean>;
}

export interface SkillUpdaterOptions {
  fetch?: FetchLike;                       // 默认探测全局 fetch，无则抛错 → checkAndApply 返回 'skipped'
  verifier?: SkillPackSignatureVerifier;   // ed25519 预留（M6）
  now?: () => string;                      // appliedAt 时间源（测试注入固定值）
}

/** updater 所需的 runtime 能力子集（SkillRuntimeImpl 满足；结构化依赖、不绑具体类）。 */
interface SkillRuntimeHost {
  installedVersion(name: SkillName | KnowledgeSkillName): string;
  applyOverrides(packs: OverridePack[]): void;
}

/** 组件/工具名合法集合——运行时侧严格校验（防远端脏数据注入非法组件名；M3 catalog 建立后常量自此迁移）。 */
const VALID_TOOLS: ReadonlySet<string> = new Set(['web_search', 'vision_capture', 'tts_speak', 'asr_transcribe']);
const VALID_COMPONENTS: ReadonlySet<string> = new Set([
  'ConceptCard', 'QuestionCard', 'RevealCard', 'MapView', 'ProgressRing',
  'ExplainStep', 'ChoiceGrid', 'MicButton', 'TTSBar', 'FeedbackBar',
  'SourceLink', 'DueChip', 'TodayPlanPanel', 'EntryCard', 'StreamSkeleton', 'SessionEndCard',
]);

/** 文本哈希（sha256 hex）。能力探测 + 降级：
 *  Web Crypto subtle.digest（Lynx 真机可用性 M6 核实）不可用时降级为"长度+FNV-1a 校验和"弱摘要。
 *  注意：降级摘要与远端 sha256 永不相等 → 校验必然失败 → fail-closed 拒用热更新、内置包兜底
 *  （宁可拒更新也不放行无法强校验的包；若 M6 核实真机无 subtle，再走协议变更让服务端提供降级校验字段）。 */
export async function hashHex(text: string): Promise<string> {
  try {
    const subtle = (globalThis as unknown as { crypto?: { subtle?: { digest(algo: string, data: Uint8Array): Promise<ArrayBuffer> } } }).crypto?.subtle;
    if (subtle !== undefined) {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // subtle 存在但调用失败（编码器缺失等）→ 走降级
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `len${text.length}-fnv1a${h.toString(16)}`;
}

/** 默认 fetch：探测全局 fetch（真机/Node 均有）；缺失时抛错，由 checkAndApply 捕获为 'skipped'。 */
const defaultFetch: FetchLike = (url) => {
  const f = (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (typeof f !== 'function') throw new Error('当前环境无 fetch 能力');
  return f(url);
};

function isValidRemoteManifest(m: unknown): m is SkillPackRemoteManifest {
  if (typeof m !== 'object' || m === null) return false;
  const packs = (m as { packs?: unknown }).packs;
  if (!Array.isArray(packs) || typeof (m as { generatedAt?: unknown }).generatedAt !== 'string') return false;
  return packs.every((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const r = e as Record<string, unknown>;
    return typeof r['name'] === 'string' && typeof r['version'] === 'string'
      && typeof r['url'] === 'string' && typeof r['sha256'] === 'string';
  });
}

/** 下载侧完整校验（CONTRACTS §6"任一包校验失败整体回滚"的守门员；runtime hydrate 仅做最小防脏）。 */
function isValidRemotePack(pack: unknown, entry: SkillPackRemoteManifest['packs'][number]): pack is OverridePack {
  if (typeof pack !== 'object' || pack === null) return false;
  const p = pack as Record<string, unknown>;
  // 与清单条目一致（防清单与包错位）
  if (p['name'] !== entry.name || p['version'] !== entry.version) return false;
  // 已知包 + mode 与内置一致（防篡改/错发：score-boost=knowledge、四档=pattern）
  const builtin = BUILT_IN_PACK_MAP.get(p['name'] as SkillName | KnowledgeSkillName);
  if (builtin === undefined || p['mode'] !== builtin.summary.mode) return false;
  // 正文与"何时用"非空（promptTemplate 为云侧第④段运行时提示词）
  if (typeof p['promptTemplate'] !== 'string' || p['promptTemplate'].length === 0) return false;
  if (typeof p['description'] !== 'string' || p['description'].length === 0) return false;
  // 声明字段严格白名单校验（非法组件/工具名 → 拒，渲染层不背锅）
  if (!Array.isArray(p['tools']) || !p['tools'].every((t) => typeof t === 'string' && VALID_TOOLS.has(t))) return false;
  if (!Array.isArray(p['components']) || !p['components'].every((c) => typeof c === 'string' && VALID_COMPONENTS.has(c))) return false;
  return true;
}

/** 应用前快照恢复（整体回滚的原子性保证；恢复失败时集合脏数据由 hydrate 最小校验挡下走内置兜底）。 */
async function restoreSnapshot(kv: KVStore, snapshotRaw: string | null): Promise<void> {
  try {
    if (snapshotRaw === null) await kv.remove(SKILL_PACKS_KEY);
    else await kv.set(SKILL_PACKS_KEY, snapshotRaw);
  } catch {
    // 回滚写失败：保持现状，hydrate 侧最小校验 + 内置包兜底
  }
}

/**
 * 创建热更新客户端。skill_packs 集合由本模块单点管理（先全部校验通过再整体原子写；
 * 不进 Repositories.saveAll/loadAll 批量落盘，见 collections.ts 注释）。
 */
export function createSkillUpdater(
  runtime: SkillRuntimeHost,
  kv: KVStore,
  options: SkillUpdaterOptions = {},
): SkillUpdater & { checkAndApplyFromSettings(): Promise<SkillUpdateResult> } {
  const doFetch = options.fetch ?? defaultFetch;
  const now = options.now ?? (() => new Date().toISOString());

  async function checkAndApply(endpoint: SkillUpdateEndpoint): Promise<SkillUpdateResult> {
    // ① 拉取远端 manifest（版本清单）。失败/坏形状 → 无变更 'skipped'（下次再试，不动任何本地状态）。
    let manifest: SkillPackRemoteManifest;
    try {
      const res = await doFetch(endpoint.manifestUrl);
      if (!res.ok) return 'skipped';
      const parsed: unknown = JSON.parse(await res.text());
      if (!isValidRemoteManifest(parsed)) return 'skipped';
      manifest = parsed;
    } catch {
      return 'skipped';
    }

    // ② 版本比对（只升不降）：热更新已应用包 > 内置包（runtime.installedVersion 给比对基线）；
    //    未知包名（不在内置 5 包中）直接跳过。
    const pendingEntries = manifest.packs.filter((e) =>
      BUILT_IN_PACK_MAP.has(e.name) && compareVersions(e.version, runtime.installedVersion(e.name)) > 0,
    );
    if (pendingEntries.length === 0) return 'skipped';

    // ③ 逐包下载 + sha256 校验 + 形状校验。任一失败 → 整体放弃（未写任何存储）→ 'rolled_back'
    //    （本地保持应用前状态：既有热包原样、无热包则内置兜底）。
    const pending: OverridePack[] = [];
    try {
      for (const entry of pendingEntries) {
        const res = await doFetch(entry.url);
        if (!res.ok) throw new Error(`包下载失败 ${entry.name}: HTTP ${res.status}`);
        const raw = await res.text();
        if ((await hashHex(raw)) !== entry.sha256) throw new Error(`sha256 校验失败 ${entry.name}`);
        let pack: unknown;
        try {
          pack = JSON.parse(raw);
        } catch {
          throw new Error(`包不是合法 JSON ${entry.name}`);
        }
        if (!isValidRemotePack(pack, entry)) throw new Error(`包形状校验失败 ${entry.name}`);
        // V1 签名：sha256 清单级校验已完成；ed25519 验签接口预留（verifier 未注入即跳过，M6 接入后 fail-closed）。
        if (options.verifier !== undefined && entry.signature !== undefined && endpoint.publicKey !== undefined) {
          if (!(await options.verifier.verify(raw, entry.signature, endpoint.publicKey))) {
            throw new Error(`签名校验失败 ${entry.name}`);
          }
        }
        pending.push(pack);
      }
    } catch {
      return 'rolled_back';
    }

    // ④ 整体原子写：合并既有集合 → 单次 kv.set（pending 全部就绪才写）；写失败 → 恢复应用前快照。
    const snapshotRaw = await kv.get(SKILL_PACKS_KEY);
    try {
      let installed: Record<string, InstalledSkillPack>;
      if (snapshotRaw !== null) {
        installed = JSON.parse(snapshotRaw) as Record<string, InstalledSkillPack>;
        if (typeof installed !== 'object' || installed === null) installed = {};
      } else {
        installed = {};
      }
      for (const pack of pending) {
        const entry = manifest.packs.find((e) => e.name === pack.name);
        installed[pack.name] = {
          name: pack.name,
          description: pack.description,
          version: pack.version,
          mode: pack.mode,
          promptTemplate: pack.promptTemplate,
          tools: [...pack.tools],
          components: [...pack.components],
          params: pack.params,
          references: pack.references !== undefined ? [...pack.references] : undefined,
          referenceContents: pack.referenceContents,
          sha256: entry?.sha256 ?? '',   // 应用时通过校验的清单哈希（审计留痕）
          appliedAt: now(),
        };
      }
      await kv.set(SKILL_PACKS_KEY, JSON.stringify(installed));
    } catch {
      await restoreSnapshot(kv, snapshotRaw);
      return 'rolled_back';
    }

    // ⑤ runtime 注入（热更新已应用包 > 内置包；写存储成功后才动内存，失败路径已全部前置）。
    runtime.applyOverrides(pending);
    return 'updated';
  }

  /** 读 AppSettings.skillUpdateManifestUrl（settings 仓库）→ 未配置 'skipped'；配置了 → checkAndApply。 */
  async function checkAndApplyFromSettings(): Promise<SkillUpdateResult> {
    const settings = (await createJsonCollection<AppSettings>(kv, COLLECTION_KEYS.settings).load())
      ?? { ...DEFAULT_APP_SETTINGS };
    if (settings.skillUpdateManifestUrl === undefined) return 'skipped';
    return checkAndApply({ manifestUrl: settings.skillUpdateManifestUrl });
  }

  return { checkAndApply, checkAndApplyFromSettings };
}
