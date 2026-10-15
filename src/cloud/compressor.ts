/**
 * 窗口压缩器（M2c，CONTRACTS §7 / ARCHITECTURE §5 / PRD §7.7④）。
 * 窗口快满时只压缩④~⑧段，①②③缓存前缀绝不改写（F15 裁决口径）；
 * ④为当前档 Skill 模板，会话内本就不变，实际动的是⑤⑦⑧。
 * 保命清单（五类必保）：①当前目标 ②用户约束（偏好边界）③未完成步骤（最近回合）
 * ④关键引用（alu-id+出处）⑤未解决错误原文；可丢久远对话与已完成回合。
 * 策略：重要性打分 + 滑动窗口。
 */
import type { ChatTurn, CloudRequestSegments, RetrievedChunk } from './context-builder';
import { MAX_RETRIEVED_DIGEST_CHARS } from './context-builder';

export interface CompressOptions {
  /** ④~⑧ 段总字符预算（不含①②③）。 */
  maxChars: number;
  /** 滑动窗口：最近 N 条 history 原文必保（未完成步骤线索）。 */
  keepRecentTurns: number;
  /** ⑤ 画像片段预算。 */
  maxProfileChars: number;
}

export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  maxChars: 24_000,
  keepRecentTurns: 6,
  maxProfileChars: 800,
};

/** 压缩后⑧段 digest 预算（比拼装入窗更紧）。 */
const COMPRESSED_DIGEST_CHARS = 200;

/** 未解决错误关键词（PRD §7.7⑥：错误原文保留，不摘要成"出错了"）。 */
const ERROR_PATTERNS = /错误|失败|报错|不对|卡住|wrong|error|failed/i;
/** 用户约束/纠错线索。 */
const CORRECTION_PATTERNS = /别用|不喜欢|介意|不是这样|说错了|纠正/;

export interface CompressionReport {
  /** 被丢弃的久远回合数（已完成回合可丢）。 */
  removedTurns: number;
  /** ⑤段被截断的字符数。 */
  profileTruncatedChars: number;
  /** ⑧段 digest 进一步截断的条数。 */
  retrievedTruncated: number;
  /** 保住的未解决错误原文条数。 */
  keptErrorTurns: number;
  /** 压缩后④~⑧总字符。 */
  dynamicChars: number;
}

/** 重要性打分（3=未解决错误原文，2=用户约束/纠错，1=普通）。 */
export function turnImportance(turn: ChatTurn): number {
  if (ERROR_PATTERNS.test(turn.content)) return 3;
  if (turn.role === 'user' && CORRECTION_PATTERNS.test(turn.content)) return 2;
  return 1;
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function compressRetrieved(chunks: RetrievedChunk[]): {
  chunks: RetrievedChunk[];
  truncated: number;
} {
  let truncated = 0;
  const out = chunks.map((chunk) => {
    if (chunk.digest.length <= COMPRESSED_DIGEST_CHARS) return chunk;
    truncated += 1;
    return { ...chunk, digest: truncate(chunk.digest, COMPRESSED_DIGEST_CHARS) };
  });
  return { chunks: out, truncated };
}

function dynamicChars(segments: CloudRequestSegments): number {
  const historyChars = segments.history.reduce((sum, t) => sum + t.content.length, 0);
  const retrievedChars = segments.retrieved.reduce((sum, c) => sum + c.digest.length, 0);
  return (
    segments.skillTemplate.length
    + segments.profileFragment.length
    + JSON.stringify(segments.taskInstruction).length
    + historyChars
    + retrievedChars
  );
}

/**
 * 压缩入口：输入完整八段，返回压缩后的新 segments（①~④原样引用，绝不改写）。
 * 保命清单五类由结构与打分共同保证：⑥taskInstruction（当前目标+用户约束）整段保留；
 * 滑动窗口最近回合（未完成步骤）保留；重要性≥2 的旧回合保留原文；⑧引用元信息全保、digest 截断。
 */
export function compressSegments(
  segments: CloudRequestSegments,
  options: Partial<CompressOptions> = {},
): { segments: CloudRequestSegments; report: CompressionReport } {
  const opts = { ...DEFAULT_COMPRESS_OPTIONS, ...options };

  // ①②③④原样（引用级相等——绝不改写缓存前缀）；⑤截断到画像预算
  const profileFragment = truncate(segments.profileFragment, opts.maxProfileChars);

  // ⑧：引用元信息（aluId+sourceRef）全保，digest 紧截断
  const { chunks: retrieved, truncated: retrievedTruncated } = compressRetrieved(segments.retrieved);

  // ⑦：滑动窗口（最近 N 条原文必保）+ 重要性打分淘汰久远回合
  const total = segments.history.length;
  const recentStart = Math.max(0, total - opts.keepRecentTurns);
  const indicesKept = new Set<number>();
  for (let i = recentStart; i < total; i++) indicesKept.add(i); // 未完成步骤：最近回合

  let removedTurns = 0;
  // 从旧到新逐条淘汰：普通久远回合先丢（已完成回合可丢），重要性≥2 的错误/约束原文必保
  for (let i = 0; i < recentStart; i++) {
    const score = turnImportance(segments.history[i]);
    if (score >= 2) indicesKept.add(i);
    else removedTurns += 1;
  }
  const kept: ChatTurn[] = Array.from(indicesKept)
    .sort((a, b) => a - b)
    .map((i) => segments.history[i]);
  // 保命清单⑤：未解决错误原文（窗口内 + 窗口外命中都算）
  const keptErrorTurns = kept.filter((t) => ERROR_PATTERNS.test(t.content)).length;

  const compressed: CloudRequestSegments = {
    ...segments, // ①②③④引用原样传递
    profileFragment,
    history: kept,
    retrieved,
  };

  return {
    segments: compressed,
    report: {
      removedTurns,
      profileTruncatedChars: Math.max(0, segments.profileFragment.length - profileFragment.length),
      retrievedTruncated,
      keptErrorTurns,
      dynamicChars: dynamicChars(compressed),
    },
  };
}
