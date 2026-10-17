import '@lynx-js/preact-devtools';
import '@lynx-js/react/debug';
import { root } from '@lynx-js/react';

import { App } from './App.js';
import { CLOUD_GLOBAL_INJECTION_KEY } from './cloud/config.js';

// 构建期注入的本地云配置（Key 通道，仅本地 dev）：真机/浏览器无 fs → 读不到 cloud.local.json，
// 由 lynx.config.ts 在构建时把该文件内容注入 __EDU_BUILD_CLOUD_LOCAL__，这里塞进 config.ts 认的注入点。
// 缺失/undefined → 不赋值 → loadCloudConfig 回落 Mock（无 Key 全链路仍可跑）。
if (typeof __EDU_BUILD_CLOUD_LOCAL__ !== 'undefined') {
  (globalThis as unknown as Record<string, unknown>)[CLOUD_GLOBAL_INJECTION_KEY] = __EDU_BUILD_CLOUD_LOCAL__;
}

root.render(<App />);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
