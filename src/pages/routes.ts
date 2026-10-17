/**
 * 页面路由名（App.tsx 路由容器与各页面共享；单列流 + 顶部轻入口，无 TabBar，UID §八）。
 * `chat` = 唯一首屏（改造清单 §1：吸收 Home + Session 的对话页；体验脚本为准）。
 * `home` / `session` 暂留作回退对比，批次 3 渲染职责移交完成后清理。
 */
export type Route = 'chat' | 'home' | 'session' | 'map' | 'library' | 'profile' | 'growth';
