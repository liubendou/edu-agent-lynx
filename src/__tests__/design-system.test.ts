// M2b 设计系统测试：theme 三档判定/参数表、motion 常量与 UID 附录一致性、
// 亮暗读取机制、CSS token 数值落地（fs 读文件断言，数值逐字对齐 UID）。
import { expect, test } from '@rstest/core';
import { readFileSync } from 'node:fs';

import {
  DIRECTION_LOCK_PX,
  DISABLED_OPACITY,
  LONG_PRESS_MS,
  PRESS_SCALE,
  SPRING_BASE,
  SPRING_LARGE,
  STAGGER_INTERVAL_MS,
  STAGGER_MAX_ITEMS,
  SWIPE_THRESHOLD_RATIO,
  TAP_DEBOUNCE_MS,
  THROTTLE_DRAG_MS,
  THROTTLE_HIGH_FREQ_MS,
  TOUCH_TARGET_MIN,
} from '../design-system/motion.js';
import {
  readColorScheme,
  resolveThemeTier,
  themeClassName,
  tierParams,
} from '../design-system/theme.js';

const css = (name: string) =>
  readFileSync(new URL(`../design-system/${name}`, import.meta.url), 'utf8');

// ── 降级三档判定（UID §7.4）──

test('resolveThemeTier: reduce-motion wins as static, perf signals reduce, else full', () => {
  expect(resolveThemeTier({ reduceMotion: false, lowEndDevice: false, powerSave: false, sustainedJank: false })).toBe('full');
  expect(resolveThemeTier({ reduceMotion: false, lowEndDevice: true, powerSave: false, sustainedJank: false })).toBe('reduced');
  expect(resolveThemeTier({ reduceMotion: false, lowEndDevice: false, powerSave: true, sustainedJank: false })).toBe('reduced');
  expect(resolveThemeTier({ reduceMotion: false, lowEndDevice: false, powerSave: false, sustainedJank: true })).toBe('reduced');
  expect(resolveThemeTier({ reduceMotion: true, lowEndDevice: false, powerSave: false, sustainedJank: false })).toBe('static');
  // 无障碍设置压倒性能档
  expect(resolveThemeTier({ reduceMotion: true, lowEndDevice: true, powerSave: true, sustainedJank: true })).toBe('static');
});

test('tierParams(reduced): durations x0.6, stagger/shake/blur off, direct manipulation kept', () => {
  const p = tierParams('reduced');
  expect(p.tier).toBe('reduced');
  expect(p.durationScale).toBe(0.6); // 时长打六折
  expect(p.stagger).toBe(false);
  expect(p.shake).toBe(false);
  expect(p.blur).toBe(false); // 毛玻璃关闭
  expect(p.directManipulation).toBe(true); // 跟手保留：核心手感，不能砍
  expect(p.springSnap).toBe(true);
  expect(p.opacityOnlyMs).toBeNull();
});

test('tierParams(static): opacity-only 120ms, no spring snap, 1:1 drag kept, haptics kept (D1)', () => {
  const p = tierParams('static');
  expect(p.tier).toBe('static');
  expect(p.opacityOnlyMs).toBe(120); // 只留 120ms 透明度切换
  expect(p.springSnap).toBe(false); // 取消弹性吸附
  expect(p.directManipulation).toBe(true); // 跟手位移仍 1:1
  expect(p.durationScale).toBeNull(); // 不做时长缩放：除透明度外全停
  expect(p.stagger).toBe(false);
  expect(p.shake).toBe(false);
  expect(p.blur).toBe(false);
  expect(p.haptics).toBe(true); // D1：静止档仍保留触觉
});

test('tierParams(full): everything on, scale 1', () => {
  const p = tierParams('full');
  expect(p.durationScale).toBe(1);
  expect(p.stagger).toBe(true);
  expect(p.shake).toBe(true);
  expect(p.blur).toBe(true);
  expect(p.directManipulation).toBe(true);
  expect(p.springSnap).toBe(true);
  expect(p.opacityOnlyMs).toBeNull();
  expect(p.haptics).toBe(true);
});

// ── motion 常量与 UID 附录一致性 ──

test('motion.ts constants match UID appendix table verbatim', () => {
  expect(SPRING_BASE).toEqual({ stiffness: 320, damping: 30, mass: 1 }); // 弹簧（基准）
  expect(SPRING_LARGE.stiffness).toBe(200); // 弹簧（大面积归位）
  expect(SPRING_LARGE.damping).toBe(26);
  expect(LONG_PRESS_MS).toBe(350); // 长按阈值
  expect(SWIPE_THRESHOLD_RATIO).toBe(0.3); // 滑动判定阈值：卡宽 30%
  expect(DIRECTION_LOCK_PX).toBe(8); // 方向锁定 8px
  expect(STAGGER_INTERVAL_MS).toBe(40); // stagger 40ms/条
  expect(STAGGER_MAX_ITEMS).toBe(6); // 上限 6 条
  expect(TAP_DEBOUNCE_MS).toBe(300); // 连点防抖
  expect(THROTTLE_DRAG_MS).toBe(50); // 拖拽/滚动上报节流
  expect(THROTTLE_HIGH_FREQ_MS).toBe(16); // 高频展示类节流
  expect(TOUCH_TARGET_MIN).toBe(44); // 触摸目标 44×44
  expect(DISABLED_OPACITY).toBe(0.38); // 禁用态透明度
  expect(PRESS_SCALE).toBe(0.97); // 按下反馈
});

// ── 亮暗主题（TS 侧方案：lynx.__globalProps.appTheme，见 theme.ts 查证注释）──

test('readColorScheme follows host-injected appTheme, defaults to light', () => {
  const g = globalThis as { lynx?: { __globalProps: { appTheme?: string } } };
  const original = g.lynx;
  try {
    g.lynx = { __globalProps: { appTheme: 'dark' } };
    expect(readColorScheme()).toBe('dark');
    g.lynx = { __globalProps: { appTheme: 'light' } };
    expect(readColorScheme()).toBe('light');
    g.lynx = { __globalProps: {} };
    expect(readColorScheme()).toBe('light'); // 未注入默认亮色（纸）
    delete g.lynx;
    expect(readColorScheme()).toBe('light'); // 无宿主（测试环境）不抛错
  } finally {
    if (original === undefined) delete g.lynx;
    else g.lynx = original;
  }
  expect(themeClassName('dark')).toBe('theme-dark');
  expect(themeClassName('light')).toBe('theme-light');
});

// ── CSS 数值落地（数值逐字对齐 UID §1.1 / 附录）──

test('tokens.css: full paper-and-ink palette light+dark, spacing grid, radii', () => {
  const s = css('tokens.css');
  // 亮色（纸）
  expect(s).toContain('--ambient: #F6F3EC');
  expect(s).toContain('--surface: #FDFBF6');
  expect(s).toContain('--faint: #E4DED2');
  expect(s).toContain('--ink: #221D18');
  expect(s).toContain('--ink-soft: #6B6259');
  expect(s).toContain('--accent: #2E4A6E');
  expect(s).toContain('--good: #3E6B4C');
  expect(s).toContain('--warn: #A5761F');
  expect(s).toContain('--bad: #A5402F');
  // 暗色
  expect(s).toContain('--ambient: #17140F');
  expect(s).toContain('--surface: #221D16');
  expect(s).toContain('--faint: #332C22');
  expect(s).toContain('--ink: #EDE7DC');
  expect(s).toContain('--ink-soft: #A69C8D');
  expect(s).toContain('--accent: #7FA0C8');
  expect(s).toContain('--good: #7FAE8C');
  expect(s).toContain('--warn: #CFA152');
  expect(s).toContain('--bad: #D07A69');
  // veil 补位已注明 UID 未给值
  expect(s).toContain('--veil:');
  expect(s).toContain('UID 未给值，蓝图补位');
  // 间距栅格 4/8/12/16/24/32
  for (const [name, px] of [['--space-1', '4px'], ['--space-2', '8px'], ['--space-3', '12px'], ['--space-4', '16px'], ['--space-6', '24px'], ['--space-8', '32px']] as const) {
    expect(s).toContain(`${name}: ${px}`);
  }
  // 圆角 8/12/16/999
  expect(s).toContain('--radius-s: 8px');
  expect(s).toContain('--radius-m: 12px');
  expect(s).toContain('--radius-l: 16px');
  expect(s).toContain('--radius-pill: 999px');
});

test('typography.css + motion.css: type scale, line-height, durations and M3 curves verbatim', () => {
  const t = css('typography.css');
  // 字阶 13/16/18/20/28；正文行高 1.75；字重 400/600；中文栈
  expect(t).toContain('font-size: 13px');
  expect(t).toContain('font-size: 16px');
  expect(t).toContain('font-size: 18px');
  expect(t).toContain('font-size: 20px');
  expect(t).toContain('font-size: 28px');
  expect(t).toContain('line-height: 1.75');
  expect(t).toContain("font-family: system-ui, 'PingFang SC', 'Noto Sans SC'");
  expect(t.match(/font-weight: 400/g)).toHaveLength(2); // 正文+辅助
  expect(t.match(/font-weight: 600/g)).toHaveLength(3); // 三个标题档
  expect(t).toContain('Noto Serif SC'); // 衬线注释开关存在且默认注释

  const m = css('motion.css');
  // 时长 token 90/120/180/240/320，退出 200
  expect(m).toContain('--dur-press: 90ms');
  expect(m).toContain('--dur-select: 120ms');
  expect(m).toContain('--dur-grow: 180ms');
  expect(m).toContain('--dur-switch: 240ms');
  expect(m).toContain('--dur-page: 320ms');
  expect(m).toContain('--dur-exit: 200ms');
  // M3 spatial（带过冲）/ effects（不过冲）两族曲线，逐字
  expect(m).toContain('cubic-bezier(0.27, 1.06, 0.18, 1.00)');
  expect(m).toContain('--dur-spatial: 500ms');
  expect(m).toContain('--dur-spatial-fast: 350ms');
  expect(m).toContain('cubic-bezier(0.31, 0.94, 0.34, 1.00)');
  expect(m).toContain('--dur-effects: 200ms');
  expect(m).toContain('--dur-effects-fast: 150ms');
  // ease-in 只用于退出；静止档 120ms 透明度
  expect(m).toContain('--ease-exit: ease-in');
  expect(m).toContain('--dur-static-opacity: 120ms');
});
