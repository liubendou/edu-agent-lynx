/**
 * 四档会话事件流（CONTRACTS §9，逐字一致）+ 事件工厂 + 四档心流参数（§10.3，D9）。
 */
import type { AluId, Grade, ISODate, SkillName } from './types';
import type { SkillParams } from '../skills/runtime';
import type { EscalationSignal, EscalationResult } from '../cloud/escalation';
import type { AluStatus, AnswerRecord } from './alu';
import type { SessionEndAnalysis, SessionEndTrigger } from './profile';

/** 会话生命周期事件（orchestrator 发、domain/storage 消费；埋点同源，§7.8④）。
 *  注（F7）：补讲子会话仅发 remediation_start/remediation_done，不发独立 session_start（生命周期挂主会话）。 */
export type SessionEvent =
  | { type: 'session_start'; sessionId: string; skill: SkillName; aluIds: AluId[]; params: SkillParams; at: ISODate }
  | { type: 'answer'; record: AnswerRecord }                                    // 作答（1s 撤销窗口内可补 revoked）
  | { type: 'judge'; aluId: AluId; grade: Grade; fsrsApplied: boolean; prereqSuspect?: AluId[]; at: ISODate } // 判定三档 + FSRS 是否已写（fuzzy 恒 fsrsApplied=false，D8）；答错时沿依赖图上游追溯的前置嫌疑 ALU（§4.6② 前置归因，落点 domain/alu.ts tracePrereqSuspects，F1）
  | { type: 'difficulty_adjust'; aluId: AluId; direction: 'up' | 'down'; reason: string } // 实时调节（§10.1③：卡住先降难度给脚手架）
  | { type: 'remediation_start'; aluId: AluId; fromSkill: 'review' }            // 补讲拉起（硬规则3：复习失败→标准档90秒）
  | { type: 'remediation_done'; aluId: AluId; requeued: boolean }               // 补完重新入队（间隔按答错处理）
  | { type: 'card_generated'; aluIds: AluId[]; sourceChunkId: string; skill: 'standard-learning' | 'deep-learning' } // 唯一入口硬约束（硬规则2）
  | { type: 'alu_status'; aluId: AluId; from: AluStatus; to: AluStatus }        // 四档流转状态机跃迁（§4.5）
  | { type: 'skill_escalation'; signal: EscalationSignal; result: EscalationResult } // 卡死升级留痕
  | { type: 'session_end'; sessionId: string; trigger: SessionEndTrigger; analysis: SessionEndAnalysis; at: ISODate };

/** 四档心流参数（§10.3 表；会话容器按档取用）。
 *  D9：复习档 sessionMinutes=[3,6]（PRD §3"一轮 3~6 分钟"）；§10.3 复习行"60~90s"系误植档1 值，已被用户裁决取代。 */
export interface FlowParams {
  skill: SkillName;
  judgeLatencyTarget: '<1s' | '1-3s' | 'seconds';   // 判定反馈时延目标（按下反馈先行，判定异步补）
  targetSuccessRate: number;                         // 交互层：快速0.90/复习0.85/标准0.80/深度0.75（深度为 PRD"70~80%"取区间中点单值，可配置；与 FSRS 0.9 保持率是两套指标，F16）
  sessionMinutes: [number, number];                  // 单次时长区间（复习=[3,6]，D9）
  boundedSession: { closingLine: string };           // 有界会话："再3张清完今天"，不做开放结尾（§10.1①）
}

/** 四档心流参数表（§10.3 + D9；深度目标成功率取 70~80% 中点 0.75，可配置）。 */
export const FLOW_PARAMS: Readonly<Record<SkillName, FlowParams>> = {
  'quick-learning': {
    skill: 'quick-learning',
    judgeLatencyTarget: '<1s',
    targetSuccessRate: 0.90,
    sessionMinutes: [3, 10],
    boundedSession: { closingLine: '地图骨架就绪，明天再来拼下一块' },
  },
  'review': {
    skill: 'review',
    judgeLatencyTarget: '<1s',
    targetSuccessRate: 0.85,
    sessionMinutes: [3, 6],
    boundedSession: { closingLine: '再 3 张清完今天' },
  },
  'standard-learning': {
    skill: 'standard-learning',
    judgeLatencyTarget: '1-3s',
    targetSuccessRate: 0.80,
    sessionMinutes: [5, 15],
    boundedSession: { closingLine: '这个知识点讲完了，下一站?' },
  },
  'deep-learning': {
    skill: 'deep-learning',
    judgeLatencyTarget: 'seconds',
    targetSuccessRate: 0.75,
    sessionMinutes: [20, 40],
    boundedSession: { closingLine: '今天吃透这一块，收工' },
  },
};

export function flowParamsFor(skill: SkillName): FlowParams {
  return FLOW_PARAMS[skill];
}

// ── 事件工厂（构造即校验硬约束） ────────────────────────

export function createSessionStart(input: {
  sessionId: string; skill: SkillName; aluIds: AluId[]; params: SkillParams; at: ISODate;
}): SessionEvent {
  return { type: 'session_start', ...input };
}

export function createAnswerEvent(record: AnswerRecord): SessionEvent {
  return { type: 'answer', record };
}

export function createJudgeEvent(input: {
  aluId: AluId; grade: Grade; fsrsApplied: boolean; prereqSuspect?: AluId[]; at: ISODate;
}): SessionEvent {
  // fuzzy 恒不写 FSRS（D8）；correct/wrong 在 review 档才写（fsrsApplied 由调用方给）
  if (input.grade === 'fuzzy' && input.fsrsApplied) {
    throw new Error("judge event: fuzzy must have fsrsApplied=false (D8)");
  }
  return { type: 'judge', ...input };
}

export function createDifficultyAdjustEvent(input: {
  aluId: AluId; direction: 'up' | 'down'; reason: string;
}): SessionEvent {
  return { type: 'difficulty_adjust', ...input };
}

/** 补讲拉起（硬规则3：复习失败→标准档 90 秒；fromSkill 恒 'review'）。 */
export function createRemediationStart(aluId: AluId): SessionEvent {
  return { type: 'remediation_start', aluId, fromSkill: 'review' };
}

export function createRemediationDone(aluId: AluId, requeued: boolean): SessionEvent {
  return { type: 'remediation_done', aluId, requeued };
}

/** 硬规则2 代码强制：card_generated 仅 standard/deep 可发（quick/review 发即抛错）。 */
export function createCardGeneratedEvent(input: {
  aluIds: AluId[]; sourceChunkId: string; skill: 'standard-learning' | 'deep-learning';
}): SessionEvent {
  if (input.skill !== 'standard-learning' && input.skill !== 'deep-learning') {
    throw new Error(`card_generated: skill must be standard/deep (got ${String(input.skill)})`);
  }
  if (input.aluIds.length === 0) throw new Error('card_generated: aluIds must be non-empty');
  return { type: 'card_generated', ...input };
}

export function createAluStatusEvent(aluId: AluId, from: AluStatus, to: AluStatus): SessionEvent {
  return { type: 'alu_status', aluId, from, to };
}

export function createSkillEscalationEvent(signal: EscalationSignal, result: EscalationResult): SessionEvent {
  return { type: 'skill_escalation', signal, result };
}

export function createSessionEndEvent(input: {
  sessionId: string; trigger: SessionEndTrigger; analysis: SessionEndAnalysis; at: ISODate;
}): SessionEvent {
  return { type: 'session_end', ...input };
}
