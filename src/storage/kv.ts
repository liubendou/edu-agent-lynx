/**
 * KV 桥（CONTRACTS §10 / ARCHITECTURE §12 方案 A）：
 * 优先 NativeModules.StorageModule（Android SharedPreferences，签名见 docs/03 §4；
 * NativeModules 为 Lynx 后台线程全局变量，经 globalThis 探测以兼容 web/测试环境）；
 * 检测不到原生模块时自动切换内存 Map fallback——保证 npm test 与 web 预览可跑。
 */

/** KV 桥：Native StorageModule（Android SharedPreferences/内部文件）的 JS 封装。
 *  候选实现见 ARCHITECTURE §12；接口固定，底层可换。 */
export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** docs/03 §4 的原生侧 JS 调用签名。 */
export interface StorageModuleLike {
  setItem(key: string, value: string): void;
  getItem(key: string, callback: (value: string | null) => void): void;
  removeItem(key: string): void;
  getAllKeys(callback: (keys: string[]) => void): void;
}

/** 探测 Lynx 原生 StorageModule（后台线程全局 NativeModules；不存在或形状不符 → null）。 */
export function detectNativeStorage(): StorageModuleLike | null {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const nativeModules = g['NativeModules'] as Record<string, unknown> | undefined;
    const mod = nativeModules?.['StorageModule'] as Partial<StorageModuleLike> | undefined;
    if (
      mod
      && typeof mod.setItem === 'function'
      && typeof mod.getItem === 'function'
      && typeof mod.removeItem === 'function'
      && typeof mod.getAllKeys === 'function'
    ) {
      return mod as StorageModuleLike;
    }
  } catch {
    // 任何探测异常都回落内存实现
  }
  return null;
}

/** 内存 KV fallback（web 预览 / 测试环境）。 */
export function createMemoryKVStore(): KVStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
    async keys() {
      return Array.from(map.keys());
    },
  };
}

/** 原生 StorageModule → KVStore 适配（异步回调包装；setItem/removeItem 为 fire-and-forget，docs/03 §4）。 */
export function createNativeKVStore(mod: StorageModuleLike): KVStore {
  return {
    get(key) {
      return new Promise((resolve) => {
        mod.getItem(key, (value) => resolve(value));
      });
    },
    async set(key, value) {
      mod.setItem(key, value);
    },
    async remove(key) {
      mod.removeItem(key);
    },
    keys() {
      return new Promise((resolve) => {
        mod.getAllKeys((ks) => resolve(ks));
      });
    },
  };
}

/** 创建 KV 实例：原生 StorageModule 优先，检测不到自动切内存 fallback。 */
export function createKVStore(): KVStore {
  const native = detectNativeStorage();
  return native ? createNativeKVStore(native) : createMemoryKVStore();
}
