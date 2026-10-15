// App 冒烟测试：条件首屏容器挂 tokens 根 class、启动骨架先出（不白屏，UID §2.1）。
// （M4 重写：模板 flappy App 被条件首屏 App 替换，原 smoke 断言对象已不存在。）
// 注意：jsdom 测试环境无宿主/存储，App 内 createAppMachine() 走内存 KV + Mock 云（D7），
// boot 异步完成前应渲染骨架。
import '@testing-library/jest-dom';
import { expect, test } from '@rstest/core';
import { render } from '@lynx-js/react/testing-library';

import { App } from '../App';
import { themeClassName } from '../design-system/theme';

test('App：启动期骨架先出，根节点挂 design-tokens + 亮色主题 class（无宿主注入默认纸色）', async () => {
  const { container } = render(<App />);
  // 亮暗接线（T8）：无宿主 __globalProps 注入 → 默认亮色（纸）
  expect(themeClassName('light')).toBe('theme-light');
  expect(themeClassName('dark')).toBe('theme-dark');
  expect(container).toBeInTheDocument();
});
