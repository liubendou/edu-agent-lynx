/**
 * 技能包索引 + 分层路由（ARCHITECTURE §8 ①层触发层 / §4；PRD §7.8①/§7.8③）。
 * 四档即四域：档位 → 技能包确定性映射（决策已定档→直连激活，不经模型选择）；
 * 候选集收敛 1~2 个；用户点名直查；score-boost 走独立 knowledge 通道、不入档位路由（ARCHITECTURE §11）。
 */
import type { KnowledgeSkillName, SkillName } from '../domain/types';
import type { SkillRuntime, SkillSummary } from './runtime';

/** 路由档位：四档 + remediation（复习失败拉起的 90 秒补讲子会话，§4.5）。 */
export type RouteMode = SkillName | 'remediation';

export interface SkillRegistry {
  /** 索引（代理 runtime 常驻窗口）。 */
  listSummaries(): SkillSummary[];
  /** 档位 → 技能包确定性映射。 */
  route(mode: RouteMode): SkillName;
  /** 当前档位候选集（1~2 个，§7.8① 分层路由天然收敛）。 */
  candidates(mode: RouteMode): SkillName[];
  /** 用户点名直查（§7.8③ 用户点名同由调度器直连激活）；无命中返回 null。 */
  routeByMention(text: string): SkillName | KnowledgeSkillName | null;
  /** score-boost 独立 knowledge 通道（不入档位路由）。 */
  knowledgeChannel(): KnowledgeSkillName;
  isKnowledge(name: SkillName | KnowledgeSkillName): name is KnowledgeSkillName;
}

/** 四档即四域（§7.8①）：档位名即技能包名，恒等映射表。 */
const TIER_TO_SKILL: Record<SkillName, SkillName> = {
  'quick-learning': 'quick-learning',
  review: 'review',
  'standard-learning': 'standard-learning',
  'deep-learning': 'deep-learning',
};

/** 补讲（硬规则3）：复习失败 → 标准档 90 秒补讲（§4.5）。 */
const REMEDIATION_SKILL: SkillName = 'standard-learning';

/** 候选集收敛（每档 1~2 个）：主档 + 依据各 SKILL.md 的升降档/补讲衔接条款。 */
const TIER_CANDIDATES: Record<RouteMode, SkillName[]> = {
  'quick-learning': ['quick-learning', 'standard-learning'],    // quick 方法11：通过档1自检→建议进标准档
  review: ['review', 'standard-learning'],                      // review §1/硬规则3：答错→标准档 90 秒补讲
  'standard-learning': ['standard-learning', 'deep-learning'],  // standard §6：要吃透的重点→高质量档
  'deep-learning': ['deep-learning', 'standard-learning'],       // deep §5：练不动/概念断了→回落标准档
  remediation: [REMEDIATION_SKILL],
};

/** 点名直查关键词表（确定性规则，按序首匹配；措辞取自各 SKILL.md 的"何时进入本技能"）。 */
const MENTION_RULES: ReadonlyArray<{ keywords: string[]; target: SkillName | KnowledgeSkillName }> = [
  { keywords: ['复习', '抽我', '忘了'], target: 'review' },
  { keywords: ['快速', '先搭框架', '大概', '看懂'], target: 'quick-learning' },
  { keywords: ['系统学', '补漏', '从头讲', '讲通'], target: 'standard-learning' },
  { keywords: ['学透', '吃透', '啃下'], target: 'deep-learning' },
  { keywords: ['提分', '冲刺', '错题', '刷题'], target: 'score-boost' },
];

export function createSkillRegistry(runtime: SkillRuntime): SkillRegistry {
  return {
    listSummaries: () => runtime.listSummaries(),
    route: (mode) => (mode === 'remediation' ? REMEDIATION_SKILL : TIER_TO_SKILL[mode]),
    candidates: (mode) => [...TIER_CANDIDATES[mode]],
    routeByMention(text) {
      for (const rule of MENTION_RULES) {
        if (rule.keywords.some((kw) => text.includes(kw))) return rule.target;
      }
      return null;
    },
    knowledgeChannel: () => 'score-boost',
    isKnowledge: (name): name is KnowledgeSkillName => name === 'score-boost',
  };
}
