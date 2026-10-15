/**
 * 技能包运行时（CONTRACTS §6 唯一接口依据；ARCHITECTURE §8 ①层/§11；PRD §7.2/§7.8①）。
 * 装载协议：name+description 常驻窗口（轻量索引），正文 promptTemplate 按需加载（loadBody/getBody 惰性物化）；
 * 来源优先级：热更新已应用包 > 内置包（版本比较与选择；内置随 App 升级始终兜底，D3）。
 */
import type { KnowledgeSkillName, SkillName, SkillParams } from '../domain/types';
import type { KVStore } from '../storage/kv';
import { SKILL_PACKS_KEY } from '../storage/repos/collections';
import { BUILT_IN_PACKS } from './packs';

/** 工具名（CONTRACTS §6；注册表实现在 M6 tools/registry.ts）。 */
export type ToolName = 'web_search' | 'vision_capture' | 'tts_speak' | 'asr_transcribe';

/** 组件名——暂置类型（CONTRACTS §5 16 零件；最终归属 src/a2ui/catalog.ts，M3 建立时自此迁移，同 domain/types.ts 暂置模式）。 */
export type ComponentName =
  | 'ConceptCard' | 'QuestionCard' | 'RevealCard' | 'MapView' | 'ProgressRing'
  | 'ExplainStep' | 'ChoiceGrid' | 'MicButton' | 'TTSBar' | 'FeedbackBar'
  | 'SourceLink' | 'DueChip' | 'TodayPlanPanel' | 'EntryCard' | 'StreamSkeleton'
  | 'SessionEndCard';

/** 技能包 manifest（CONTRACTS §6）。catalog 不内嵌：components 仅按名引用（§7.2，避免打散缓存前缀）。 */
export interface SkillManifest {
  name: SkillName | KnowledgeSkillName;
  description: string;         // 何时用（SKILL.md frontmatter 原文；§7.8① description 写"何时用"）
  version: string;             // 版本号（热更新版本比对用；D3 通道见 updater.ts）
  mode: 'pattern' | 'knowledge';   // 四模式档 vs 知识库（score-boost）
  promptTemplate: string;      // SKILL.md 正文 → 云侧上下文第④段（换档失效边界）
  tools: ToolName[];           // 所需工具声明（§7.2）
  components: ComponentName[]; // 对本档所用组件的按名引用列表（§7.2）
  params?: SkillParams;        // 深度参数 + 时长预算（quick 一批两用切换，§3 档1）
  references?: string[];       // references/ 资源清单装载路径（搜索起始白名单，§4.4）
}

/** 运行时装载协议（§7.8①：name+description 常驻窗口、正文按需加载）。 */
export interface SkillRuntime {
  listSummaries(): SkillSummary[];                             // 常驻：{name, description}
  loadBody(name: SkillName | KnowledgeSkillName): SkillManifest;  // 按需
}
export interface SkillSummary { name: string; description: string }

/** 装载资产形态：summary 进常驻索引；body（正文+references 原文）按需取，不占常驻窗口。 */
export interface PackSummary {
  name: SkillName | KnowledgeSkillName;
  description: string;
  version: string;
  mode: 'pattern' | 'knowledge';
  tools: ToolName[];
  components: ComponentName[];
  params?: SkillParams;
  references?: string[];
}
export interface PackBody {
  promptTemplate: string;                 // SKILL.md 正文原样
  referenceContents: Record<string, string>;  // references/*.md 原样（key=装载路径）
}
export interface PackAsset {
  summary: PackSummary;
  loadBody(): PackBody;
}

/** 热更新已应用包（runtime 内存覆盖层；含远端可携带的 references 原文）。 */
export interface OverridePack extends SkillManifest {
  referenceContents?: Record<string, string>;
}

/** 语义化版本比较：a>b→1、相等→0、a<b→-1（逐段数值比较；热更新"只升不降"判定用）。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number(s) || 0);
  const pb = b.split('.').map((s) => Number(s) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** 已应用包最小合法性（hydrate 读存储时防脏数据；完整校验在 updater 下载侧）。 */
function isValidInstalledPack(p: unknown): p is OverridePack {
  if (typeof p !== 'object' || p === null) return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.name === 'string' && typeof r.promptTemplate === 'string' &&
    typeof r.version === 'string' && typeof r.description === 'string' &&
    (r.mode === 'pattern' || r.mode === 'knowledge')
  );
}

/**
 * 技能包运行时实现。
 * listSummaries 仅暴露 {name, description}（轻量索引常驻）；正文经 loadBody 按需物化并缓存；
 * overrides 为热更新已应用包层（优先于内置；App 升级使内置版本更高时拒用旧热包）。
 */
export class SkillRuntimeImpl implements SkillRuntime {
  private readonly assets: ReadonlyMap<SkillName | KnowledgeSkillName, PackAsset>;
  private readonly bodies = new Map<SkillName | KnowledgeSkillName, SkillManifest>();
  private readonly overrides = new Map<SkillName | KnowledgeSkillName, OverridePack>();

  constructor(packs: PackAsset[] = BUILT_IN_PACKS) {
    this.assets = new Map(packs.map((p) => [p.summary.name, p]));
  }

  /** 常驻窗口：仅 name+description（§7.8①）；热包 description 覆盖内置。 */
  listSummaries(): SkillSummary[] {
    return [...this.assets.values()].map((p) => ({
      name: p.summary.name,
      description: this.overrides.get(p.summary.name)?.description ?? p.summary.description,
    }));
  }

  /** 按需装载正文（§7.8①）：热更新已应用包 > 内置包；首次物化后缓存。 */
  loadBody(name: SkillName | KnowledgeSkillName): SkillManifest {
    const cached = this.bodies.get(name);
    if (cached !== undefined) return cached;
    const manifest = this.materialize(name);
    this.bodies.set(name, manifest);
    return manifest;
  }

  /** getBody 为 loadBody 的同义别名（CONTRACTS §6 定名 loadBody，二者等价）。 */
  getBody(name: SkillName | KnowledgeSkillName): SkillManifest {
    return this.loadBody(name);
  }

  /** 装载协议内省：正文是否已物化（未请求的包不占 body 缓存）。 */
  isBodyLoaded(name: SkillName | KnowledgeSkillName): boolean {
    return this.bodies.has(name);
  }

  /** references 原文按需取（§4.4 搜索起始白名单）：热包携带原文优先，缺省回落内置。 */
  loadReferenceContent(name: SkillName | KnowledgeSkillName, refPath: string): string {
    const override = this.overrides.get(name);
    if (override?.referenceContents?.[refPath] !== undefined) return override.referenceContents[refPath];
    const asset = this.assets.get(name);
    return asset !== undefined ? (asset.loadBody().referenceContents[refPath] ?? '') : '';
  }

  /** 当前生效版本（updater 比对基线）：热包优先，否则内置。 */
  installedVersion(name: SkillName | KnowledgeSkillName): string {
    return this.overrides.get(name)?.version ?? this.assets.get(name)?.summary.version ?? '';
  }

  /** 应用热更新包（updater 成功后 / hydrate 冷启动时调用）。版本比较与选择：
   *  不低于内置版本才接受（热更新已应用包 > 内置包，平版本热包胜）；已存在更高热包时不降级。 */
  applyOverrides(packs: OverridePack[]): void {
    for (const incoming of packs) {
      const existing = this.overrides.get(incoming.name);
      if (existing !== undefined && compareVersions(incoming.version, existing.version) < 0) continue;
      const builtin = this.assets.get(incoming.name);
      if (builtin !== undefined && compareVersions(incoming.version, builtin.summary.version) < 0) continue;
      this.overrides.set(incoming.name, incoming);
      this.bodies.delete(incoming.name); // 正文缓存失效，下次 loadBody 重新物化
    }
  }

  /** 冷启动：从 skill_packs 集合装配已应用热更新包（D3；集合损坏则忽略、内置兜底）。 */
  async hydrateFromStorage(kv: KVStore): Promise<void> {
    const raw = await kv.get(SKILL_PACKS_KEY);
    if (raw === null) return;
    let installed: Record<string, unknown>;
    try {
      installed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // 损坏 → 走内置兜底
    }
    const packs: OverridePack[] = [];
    for (const key of Object.keys(installed)) {
      const p = installed[key];
      if (isValidInstalledPack(p)) packs.push(p);
    }
    this.applyOverrides(packs);
  }

  private materialize(name: SkillName | KnowledgeSkillName): SkillManifest {
    const override = this.overrides.get(name);
    if (override !== undefined) {
      const { referenceContents: _drop, ...manifest } = override;
      return manifest;
    }
    const asset = this.assets.get(name);
    if (asset === undefined) throw new Error(`未知技能包: ${name}`);
    const body = asset.loadBody();
    return { ...asset.summary, promptTemplate: body.promptTemplate };
  }
}
