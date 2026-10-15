/**
 * ALU 实体（CONTRACTS §1，逐字一致）+ 实体工厂 + 依赖图 + 前置归因（§4.6②，F1）。
 */
import type { Card } from 'ts-fsrs';
import type { AluId, AluKind, FromMode, Grade, ISODate, ModuleId, SkillName, SubjectId } from './types';

/** 出处：文件 + 句子级 span。PRD §4.2 出处字段 / §4.3 可追溯率 100% 硬门槛 */
export interface SourceRef {
  docId: string;          // 出处文件/资料/视频/搜索结果 id（资料库内唯一）
  docTitle: string;       // 如 "档1·Lakens《Improving Your Statistical Inferences》"（附录样例 source 字段）
  locator: TextSpan | UrlLocator;  // 句子级 span 或外部链接
  text: string;           // 被切分命中的原句原文（校验与回链展示用）
}
export interface TextSpan { kind: 'span'; start: number; end: number; sentenceIndex?: number } // 字符区间（含）
export interface UrlLocator { kind: 'url'; url: string }

/** ALU 主数据（内容层，跨用户不变；种子/切分/搜索/识图摄入同构） */
export interface Alu {
  id: AluId;
  subjectId: SubjectId;          // 学科空间（§4.2：Subject ──< Module ──< ALU）
  moduleId: ModuleId;            // 所属板块
  kind: AluKind;                 // 概念/判据/过程/资源（§4.1 三元组 + 资源型）
  front: string;                 // 正题（正面问什么；判据式提问，SKILL review 方法5）
  back: string;                  // 背面（判据/答案）
  variants: string[];            // 反面/变式（换问法）；资源型可为空（附录 res-001）
  prereq: AluId[];               // 依赖：前置 ALU，可成图（§4.6② 前置归因沿此向上游追溯）
  difficulty: number;            // 难度整数刻度 1~5（资源型占位 0）。附录样例为 0~3 旧刻度，种子包录入按旧 n→新 n+1 抬升（旧3→新4），5 保留给运行时实时上调（§10.1③，F9）
  source: SourceRef;             // 出处（创建时即写入，回链不自研）
  isPriority?: boolean;          // 高质量档升级为"重点"：入队优先级更高、间隔更保守（§4.5）
}

/** ALU 用户状态（每条独立；§4.2） */
export interface AluUserState {
  aluId: AluId;
  status: AluStatus;             // 未见→见过→学过一轮→暂记→已稳固
  fromMode: FromMode | null;     // 来源模式（§4.2）
  fsrs: Card;                    // ts-fsrs 卡片（D/S/R 参数、due、reps、lapses；§4.6①）
  bookmarked?: boolean;          // 用户主动收藏/标记重点（§4.6③ 队列来源②；D11）：入口=会话卡片"标记重点"动作
                                 // + 资料库列表操作，均可取消。仅提升抽取优先级，不改 FSRS 间隔策略——
                                 // 间隔保守度仍由 Alu.isPriority（高质量档自动升级）决定，两者语义独立
  lastAnswers: AnswerRecord[];   // 最近作答记录（截尾保留最近 10 条）
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** 产品状态与 FSRS State 的映射由 domain/fsrs.ts 实现：
 *  未见/见过=New（见过不入队，硬规则1）；学过一轮=入队 Learning→Review，due=T+1；
 *  暂记=Review 且近期有 lapse；已稳固=Review 且 scheduled_days≥21（D5 已裁决：技术默认值，参数化可调） */
export type AluStatus = 'unseen' | 'seen' | 'learned_once' | 'retaining' | 'consolidated';

/** 作答记录（学习事实层原子级，§5.1 A）。
 *  D8 口径：grade='fuzzy' 的记录仅会话内留存（供"模糊→对"struggleWin 判定与埋点），
 *  不落 review_log、不写 FSRS；其后同卡答 correct 时该条记录标 struggleWin=true 并正常持久化。 */
export interface AnswerRecord {
  aluId: AluId;
  grade: Grade;                  // 对/错/模糊 三档
  latencyMs: number;             // 用时（§4.2：对/错/模糊 + 用时）
  skill: SkillName;               // 在哪个档答的
  at: ISODate;
  revoked?: boolean;             // 1s 撤销窗口内撤销（UID §三），撤销不计入 FSRS
  struggleWin?: boolean;         // "挣扎后想起来"：fuzzy→correct 的高价值正反馈（§10.2；会话内可见 fuzzy 记录即可，D8）
}

/** 板块与学科空间（§4.2） */
export interface Module { id: ModuleId; subjectId: SubjectId; name: string; aluOrder: AluId[] }
export interface Subject { id: SubjectId; name: string; moduleIds: ModuleId[] }

// ── 实体工厂 ─────────────────────────────────────────────

export interface CreateAluInput {
  id: AluId;
  subjectId: SubjectId;
  moduleId: ModuleId;
  kind: AluKind;
  front: string;
  back: string;
  variants?: string[];
  prereq?: AluId[];
  /** 难度 1~5 整数（资源型 0）；缺省 3 */
  difficulty?: number;
  source: SourceRef;
  isPriority?: boolean;
}

/** ALU 工厂：校验可判对错的最小完备性（正题/背面非空、难度刻度、prereq 无自环、出处完备）。 */
export function createAlu(input: CreateAluInput): Alu {
  if (!input.id) throw new Error('Alu.id is required');
  if (!input.front.trim()) throw new Error(`Alu ${input.id}: front must be non-empty`);
  if (!input.back.trim()) throw new Error(`Alu ${input.id}: back must be non-empty`);
  if (!input.source?.docId) throw new Error(`Alu ${input.id}: source.docId is required (可追溯率 100% 硬门槛)`);
  if (!input.source.text.trim()) throw new Error(`Alu ${input.id}: source.text is required`);
  const difficulty = input.difficulty ?? 3;
  const isResource = input.kind === 'resource';
  const maxDifficulty = isResource ? 0 : 5;
  if (!Number.isInteger(difficulty) || difficulty < (isResource ? 0 : 1) || difficulty > maxDifficulty) {
    throw new Error(`Alu ${input.id}: difficulty must be integer ${isResource ? '0' : '1~5'} (got ${difficulty})`);
  }
  const prereq = input.prereq ?? [];
  if (prereq.includes(input.id)) throw new Error(`Alu ${input.id}: prereq must not contain itself`);
  return {
    id: input.id,
    subjectId: input.subjectId,
    moduleId: input.moduleId,
    kind: input.kind,
    front: input.front,
    back: input.back,
    variants: input.variants ?? [],
    prereq,
    difficulty,
    source: input.source,
    ...(input.isPriority !== undefined ? { isPriority: input.isPriority } : {}),
  };
}

/** lastAnswers 截尾保留最近 10 条（撤销的记录不计入）。 */
export const MAX_LAST_ANSWERS = 10;
export function pushAnswerRecord(state: AluUserState, record: AnswerRecord): AluUserState {
  const kept = record.revoked ? state.lastAnswers : [...state.lastAnswers, record];
  return { ...state, lastAnswers: kept.slice(-MAX_LAST_ANSWERS) };
}

// ── 依赖图与前置归因（§4.6②，F1）──────────────────────────

/** 依赖图：aluId → 其前置 AluId[]（上游）。 */
export type PrereqGraph = Map<AluId, AluId[]>;

export function buildPrereqGraph(alus: Alu[]): PrereqGraph {
  const graph: PrereqGraph = new Map();
  for (const alu of alus) graph.set(alu.id, [...alu.prereq]);
  return graph;
}

/**
 * 前置归因（CONTRACTS §1/§9，F1）：答错时沿 prereq 向上游追溯（BFS 限深），
 * 返回嫌疑前置 AluId[]——按与出错卡的距离升序（近邻嫌疑在前），去重、环安全。
 * 默认限深 3：太远的上游对"这张卡为什么错"解释力弱。
 */
export function tracePrereqSuspects(
  aluId: AluId,
  graph: PrereqGraph,
  opts: { maxDepth?: number } = {},
): AluId[] {
  const maxDepth = opts.maxDepth ?? 3;
  const suspects: AluId[] = [];
  const visited = new Set<AluId>([aluId]);
  let frontier: AluId[] = [aluId];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: AluId[] = [];
    for (const current of frontier) {
      for (const upstream of graph.get(current) ?? []) {
        if (visited.has(upstream)) continue; // 去重 + 环安全
        visited.add(upstream);
        suspects.push(upstream);
        next.push(upstream);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return suspects;
}

/** 产品 status 合法流转表（§4.5 四档流转状态机）。 */
export const ALU_STATUS_TRANSITIONS: Readonly<Record<AluStatus, readonly AluStatus[]>> = {
  unseen: ['seen', 'learned_once'],
  seen: ['learned_once'],
  learned_once: ['retaining', 'consolidated'],
  retaining: ['learned_once', 'consolidated', 'retaining'],
  consolidated: ['retaining', 'consolidated'],
};

export function canTransition(from: AluStatus, to: AluStatus): boolean {
  if (from === to) return false;
  return ALU_STATUS_TRANSITIONS[from].includes(to);
}
