/**
 * 临时配置：只用于在 Windows/浏览器里跑 Web 预览（截图核验首屏）。
 * 与仓库 lynx.config.ts 无关，核验完即删——不进版本库、不改正式构建配置。
 */
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    web: {
      output: { distPath: { root: './dist/web-preview' } },
    },
  },
  plugins: [pluginReactLynx()],
});
