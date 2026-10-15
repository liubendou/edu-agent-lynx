/**
 * 原生 sha256 摘要桥（M6/D3，StorageModule 先例追加 digest 能力）。
 *
 * M6 核实结论（lynxjs.org/next/llms.txt §18 后台线程 API 清单）：Lynx 后台线程暴露
 * fetch/NativeModules/setTimeout 等，**未暴露 Web Crypto（crypto.subtle）**——真机上
 * skills/updater.ts 的 hashHex 主路径走本桥（NativeModules.StorageModule.digestSha256Hex，
 * Kotlin MessageDigest 实现），crypto.subtle 保留给 Node 测试/web 预览，FNV 弱摘要仅作
 * fail-closed 兜底（与远端 sha256 永不相等 → 校验必然失败 → 拒用热更新，内置包兜底）。
 */
import type { StorageModuleLike } from './kv';

/** 原生摘要能力形状（StorageModule.digestSha256Hex；callback 单发）。 */
export interface DigestModuleLike extends StorageModuleLike {
  digestSha256Hex?(text: string, callback: (hex: string | null) => void): void;
}

/** 探测原生摘要桥（同 kv.ts 探测口径：globalThis.NativeModules + 形状核验）。 */
export function detectNativeDigest(): ((text: string) => Promise<string>) | null {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const mod = (g['NativeModules'] as Record<string, unknown> | undefined)?.['StorageModule'] as Partial<DigestModuleLike> | undefined;
    if (mod && typeof mod.digestSha256Hex === 'function') {
      const digest = mod.digestSha256Hex.bind(mod);
      return (text) => new Promise((resolve, reject) => {
        digest(text, (hex) => (typeof hex === 'string' && hex.length === 64
          ? resolve(hex)
          : reject(new Error('native digest failed'))));
      });
    }
  } catch {
    // 探测异常按无桥处理
  }
  return null;
}
