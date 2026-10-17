/**
 * motion.ts —— "冷白极简"设计系统 · 动效 TS 常量（参数表逐字保留）
 * 冷白重构 v1：只动视觉（tokens.css/typography.css），本文件对外导出签名与数值不变，
 * 以免消费方（src/App.tsx 等）受影响。
 *
 * 消费方：
 *  - `@lynx-js/motion/mini`（import 路径见 docs/04_依赖锁定清单.md §2，~135KB 仅数值）：
 *    弹簧参数对象形状与 motion spring 选项兼容（stiffness / damping / mass）。
 *  - 主线程脚本（'main thread' 指令函数）：阈值 / 防抖 / 节流常量。
 *  - 降级档调整（时长六折、关 stagger 等）不在此文件——见 theme.ts tierParams()，
 *    组件按档取用时对本表数值做乘算/开关。
 */

/** 弹簧（基准）：stiffness 320 / damping 30 / mass 1（UID 附录） */
export const SPRING_BASE = { stiffness: 320, damping: 30, mass: 1 } as const;

/**
 * 弹簧（大面积归位）：stiffness 200 / damping 26（UID 附录）。
 * mass UID 未给，取 Motion 默认 1（与基准一致），非自创值。
 */
export const SPRING_LARGE = { stiffness: 200, damping: 26, mass: 1 } as const;

/** 长按阈值 350ms（UID §5.2 / §八：与 lynx-ui Draggable 长按档对齐，全站唯一标准） */
export const LONG_PRESS_MS = 350;

/** 滑动判定阈值：卡片宽度的 30%；滑不够回中、不算数（UID §5.2 / 附录） */
export const SWIPE_THRESHOLD_RATIO = 0.3;

/** 拖拽方向锁定：位移超过 8px 且主轴确定后锁定（UID §5.2 / 附录） */
export const DIRECTION_LOCK_PX = 8;

/** stagger 间隔 40ms/条（UID 附录） */
export const STAGGER_INTERVAL_MS = 40;

/** stagger 只对首 6 条生效（UID §八：长列表逐条入场会把首屏拖慢） */
export const STAGGER_MAX_ITEMS = 6;

/** 连点防抖：同一语义动作 300ms 内只认一次（UID 附录） */
export const TAP_DEBOUNCE_MS = 300;

/** 跨线程上报节流：拖拽/滚动类 ≥ 1 次/50ms（UID §7.2 禁令7 / 附录） */
export const THROTTLE_DRAG_MS = 50;

/** 跨线程上报节流：高频展示类上限 1 次/16ms（UID 附录） */
export const THROTTLE_HIGH_FREQ_MS = 16;

/** 触摸目标不小于 44×44（UID 附录；无障碍最小可点区域） */
export const TOUCH_TARGET_MIN = 44;

/** 禁用态：透明度 0.38，无按下反馈（UID 附录） */
export const DISABLED_OPACITY = 0.38;

/** 按下反馈 scale 0.97（UID §5.2 / 附录；配 motion.css --dur-press 90ms） */
export const PRESS_SCALE = 0.97;
