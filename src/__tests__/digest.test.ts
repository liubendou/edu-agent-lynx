// M6 原生摘要桥 + hashHex 三级路径单测（T4/T7）：
// ① 原生桥 NativeModules.StorageModule.digestSha256Hex（真机主路径）→ ② crypto.subtle（Node/web）
// → ③ FNV fail-closed。核实依据：lynxjs.org/next/llms.txt §18 后台线程 API 无 Web Crypto。
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test } from '@rstest/core';
import { detectNativeDigest } from '../storage/digest';
import { hashHex } from '../skills/updater';

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** 原生 StorageModule mock（digestSha256Hex 用 Node sha256 真算，模拟 Kotlin MessageDigest）。 */
function installNativeDigest(impl?: (text: string, cb: (hex: string | null) => void) => void): void {
  (globalThis as unknown as Record<string, unknown>)['NativeModules'] = {
    StorageModule: {
      digestSha256Hex: impl ?? ((text: string, cb: (hex: string | null) => void) => cb(sha256Hex(text))),
    },
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)['NativeModules'];
});

describe('M6 原生摘要桥（storage/digest.ts）', () => {
  test('探测：StorageModule.digestSha256Hex 形状齐备 → 返回摘要函数', () => {
    installNativeDigest();
    const digest = detectNativeDigest();
    expect(digest).not.toBeNull();
  });

  test('探测：无原生模块/形状不符 → null（web/Node 测试环境）', () => {
    expect(detectNativeDigest()).toBeNull();
    (globalThis as unknown as Record<string, unknown>)['NativeModules'] = { StorageModule: {} };
    expect(detectNativeDigest()).toBeNull();
  });

  test('摘要函数：与 Node sha256 一致（64 位小写 hex）', async () => {
    installNativeDigest();
    const digest = detectNativeDigest()!;
    expect(await digest('hello 热更新')).toBe(sha256Hex('hello 热更新'));
    expect((await digest('')).length).toBe(64);
  });

  test('摘要函数：原生回调 null / 非 64 位 → reject（fail-closed，不用弱值）', async () => {
    installNativeDigest((_t, cb) => cb(null));
    const digest = detectNativeDigest()!;
    await expect(digest('x')).rejects.toThrow('native digest failed');
    installNativeDigest((_t, cb) => cb('abc123'));
    await expect(detectNativeDigest()!('x')).rejects.toThrow('native digest failed');
  });

  test('探测异常（NativeModules 访问抛错）→ null 不抛', () => {
    (globalThis as unknown as Record<string, unknown>)['NativeModules'] = {
      get StorageModule(): unknown {
        throw new Error('bridge exploded');
      },
    };
    expect(detectNativeDigest()).toBeNull();
  });
});

describe('M6 hashHex 三级路径（skills/updater.ts）', () => {
  test('① 原生桥可用 → 主路径走 digestSha256Hex（真机口径）', async () => {
    installNativeDigest();
    expect(await hashHex('pack-content')).toBe(sha256Hex('pack-content'));
  });

  test('① 原生桥失败（回调 null）→ 落到 ② crypto.subtle，结果仍是真 sha256', async () => {
    installNativeDigest((_t, cb) => cb(null));
    expect(await hashHex('pack-content')).toBe(sha256Hex('pack-content'));
  });

  test('② 无原生桥 → crypto.subtle（Node 测试环境存在）', async () => {
    expect(await hashHex('pack-content')).toBe(sha256Hex('pack-content'));
  });

  test('③ FNV 兜底形态 fail-closed（仅 subtle 也不可用时；与 sha256 永不相等）', async () => {
    // 直接验证 FNV 分支算法形态（经 stub subtle=digest 抛错触发；globalThis.crypto 为 getter，需 defineProperty 覆盖）
    installNativeDigest((_t, cb) => cb(null));
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { subtle: { digest: () => Promise.reject(new Error('subtle unavailable')) } },
    });
    try {
      const hex = await hashHex('abc');
      expect(hex.startsWith('len3-fnv1a')).toBe(true);
      expect(hex).not.toBe(sha256Hex('abc'));
    } finally {
      if (originalDescriptor !== undefined) Object.defineProperty(globalThis, 'crypto', originalDescriptor);
    }
  });
});
