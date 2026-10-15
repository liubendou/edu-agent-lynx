/**
 * 成绩单拍照解析（M6，D4；PRD §5.5/§7.3、ARCHITECTURE §1 tools/grade-entry.ts）。
 * 链路：成绩单照片 → data URL → 识图链路（vision.ts，sub-agent 独立窗口）→ 结构化数字
 * → GradeEvent 入库（profile.facts.gradeEvents，§5.5 成绩层）。
 *
 * 隐私硬约束（§5.5）：**不存原图**——本模块只接收内存态 data URL，解析完成即弃，
 * 任何路径都不把图像写入存储；入库的只有结构化数字与分布。
 * 解析失败兜底：返回 { ok:false, error }，UI 走手动录入（ProfilePage 入口接线 M7）。
 */
import type { GradeEvent, ErrorCauseDistribution, LearnerProfile } from '../domain/profile';
import { createEmptyProfile } from '../domain/profile';
import { recognizeImage, type VisionCloudPort } from './vision';

/** 成绩单解析 sub-agent 独立 system 提示词（§7.7⑤：只回传 JSON 结论）。 */
export const GRADE_PARSE_SYSTEM = [
  '你是成绩单解析子代理，工作在独立窗口：只看这张成绩单照片，没有其他上下文。',
  '任务：从照片中提取结构化成绩数字，只输出一个 JSON 对象，格式：',
  '{"subject":"科目名","total":总分数字,"sections":[{"name":"分项名","score":得分数字,"full":满分数字}]}',
  '硬约束：只输出 JSON，不要输出任何其他文字；数字一律用阿拉伯数字；',
  '看不清或缺失的分项不要编造——宁可少提取也不写错；无法确定总分时 total 用各分项得分求和。',
].join('\n');

/** 成绩事件存储端口（Repositories 结构子集：loadProfile/saveProfile；测试注入内存 fake）。 */
export interface GradeEventStore {
  loadProfile(): Promise<LearnerProfile | null>;
  saveProfile(profile: LearnerProfile): Promise<void>;
}

export type GradeParseResult =
  | { ok: true; gradeEvent: GradeEvent }
  | { ok: false; error: string }; // 失败 → UI 手动录入兜底（D4）

let gradeEventSeq = 0;

/** 解析输出形状校验（防模型脏数据入库：数字/字符串类型逐字段核验）。 */
function isValidParsedGrade(v: unknown): v is {
  subject: string; total: number;
  sections: { name: string; score: number; full: number }[];
} {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p['subject'] !== 'string' || p['subject'].length === 0) return false;
  if (typeof p['total'] !== 'number' || !Number.isFinite(p['total'])) return false;
  if (!Array.isArray(p['sections'])) return false;
  return p['sections'].every((s) => {
    if (typeof s !== 'object' || s === null) return false;
    const sec = s as Record<string, unknown>;
    return typeof sec['name'] === 'string' && sec['name'].length > 0
      && typeof sec['score'] === 'number' && Number.isFinite(sec['score'])
      && typeof sec['full'] === 'number' && Number.isFinite(sec['full']) && sec['full'] > 0;
  });
}

/** 从识图结论文本中提取 JSON（容忍 ```json 围栏与前后杂讯）。 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced !== null ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/**
 * 成绩单照片解析（D4 主入口）：识图 → 严格 JSON → GradeEvent（未入库，调用方经 appendGradeEvent 落库）。
 * 任何一步失败都返回 { ok:false, error }——不抛异常、不存原图，UI 据此走手动录入。
 */
export async function parseGradeReport(
  input: { imageDataUrl: string; subjectHint?: string; at?: string },
  port: VisionCloudPort,
): Promise<GradeParseResult> {
  const vision = await recognizeImage(
    {
      imageDataUrl: input.imageDataUrl,
      hint: [
        input.subjectHint !== undefined ? `科目提示：${input.subjectHint}` : '这是一张成绩单/成绩条照片。',
        '请按系统约定只输出结构化 JSON。',
      ].join('\n'),
      system: GRADE_PARSE_SYSTEM, // 成绩单独立窗口提示词（覆盖通用识图 system）
    },
    port,
  );
  if (!vision.ok || vision.text === undefined) {
    return { ok: false, error: vision.error ?? '识图失败' };
  }
  const parsed = extractJson(vision.text);
  if (!isValidParsedGrade(parsed)) {
    return { ok: false, error: '解析失败：识别结果不是合法的成绩结构（请手动录入）' };
  }
  const errorCauses: ErrorCauseDistribution = { unknown: 0, misapplied: 0, misread: 0, calculation: 0 };
  gradeEventSeq += 1;
  const gradeEvent: GradeEvent = {
    id: `ge-${Date.now()}-${gradeEventSeq}`,
    subject: parsed.subject,
    at: input.at ?? new Date().toISOString(),
    total: parsed.total,
    sections: parsed.sections.map((s) => ({ name: s.name, score: s.score, full: s.full })),
    errorCauses,
  };
  return { ok: true, gradeEvent };
}

/** GradeEvent 入库（§5.5 profile 成绩层；只存结构化数字与分布，原图从未落盘）。 */
export async function appendGradeEvent(store: GradeEventStore, gradeEvent: GradeEvent): Promise<void> {
  const profile = (await store.loadProfile()) ?? createEmptyProfile();
  await store.saveProfile({
    ...profile,
    facts: { ...profile.facts, gradeEvents: [...profile.facts.gradeEvents, gradeEvent] },
  });
}
