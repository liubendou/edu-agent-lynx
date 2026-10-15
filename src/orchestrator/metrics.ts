/**
 * Skill 调用率度量层（PRD §7.8④ / ARCHITECTURE §8④）。
 * 埋点：激活来源（确定性/点名/纠偏）+ 漏触发/误触发样本留存；
 * 评测集导出含负例标注位（M7 验收用："该触发"与"不该触发"都要有）。
 * 与领域事件同源（CONTRACTS §9 注：orchestrator 发、埋点同源）。
 */
import type { EscalationResult, EscalationSignal, ISODate, SkillName } from '../domain/types';
import type { ActivationSource } from './activator';

/** 单次激活埋点样本。 */
export interface ActivationSample {
  at: ISODate;
  /** 决策场景标识（decision kind / mention:<原文前缀> / wrap_up …） */
  scenario: string;
  /** 本场景该用的 Skill（'none'=负例场景：不该触发任何 Skill） */
  expectedSkill: SkillName | 'none';
  /** 实际激活的 Skill（'none'=未激活） */
  activatedSkill: SkillName | 'none';
  source: ActivationSource;
  /**
   * outcome：
   *  hit            — 该用且用了（正例命中）
   *  miss           — 漏触发：该用却没调（被 validator 纠偏救回的也记 miss，source='corrected'）
   *  false_positive — 误触发：不该触发却触发了
   */
  outcome: 'hit' | 'miss' | 'false_positive';
  /** 负例标注位（M7 评测集："不该触发"用例标 true） */
  negativeExample: boolean;
  detail?: string;
}

/** 升级留痕样本（skill_escalation 事件同构，§7.6）。 */
export interface EscalationSample {
  at: ISODate;
  signal: EscalationSignal;
  result: EscalationResult;
}

/** 评测集导出（M7 用；含负例标注位与统计）。 */
export interface EvaluationSet {
  samples: ActivationSample[];
  escalations: EscalationSample[];
  generatedAt: ISODate;
  /** 调用率 = hit / (hit + miss)（召回率口径，§7.8④） */
  callRate: number;
  /** 误触发数（精确率口径的负项） */
  falsePositiveCount: number;
  /** 负例样本数（negativeExample=true） */
  negativeExampleCount: number;
}

export interface SkillMetrics {
  /** 激活样本留存（确定性/点名/纠偏来源 + 漏/误触发标注） */
  recordActivation(sample: ActivationSample): void;
  /** 误触发留存（负例；expectedSkill='none' 场景却激活了） */
  recordFalsePositive(scenario: string, activatedSkill: SkillName, detail?: string): void;
  /** 升级留痕（与 skill_escalation 领域事件同源） */
  recordEscalation(signal: EscalationSignal, result: EscalationResult, at: ISODate): void;
  activationSamples(): ActivationSample[];
  /** 评测集导出（含负例标注位，M7 用） */
  exportEvaluationSet(now?: Date): EvaluationSet;
}

/** 内存度量仓（orchestrator 持有；M2-int 可接持久化实现）。 */
export function createMetricsStore(): SkillMetrics {
  const activations: ActivationSample[] = [];
  const escalations: EscalationSample[] = [];
  return {
    recordActivation(sample) {
      activations.push(sample);
    },
    recordFalsePositive(scenario, activatedSkill, detail) {
      activations.push({
        at: new Date().toISOString(),
        scenario,
        expectedSkill: 'none',
        activatedSkill,
        source: 'named',
        outcome: 'false_positive',
        negativeExample: true, // 误触发样本天然是负例
        ...(detail !== undefined ? { detail } : {}),
      });
    },
    recordEscalation(signal, result, at) {
      escalations.push({ at, signal, result });
    },
    activationSamples() {
      return [...activations];
    },
    exportEvaluationSet(now) {
      const hits = activations.filter((s) => s.outcome === 'hit').length;
      const misses = activations.filter((s) => s.outcome === 'miss').length;
      const fps = activations.filter((s) => s.outcome === 'false_positive').length;
      const negatives = activations.filter((s) => s.negativeExample).length;
      const total = hits + misses;
      return {
        samples: [...activations],
        escalations: [...escalations],
        generatedAt: (now ?? new Date()).toISOString(),
        callRate: total === 0 ? 1 : hits / total,
        falsePositiveCount: fps,
        negativeExampleCount: negatives,
      };
    },
  };
}
