/**
 * haptics —— 触觉封装（D1 全站两触发点；UID §7.4 触觉保留）：
 *  - hapticSnap()：吸附到位（RevealCard 上滑揭晓松手吸附/滑动作答越阈吸附）；
 *  - hapticJudge(grade)：判定对错到达（correct=success / wrong=error / fuzzy=selection，
 *    "模糊"不记账，只给轻确认不弹心理）。
 *
 * 门控：tierParams(resolveThemeTier(signals)).haptics（theme.ts）——三档全保留触觉
 * （D1：动效可关、触觉补位互补），门控为结构性占位，未来档位表调整即生效。
 * 后端可注入（测试断言调用点/参数）；缺省 @sigx/lynx-haptics 真实现（M6 绑定确认）——
 * JS 侧 impact/notification/selection 与包 API 逐字对齐；宿主无 Haptics 模块
 * （web 预览/未捆绑构建）静默 no-op 绝不抛错（包内保证）。
 * M6 已在 Android 宿主注册原生 HapticsModule（EduAgentApplication + gradle srcDirs 指向
 * node_modules/@sigx/lynx-haptics/android + VIBRATE 权限），真机手感与档位联动 M7 回归。
 */
import { Haptics, type ImpactStyle, type NotificationType } from '@sigx/lynx-haptics';
import { resolveThemeTier, tierParams, type TierSignals } from '../design-system/theme';
import type { Grade } from '../domain/types';

/** 触觉后端（@sigx/lynx-haptics 的 Haptics 结构子集；测试注入记录器）。 */
export interface HapticsBackend {
  impact(style?: ImpactStyle): void;
  notification(type?: NotificationType): void;
  selection(): void;
}

let backend: HapticsBackend = Haptics;

/** 注入触觉后端（测试）；传 null 恢复真实现。 */
export function setHapticsBackend(next: HapticsBackend | null): void {
  backend = next ?? Haptics;
}

/** 档位门控信号（M4 默认 full；reduceMotion 宿主接线后由调用方注入，M7 校准）。 */
let signals: TierSignals = { reduceMotion: false, lowEndDevice: false, powerSave: false, sustainedJank: false };

/** 注入门控信号（测试/宿主接线）；传 null 恢复默认。 */
export function setHapticsSignals(next: TierSignals | null): void {
  signals = next ?? { reduceMotion: false, lowEndDevice: false, powerSave: false, sustainedJank: false };
}

function enabled(): boolean {
  return tierParams(resolveThemeTier(signals)).haptics;
}

/** D1 ① 吸附到位：轻拍一下（light），不抢判定触觉的戏。 */
export function hapticSnap(): void {
  if (!enabled()) return;
  backend.impact('light');
}

/** D1 ② 判定对错：对=success、错=error、模糊=selection（轻确认）。 */
export function hapticJudge(grade: Grade): void {
  if (!enabled()) return;
  if (grade === 'correct') backend.notification('success');
  else if (grade === 'wrong') backend.notification('error');
  else backend.selection();
}
