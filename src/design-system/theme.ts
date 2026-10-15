/**
 * theme.ts —— "纸与墨"设计系统 · 降级三档判定与亮暗主题（UID §7.4；ARCHITECTURE §1/§16 D1）
 * M2b 2026-10-15。
 *
 * 降级三档（UID §7.4）：
 *   完整（默认）  全部动画加弹簧、stagger、毛玻璃
 *   精简          低端机、省电模式、检测到持续抖动 → 关 stagger 和抖动、时长打六折、
 *                 跟手保留（核心手感不能砍）、毛玻璃关闭
 *   静止          系统"减少动态效果" → 只留 120ms 透明度切换；跟手位移仍 1:1、
 *                 取消弹性吸附；触觉保留（D1：动效可关、触觉补位互补）
 *
 * 线程与稳定性纪律（UID §7.4）：判定和切换都在后台线程做（本文件全部纯函数，
 * 在 React 运行时即后台线程调用）；切换只改时长/开关类参数，不动布局属性，
 * 不引起界面跳动。消费方（组件/主线程脚本）按 TierParams 取参。
 *
 * 检测信号采集（M2b 查证结论，2026-10-15）：
 *  - Lynx SystemInfo 字段仅 engineVersion/osVersion/pixelWidth/pixelHeight/platform/runtimeType，
 *    无 theme、reduceMotion、内存/核数字段（官方 SystemInfo 文档核实）。
 *  - reduceMotion：Android 宿主读系统动画缩放类设置后写入 AppSettings.reduceMotion
 *    （CONTRACTS §10 已有该字段），JS 侧从 settings 仓库读。
 *  - 设备分级：先按内存/核数粗规则（宿主侧采集注入），M7 中低端机实测校准。
 *  - 亮暗：见下方 readColorScheme 注释。
 */

/** 降级三档（UID §7.4） */
export type ThemeTier = 'full' | 'reduced' | 'static';

/** 亮暗（同一套语义 token 的两套值，见 tokens.css） */
export type ColorScheme = 'light' | 'dark';

/** 档位判定输入信号 */
export interface TierSignals {
  /** 系统"减少动态效果"（宿主写入 AppSettings.reduceMotion，见文件头注） */
  reduceMotion: boolean;
  /** 低端机（内存/核数粗规则，M7 实测校准） */
  lowEndDevice: boolean;
  /** 省电模式 */
  powerSave: boolean;
  /** 检测到持续抖动（帧间隔方差监控，UID §7.3 口径） */
  sustainedJank: boolean;
}

/** 各档生效参数表（供组件消费；数值出处 UID §7.4） */
export interface TierParams {
  tier: ThemeTier;
  /** 定时动画时长缩放：完整 1、精简 0.6（打六折）、静止 null（不缩放，直接只剩透明度切换） */
  durationScale: number | null;
  /** stagger（40ms/条、上限 6 条，见 motion.ts）：精简/静止关 */
  stagger: boolean;
  /** 抖动类位移动画：精简/静止关（UID §7.4 精简档"关掉 stagger 和抖动"） */
  shake: boolean;
  /** 毛玻璃（<blur-view>，只用两处：顶部状态区/底部常驻栏，UID §八）：精简/静止关 */
  blur: boolean;
  /** 跟手 1:1：三档全保留（UID §7.4：这是核心手感，不能砍；静止档跟手位移仍 1:1） */
  directManipulation: boolean;
  /** 松手弹性吸附（弹簧）：静止档取消（取消弹性吸附），完整/精简保留 */
  springSnap: boolean;
  /** 静止档仅剩的透明度切换时长 120ms；其余档 null（按 motion.css token 走） */
  opacityOnlyMs: number | null;
  /** 触觉保留（D1：吸附到位/判定对错两处；静止档关位移仍保留触觉） */
  haptics: boolean;
}

/** 档位判定（纯函数，后台线程调用）。优先级：无障碍设置（静止）> 性能信号（精简）> 完整 */
export function resolveThemeTier(signals: TierSignals): ThemeTier {
  if (signals.reduceMotion) return 'static';
  if (signals.lowEndDevice || signals.powerSave || signals.sustainedJank) {
    return 'reduced';
  }
  return 'full';
}

/** 各档参数表（UID §7.4 逐条落地；Record 全量常驻，切档不重建对象） */
const TIER_PARAMS: Record<ThemeTier, TierParams> = {
  full: {
    tier: 'full',
    durationScale: 1,
    stagger: true,
    shake: true,
    blur: true,
    directManipulation: true,
    springSnap: true,
    opacityOnlyMs: null,
    haptics: true,
  },
  reduced: {
    tier: 'reduced',
    durationScale: 0.6,
    stagger: false,
    shake: false,
    blur: false,
    directManipulation: true, // 跟手保留：核心手感，不能砍
    springSnap: true,
    opacityOnlyMs: null,
    haptics: true,
  },
  static: {
    tier: 'static',
    durationScale: null,
    stagger: false,
    shake: false,
    blur: false,
    directManipulation: true, // 跟手位移仍 1:1
    springSnap: false, // 取消弹性吸附
    opacityOnlyMs: 120, // 只留 120ms 透明度切换（motion.css --dur-static-opacity）
    haptics: true, // D1：静止档保留触觉
  },
};

/** 取某档生效参数（返回冻结表中的引用，调用方不得原地修改） */
export function tierParams(tier: ThemeTier): TierParams {
  return TIER_PARAMS[tier];
}

/**
 * 亮暗检测（M2b 查证结论，2026-10-15）：
 *  - @media (prefers-color-scheme) 在 Lynx ≥ 4.0 语法可解析，但引擎默认不跟踪系统主题
 *    （恒 light），需宿主 native 侧接线包（如 @sigx/lynx-appearance）才会跟随；该包不在
 *    依赖锁定清单（docs/04），故不走 CSS media query。
 *  - 走官方 Theming 指南路径：宿主经 Lynx SDK 写 lynx.__globalProps.appTheme（JS 只读，
 *    更新触发 onGlobalPropsChanged 并整页重渲染，冷启动即有值、无闪白）。
 *  - 无宿主注入（测试/预览环境）默认亮色（纸）。
 */
export function readColorScheme(): ColorScheme {
  const g: { appTheme?: string } | undefined =
    typeof lynx !== 'undefined' ? lynx.__globalProps : undefined;
  return g?.appTheme === 'dark' ? 'dark' : 'light';
}

/** 亮暗 → tokens.css 根节点 class（根节点同时挂 "design-tokens <本值>"） */
export function themeClassName(scheme: ColorScheme): string {
  return scheme === 'dark' ? 'theme-dark' : 'theme-light';
}

/** 宿主注入的全局属性类型（官方 lynx-global-props 文档：客户端经 SDK 设置，JS 只读） */
declare module '@lynx-js/types' {
  interface GlobalProps {
    /** 系统主题，宿主写入（'light' | 'dark'），见 readColorScheme() */
    appTheme?: string;
  }
}
