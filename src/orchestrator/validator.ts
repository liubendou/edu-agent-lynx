/**
 * 后置校验回路（PRD §7.8③ 兜底层 / ARCHITECTURE §4 SessionLoop 每回合 validator）。
 *  - 本场景该用 Skill 却没调 → 强制纠偏重发（输出结构 = Skill 是否被执行的证据）；
 *  - 输出偏离目标检测（结构校验：该有自检没有自检、该出卡没出卡）；
 *  - 纠偏次数上限 → 上报卡死升级信号（五类之一 output_deviation，§7.6）。
 * 解析为最小 JSONL 结构提取（渲染由 a2ui/stream-parser 承担，M3）。
 */
import type { SkillName } from '../domain/types';
import type { TtsLine, ToolCallLine } from './ports';

/** 单回合纠偏上限（超出 → 升级信号上报；可配）。 */
export const MAX_CORRECTIONS_PER_TURN = 2;

/** 会话回合阶段（决定该回合的结构期望）。 */
export type TurnPhase =
  | 'present'      // 复习出卡（单卡一问）
  | 'teach'        // 讲解 + 讲完即问（standard/deep；quick 为地图构建）
  | 'remediation'  // 90 秒补讲子会话
  | 'variant'      // deep 变式复问
  | 'wrap_up';     // 会话尾收尾（SessionEndCard 正向峰值）

export interface TurnExpectation {
  skill: SkillName;
  phase: TurnPhase;
  /** 该档允许出卡（硬规则1/2 已由 activator/domain 强制；此处只做输出结构期望） */
  cardGeneration: boolean;
}

/** 从 JSONL 行流提取的回合产物（最小解析，够 validator 用）。 */
export interface TurnOutput {
  /** A2UI surfaceUpdate 里出现的组件（id + name） */
  components: { id: string; name: string }[];
  /** TTS 指令行 */
  tts: { text: string }[];
  /** 工具调用行 */
  toolCalls: { name: string; args: unknown }[];
  /** 解析失败的非空行数（未知行不白屏，由 a2ui fallback 降级；这里只计数） */
  unparsed: string[];
  raw: string[];
}

export type ValidationIssueCode =
  | 'skill_not_used'         // 该用 Skill 却没调（输出无任何档位签名组件）
  | 'missing_self_check'     // 该有自检没有自检（讲完必须自检，§7.9）
  | 'missing_card_output'    // 该出卡没出卡（讲完自检后应给复习卡产出结构）
  | 'missing_required_component'; // 缺档位必备组件（如复习无判定条）

export interface ValidationIssue {
  code: ValidationIssueCode;
  detail: string;
  /** 纠偏重发时注入的强制指令（§7.8③"强制纠偏"） */
  correctiveDirective: string;
}

/** 各档各阶段的组件组期望：anyOf 内命中其一即算满足。 */
const REQUIRED_GROUPS: Record<TurnPhase, Array<{ anyOf: string[]; code: ValidationIssueCode; what: string }>> = {
  present: [
    { anyOf: ['QuestionCard', 'RevealCard'], code: 'missing_required_component', what: '复习出卡' },
    { anyOf: ['FeedbackBar'], code: 'missing_required_component', what: '三档判定条' },
  ],
  teach: [
    { anyOf: ['ExplainStep', 'ConceptCard', 'MapView'], code: 'missing_required_component', what: '讲解/地图组件' },
    // quick 的低门槛自检 = RevealCard 上滑揭晓（UID §四），与 Question/Choice/Mic 同组
    { anyOf: ['QuestionCard', 'ChoiceGrid', 'MicButton', 'RevealCard'], code: 'missing_self_check', what: '讲完即问的自检' },
    { anyOf: ['FeedbackBar'], code: 'missing_required_component', what: '三档判定条' },
  ],
  remediation: [
    { anyOf: ['ExplainStep', 'ConceptCard'], code: 'missing_required_component', what: '补讲解' },
  ],
  variant: [
    { anyOf: ['QuestionCard'], code: 'missing_required_component', what: '变式题' },
    { anyOf: ['FeedbackBar'], code: 'missing_required_component', what: '三档判定条' },
  ],
  wrap_up: [
    { anyOf: ['SessionEndCard'], code: 'missing_card_output', what: '会话尾收尾卡' },
  ],
};

/** 最小 JSONL 解析：A2UI 行提组件、tts/tool_call 行提指令、未知行计数。 */
export function parseTurnOutput(chunks: string[]): TurnOutput {
  const output: TurnOutput = { components: [], tts: [], toolCalls: [], unparsed: [], raw: [...chunks] };
  for (const chunk of chunks) {
    const line = chunk.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      output.unparsed.push(line);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') {
      output.unparsed.push(line);
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    const surface = obj['surfaceUpdate'] as { components?: unknown } | undefined;
    if (surface && Array.isArray(surface.components)) {
      for (const comp of surface.components as Record<string, unknown>[]) {
        if (typeof comp['id'] === 'string' && typeof comp['name'] === 'string') {
          output.components.push({ id: comp['id'], name: comp['name'] });
        }
      }
      continue;
    }
    if (obj['tts'] !== undefined) {
      const tts = parsed as TtsLine;
      output.tts.push({ text: tts.tts.text });
      continue;
    }
    if (obj['tool_call'] !== undefined) {
      const call = parsed as ToolCallLine;
      output.toolCalls.push({ name: call.tool_call.name, args: call.tool_call.args });
      continue;
    }
    output.unparsed.push(line);
  }
  return output;
}

/**
 * 后置校验（§7.8③）：
 *  1) 输出无任何组件（或无一命中档位签名）→ skill_not_used（该用却没调）；
 *  2) 按阶段组件组期望逐组校验 → missing_self_check / missing_card_output / missing_required_component。
 * 每个失败组给一条强制纠偏指令，重发时并入 directives。
 */
export function validateTurnOutput(expectation: TurnExpectation, output: TurnOutput): ValidationIssue[] {
  const names = new Set(output.components.map((c) => c.name));
  // 档位签名组件（UID §四：各档主力组件）——输出完全没有 = Skill 未被执行
  const signature: Record<SkillName, string[]> = {
    'quick-learning': ['ConceptCard', 'MapView'],
    review: ['QuestionCard', 'RevealCard', 'FeedbackBar'],
    'standard-learning': ['ExplainStep', 'QuestionCard', 'FeedbackBar'],
    'deep-learning': ['ExplainStep', 'QuestionCard', 'ProgressRing', 'MicButton'],
  };
  const sigHit = signature[expectation.skill].some((n) => names.has(n));
  const issues: ValidationIssue[] = [];
  if (!sigHit) {
    issues.push({
      code: 'skill_not_used',
      detail: `输出未命中 ${expectation.skill} 的任何签名组件（该用 Skill 却没调）`,
      correctiveDirective: `本场景必须按 ${expectation.skill} 技能模板执行，产出其必备组件后再回答`,
    });
    return issues; // 签名都不在，逐组报没有增量信息
  }
  for (const group of REQUIRED_GROUPS[expectation.phase]) {
    if (!group.anyOf.some((n) => names.has(n))) {
      issues.push({
        code: group.code,
        detail: `缺${group.what}（阶段 ${expectation.phase}）`,
        correctiveDirective: `强制要求：必须包含 ${group.anyOf.join('/')} 之一完成"${group.what}"`,
      });
    }
  }
  return issues;
}

/** 升级信号构造：纠偏超限 → output_deviation（§7.6 五类之一）。 */
export function deviationEscalationSignal(issues: ValidationIssue[]): {
  type: 'output_deviation';
  detail: string;
} {
  return {
    type: 'output_deviation',
    detail: issues.map((i) => `${i.code}: ${i.detail}`).join('; '),
  };
}
