declare module '@lynx-js/types' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GlobalProps {
    /**
     * Define your global properties in this interface.
     * These types will be accessible through `lynx.__globalProps`.
     */
  }
}

/**
 * 构建期注入的本地云配置（Key 通道，仅本地 dev）：
 * 由 lynx.config.ts 从 edu-agent/cloud.local.json（gitignored）读出后经 source.define 注入；
 * 真机/浏览器没有 fs，读不到该文件，只能靠这条通道把 Key 送进运行时（config.ts 的
 * globalThis.__EDU_CLOUD_LOCAL__ 注入点由 src/index.tsx 用它赋值）。文件缺失/非法 → undefined → 回落 Mock。
 */
declare global {
  // eslint-disable-next-line no-var
  var __EDU_BUILD_CLOUD_LOCAL__:
    | { apiKey?: string; baseUrl?: string; modelFlash?: string; modelPro?: string }
    | undefined;
}

// This export makes the file a module
export {};
