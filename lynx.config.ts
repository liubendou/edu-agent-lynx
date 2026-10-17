import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';

/**
 * 本地云配置（cloud.local.json，gitignored，含 Key）→ 构建期注入（仅本地 dev）。
 * 真机/浏览器运行时没有 fs，读不到该文件；注入后由 src/index.tsx 塞进
 * globalThis.__EDU_CLOUD_LOCAL__（cloud/config.ts 的注入点）。缺失/非法 JSON → 'undefined' → 回落 Mock。
 * 注意：Key 会随之进入 dev 产物，故只在本地 dev 使用，勿用于发布包。
 */
function readLocalCloudDefine(): string {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'cloud.local.json'), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? raw : 'undefined';
  } catch {
    return 'undefined';
  }
}

export default defineConfig({
  source: {
    define: {
      __EDU_BUILD_CLOUD_LOCAL__: readLocalCloudDefine(),
    },
  },
  plugins: [
    pluginQRCode({
      schema(url) {
        // We use `?fullscreen=true` to open the page in LynxExplorer in full screen mode
        return `${url}?fullscreen=true`;
      },
    }),
    pluginReactLynx(),
    pluginTypeCheck(),
  ],
});
