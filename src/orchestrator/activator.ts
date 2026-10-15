/**
 * Skill 确定性激活（ARCHITECTURE §8③ 兜底层 / PRD §7.8③ / D8/D10）。
 * 决策已定档 → 直接激活对应 Skill，不经模型选择；用户点名 → 同样由调度器直连。
 * 硬规则代码强制（§7.9"能硬约束就别用软提示"）：
 *  1. quick 档禁用卡片生成 action（action 白名单里没有 card_generation）；
 *  2. card_generated 仅 standard/deep 会话可发（类型级 + 运行时双保险）；
 *  3. review 档 wrong → 自动注入 remediation 子会话（machine.ts 与 domain/session 共同落实）。
 */
import type { TodayDecision } from '../domain/decision';
import type { AluId, SkillName } from '../domain/types';
import type { SkillRuntimePort } from './ports';

/** 激活来源（§7.8④ 度量层埋点位）。 */
export type ActivationSource = 'deterministic' | 'named' | 'corrected' | 'fallback';

export interface ActivationResult {
  skill: SkillName;
  /** remediation 子会话标记（standard 档 90 秒补讲，挂主会话，F7） */
  mode: SkillName | 'remediation';
  source: ActivationSource;
  params: import('../skills/runtime').SkillParams;
  aluIds: AluId[];
  reason: string;
}

/** 硬规则2 类型级：能发 card_generated 的档位联合（CONTRACTS §9 事件契约一致）。 */
export type CardGeneratingSkill = 'standard-learning' | 'deep-learning';

// ── 决策 → 档位映射（确定性，D10 优先级已由 decision 落定）──

/** 各决策档的 SkillParams 覆盖（与技能包 manifest params 合成，硬规则1 优先）。 */
const DECISION_OVERRIDES: Record<
  TodayDecision['kind'],
  { skill: SkillName; mode: SkillName | 'remediation'; params?: import('../skills/runtime').SkillParams; reason: string }
> = {
  // 首启方案 D：20~30s 元课程小课 → quick 档（体验即教程，§6）；种子内容 M5 由 pipeline 提供
  first_run: {
    skill: 'quick-learning',
    mode: 'quick-learning',
    params: { goal: 'map', cardGeneration: false },
    reason: '首启：方案 D 元课程小课，quick 档建立认知地图',
  },
  review: {
    skill: 'review',
    mode: 'review',
    params: { cardGeneration: false },
    reason: '到期复习（R 升序）优先，一次只还 3~6 张',
  },
  // 复习答错待补 → standard 档 90 秒补讲（硬规则3；budgetMinutes≈90s）
  remediation: {
    skill: 'standard-learning',
    mode: 'remediation',
    params: { cardGeneration: false, budgetMinutes: [1, 2] },
    reason: '当日补讲：standard 档 90 秒',
  },
  // 新学默认 standard（§5.6"默认进入哪一档"由画像+目标调，V1 默认标准档）
  new_learn: {
    skill: 'standard-learning',
    mode: 'standard-learning',
    params: { cardGeneration: true },
    reason: '新学建议：标准档讲完即自检、出卡入队',
  },
};

/** 决策已定档 → 直接激活（不经模型）。合成 manifest params 后按硬规则1 强制 quick=false。 */
export function activateForDecision(
  decision: TodayDecision,
  skills: SkillRuntimePort,
): ActivationResult {
  const mapping = DECISION_OVERRIDES[decision.kind];
  const manifest = skills.getActiveSkill(mapping.mode);
  // manifest params 为底、决策覆盖为面；硬规则1 代码强制：quick 恒禁卡片生成
  const merged: import('../skills/runtime').SkillParams = {
    ...manifest.params,
    ...(mapping.params ?? {}),
    ...(mapping.skill === 'quick-learning' ? { cardGeneration: false } : {}),
  };
  const aluIds: AluId[] =
    decision.kind === 'review'
      ? decision.batch.map((q) => q.aluId)
      : decision.kind === 'remediation'
        ? [...decision.aluIds]
        : decision.kind === 'new_learn' && decision.suggestion.aluId !== undefined
          ? [decision.suggestion.aluId]
          : [];
  return {
    skill: mapping.skill,
    mode: mapping.mode,
    source: 'deterministic',
    params: merged,
    aluIds,
    reason: mapping.reason,
  };
}

// ── 用户点名直连（优先级链：用户点名 > description 强匹配 > 默认流程，§7.8②）──

/** 点名关键词表（确定性规则路由，零模型参与；"都不匹配就不硬凑"）。 */
const MENTION_KEYWORDS: ReadonlyArray<{ skill: SkillName; words: readonly string[] }> = [
  { skill: 'review', words: ['复习', '回顾', '还欠账', '还卡'] },
  { skill: 'quick-learning', words: ['快速', '过一遍', '唤醒', '扫一眼', '地图'] },
  { skill: 'deep-learning', words: ['深挖', '吃透', '高质量', '深究', '费曼'] },
  { skill: 'standard-learning', words: ['标准', '系统学', '补讲', '好好学'] },
];

/** 用户点名（"复习一下"）→ 同样直连激活；无命中返回 null（走默认流程，不硬凑）。 */
export function activateByMention(
  text: string,
  skills: SkillRuntimePort,
): ActivationResult | null {
  for (const entry of MENTION_KEYWORDS) {
    if (entry.words.some((w) => text.includes(w))) {
      const manifest = skills.getActiveSkill(entry.skill);
      const isRemediation = entry.skill === 'standard-learning' && text.includes('补讲');
      return {
        skill: entry.skill,
        mode: isRemediation ? 'remediation' : entry.skill,
        source: 'named',
        params: {
          ...manifest.params,
          ...(entry.skill === 'quick-learning' ? { cardGeneration: false } : {}), // 硬规则1
          ...(isRemediation ? { cardGeneration: false, budgetMinutes: [1, 2] as [number, number] } : {}),
        },
        aluIds: [],
        reason: `用户点名（命中关键词，直连 ${entry.skill}）`,
      };
    }
  }
  return null;
}

// ── 硬规则1：action 白名单（quick 档没有 card_generation）──

/** 会话内机器可分派的 action 类别（云侧产出/机器动作的结构化枚举）。 */
export type SessionActionKind =
  | 'a2ui_render'      // A2UI 消息流下发
  | 'tool_call'        // 工具调用
  | 'tts'              // TTS 指令
  | 'self_check'       // 讲完即问（自检）
  | 'variant'          // 变式（升难度给变式）
  | 'scaffold'         // 脚手架（卡住先降难度）
  | 'card_generation';  // 生成复习卡（standard/deep 专属）

/** 各档 action 白名单（硬规则1：quick 档列表里没有 card_generation）。 */
export const ACTION_WHITELIST: Readonly<Record<SkillName, readonly SessionActionKind[]>> = {
  'quick-learning': ['a2ui_render', 'tool_call', 'tts'],
  review: ['a2ui_render', 'tool_call', 'tts', 'self_check', 'variant', 'scaffold'],
  'standard-learning': ['a2ui_render', 'tool_call', 'tts', 'self_check', 'variant', 'scaffold', 'card_generation'],
  'deep-learning': ['a2ui_render', 'tool_call', 'tts', 'self_check', 'variant', 'scaffold', 'card_generation'],
};

/** 硬规则1 运行时强制：白名单外 action 拒绝（card_generation 在 quick 恒 false）。 */
export function isActionAllowed(skill: SkillName, action: SessionActionKind): boolean {
  return ACTION_WHITELIST[skill].includes(action);
}

/** 断言版（越权即抛错；machine 分派前调用）。 */
export function assertActionAllowed(skill: SkillName, action: SessionActionKind): void {
  if (!isActionAllowed(skill, action)) {
    throw new Error(`action '${action}' forbidden in skill '${skill}' (硬规则1：quick 档禁用卡片生成)`);
  }
}

// ── 硬规则2：card_generated 档位守卫（类型级；运行时由 domain/session.emitCardGenerated 双保险）──

/** 类型级收窄：只有 CardGeneratingSkill 能走出卡路径。 */
export function asCardGeneratingSkill(skill: SkillName): CardGeneratingSkill | null {
  return skill === 'standard-learning' || skill === 'deep-learning' ? skill : null;
}
