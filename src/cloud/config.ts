/**
 * 云侧配置（M2c，CONTRACTS §7 / ARCHITECTURE §7 / PRD §7.6）。
 * 模型名集中常量（用户裁决 D2：Key 到位后核实实际 API 模型名，届时只改此处，不动架构）；
 * API Key 与 base URL 从本地配置文件 edu-agent/cloud.local.json 读取（D7：V1 直连 DeepSeek，
 * 测试 Key 本地配置，不进代码库）——文件缺失或 key 为空 → 自动进入 Mock 模式（无 Key 全链路可开发可测）。
 * DeepSeek 走 OpenAI 兼容接口：POST {base}/chat/completions，原生 fetch，不引 SDK。
 */

/** 默认（flash）模型名：承担 95%+ 日常生成。D2 已实测核实（GET /models）：deepseek-flash（显示名 DeepSeek-V4.1-Flash，支持图像输入，M6 识图可用）。 */
export const MODEL_FLASH = 'deepseek-flash';
/** 卡死升级（pro）模型名。D2 已实测核实：deepseek-v4-pro。 */
export const MODEL_PRO = 'deepseek-v4-pro';

/** DeepSeek OpenAI 兼容端点（不含 /chat/completions 后缀）。 */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

/** 本地配置文件名（工程根 edu-agent/ 下；必须在 .gitignore 中，模板见 cloud.local.example.json）。 */
export const CLOUD_LOCAL_FILENAME = 'cloud.local.json';

/** cloud.local.json 形状（模板字段；多余字段忽略）。 */
export interface CloudLocalFile {
  apiKey?: string;
  baseUrl?: string;
  /** 可选覆盖模型名（D2 核实前默认用常量）。 */
  modelFlash?: string;
  modelPro?: string;
}

/** 运行时配置。mock=true 表示无 Key，走 MockCloudClient（D7）。 */
export interface CloudConfig {
  apiKey: string;
  baseUrl: string;
  modelFlash: string;
  modelPro: string;
  /** true = 无 Key，自动 Mock。 */
  mock: boolean;
  /** 配置来源：'file'（cloud.local.json）/ 'global'（宿主注入）/ 'none'（缺失 → Mock）。 */
  source: 'file' | 'global' | 'none';
}

/** 解析 cloud.local.json 文本；null / 非法 JSON → null（进入 Mock）。 */
export function parseCloudLocalFile(raw: string | null): CloudLocalFile | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as CloudLocalFile;
  } catch {
    return null;
  }
}

/** 文件内容 → 运行时配置。key 为空（或缺失）→ mock=true（§7.6 用户零配置、无 Key 可跑全链路）。 */
export function resolveCloudConfig(file: CloudLocalFile | null, source: CloudConfig['source']): CloudConfig {
  const apiKey = typeof file?.apiKey === 'string' ? file.apiKey.trim() : '';
  return {
    apiKey,
    baseUrl: (file?.baseUrl ?? '').trim() || DEFAULT_BASE_URL,
    modelFlash: (file?.modelFlash ?? '').trim() || MODEL_FLASH,
    modelPro: (file?.modelPro ?? '').trim() || MODEL_PRO,
    mock: apiKey === '',
    source,
  };
}

/** 宿主/测试注入点：globalThis.__EDU_CLOUD_LOCAL__ = { apiKey, baseUrl, ... }（Lynx 侧无 fs 时由宿主设置）。 */
export const CLOUD_GLOBAL_INJECTION_KEY = '__EDU_CLOUD_LOCAL__';

/**
 * 读 cloud.local.json 文本。仅 Node（开发/测试）环境可用——经 Function 构造的动态
 * import 引 node:fs，bundler 静态分析不到（不打进 Lynx 产物）；任何失败 → null。
 */
export async function readCloudLocalFileRaw(path: string): Promise<string | null> {
  try {
    const dynamicImport = new Function('p', 'return import(p)') as (p: string) => Promise<{
      readFileSync: (p: string, encoding: string) => string;
    }>;
    const fs = await dynamicImport('node:fs');
    return fs.readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

export interface LoadCloudConfigOptions {
  /** 配置文件路径；默认进程工作目录下 CLOUD_LOCAL_FILENAME。 */
  path?: string;
  /** 注入读取器（测试用）；返回 null 表示文件缺失。 */
  read?: (path: string) => string | null;
}

/** 加载配置：globalThis 注入优先，其次本地文件；缺失/为空 Key → mock=true。 */
export async function loadCloudConfig(options: LoadCloudConfigOptions = {}): Promise<CloudConfig> {
  const g = globalThis as unknown as Record<string, unknown>;
  const injected = g[CLOUD_GLOBAL_INJECTION_KEY];
  if (injected !== null && injected !== undefined && typeof injected === 'object') {
    return resolveCloudConfig(injected as CloudLocalFile, 'global');
  }
  const path = options.path ?? CLOUD_LOCAL_FILENAME;
  const raw = options.read !== undefined ? options.read(path) : await readCloudLocalFileRaw(path);
  const file = parseCloudLocalFile(raw);
  return resolveCloudConfig(file, file === null ? 'none' : 'file');
}
