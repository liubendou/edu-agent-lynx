// M6 识图 + 成绩单解析单测（T2/T7）：sub-agent 隔离 system、data URL 校验、
// 多模态请求体形态、失败降级（不抛）、成绩 JSON 严格校验与入库（不存原图 §5.5）。
import { describe, expect, test } from '@rstest/core';
import {
  GRADE_PARSE_SYSTEM,
  appendGradeEvent,
  parseGradeReport,
} from '../tools/grade-entry';
import {
  VISION_SUBAGENT_SYSTEM,
  createDeepSeekVisionClient,
  isImageDataUrl,
  recognizeImage,
  type VisionCloudPort,
} from '../tools/vision';
import { createEmptyProfile, type LearnerProfile } from '../domain/profile';

const DATA_URL = 'data:image/jpeg;base64,QUJDREVG';

describe('M6 识图（vision.ts）', () => {
  test('isImageDataUrl：仅接受 data:image/*;base64 形态', () => {
    expect(isImageDataUrl(DATA_URL)).toBe(true);
    expect(isImageDataUrl('data:image/png;base64,x')).toBe(true);
    expect(isImageDataUrl('https://example.com/a.jpg')).toBe(false);
    expect(isImageDataUrl('data:text/plain;base64,x')).toBe(false);
    expect(isImageDataUrl('')).toBe(false);
  });

  test('recognizeImage 成功：默认注入 VISION_SUBAGENT_SYSTEM（§7.7⑤ 独立窗口）', async () => {
    const seen: { system: string; prompt: string; imageDataUrl: string }[] = [];
    const port: VisionCloudPort = {
      completeVision: async (p) => {
        seen.push(p);
        return '题目：解方程 2x+1=5';
      },
    };
    const result = await recognizeImage({ imageDataUrl: DATA_URL, hint: '这道题怎么解' }, port);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('题目：解方程 2x+1=5');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.system).toBe(VISION_SUBAGENT_SYSTEM);
    expect(seen[0]!.imageDataUrl).toBe(DATA_URL);
    expect(seen[0]!.prompt).toContain('这道题怎么解');
  });

  test('recognizeImage：system 覆盖生效（grade-entry 注入自己的隔离提示词）', async () => {
    let gotSystem = '';
    const port: VisionCloudPort = {
      completeVision: async (p) => {
        gotSystem = p.system;
        return 'ok';
      },
    };
    await recognizeImage({ imageDataUrl: DATA_URL, system: GRADE_PARSE_SYSTEM }, port);
    expect(gotSystem).toBe(GRADE_PARSE_SYSTEM);
  });

  test('非法 data URL → {ok:false} 不抛；端口抛错同样降级为结果对象', async () => {
    expect((await recognizeImage({ imageDataUrl: 'nope' }, { completeVision: async () => 'x' })).ok).toBe(false);
    const result = await recognizeImage(
      { imageDataUrl: DATA_URL },
      { completeVision: async () => { throw new Error('HTTP 429'); } },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('429');
  });

  test('createDeepSeekVisionClient：无 Key → 明确「未配置」报错（not_configured，经 recognizeImage 降级）', async () => {
    const client = createDeepSeekVisionClient({ apiKey: '', baseUrl: 'https://x', modelFlash: 'f', modelPro: 'p', mock: true, source: 'none' });
    const result = await recognizeImage({ imageDataUrl: DATA_URL }, client);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未配置');
    expect(result.error).toContain('设置');
  });

  test('createDeepSeekVisionClient：OpenAI 兼容多模态请求体 + Bearer 头 + flash 模型', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: '识别完成' } }] }), { status: 200 });
    }) as typeof fetch;
    const client = createDeepSeekVisionClient(
      { apiKey: 'sk-test', baseUrl: 'https://api.example.com', modelFlash: 'deepseek-flash', modelPro: 'deepseek-pro', mock: false, source: 'file' },
      fetchImpl,
    );
    const text = await client.completeVision({ system: 'SYS', prompt: 'PROMPT', imageDataUrl: DATA_URL });
    expect(text).toBe('识别完成');
    expect(capturedUrl).toBe('https://api.example.com/chat/completions');
    const body = JSON.parse(String(capturedInit!.body)) as {
      model: string;
      messages: { role: string; content: unknown }[];
    };
    expect(body.model).toBe('deepseek-flash');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    const userContent = body.messages[1]!.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(userContent[0]).toEqual({ type: 'text', text: 'PROMPT' });
    expect(userContent[1]!.type).toBe('image_url');
    expect(userContent[1]!.image_url!.url).toBe(DATA_URL);
    expect((capturedInit!.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  test('createDeepSeekVisionClient：HTTP 非 2xx → CloudClientError（status 透传）', async () => {
    const fetchImpl = (async () => new Response('too many', { status: 429 })) as typeof fetch;
    const client = createDeepSeekVisionClient(
      { apiKey: 'k', baseUrl: 'https://api.example.com', modelFlash: 'f', modelPro: 'p', mock: false, source: 'file' },
      fetchImpl,
    );
    await expect(client.completeVision({ system: 's', prompt: 'p', imageDataUrl: DATA_URL })).rejects.toThrow('HTTP 429');
  });
});

describe('M6 成绩单解析（grade-entry.ts，D4）', () => {
  const GOOD_JSON = '{"subject":"数学","total":95,"sections":[{"name":"选择题","score":40,"full":50},{"name":"解答题","score":55,"full":60}]}';

  function portReturning(text: string): VisionCloudPort {
    return { completeVision: async () => text };
  }

  test('合法 JSON（含 ```json 围栏）→ GradeEvent 结构化数字', async () => {
    const result = await parseGradeReport({ imageDataUrl: DATA_URL }, portReturning(`\`\`\`json\n${GOOD_JSON}\n\`\`\``));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gradeEvent.subject).toBe('数学');
      expect(result.gradeEvent.total).toBe(95);
      expect(result.gradeEvent.sections).toEqual([
        { name: '选择题', score: 40, full: 50 },
        { name: '解答题', score: 55, full: 60 },
      ]);
      expect(result.gradeEvent.errorCauses).toEqual({ unknown: 0, misapplied: 0, misread: 0, calculation: 0 });
      expect(result.gradeEvent.id.startsWith('ge-')).toBe(true);
    }
  });

  test('system 用 GRADE_PARSE_SYSTEM 覆盖（成绩单独立窗口，不掺主会话上下文）', async () => {
    let gotSystem = '';
    const port: VisionCloudPort = {
      completeVision: async (p) => {
        gotSystem = p.system;
        return GOOD_JSON;
      },
    };
    await parseGradeReport({ imageDataUrl: DATA_URL }, port);
    expect(gotSystem).toBe(GRADE_PARSE_SYSTEM);
  });

  test('识别结果不是合法成绩结构（缺 total）→ {ok:false} 手动录入兜底', async () => {
    const result = await parseGradeReport({ imageDataUrl: DATA_URL }, portReturning('{"subject":"数学","sections":[]}'));
    if (result.ok) throw new Error('应为失败结果');
    expect(result.error).toContain('手动录入');
  });

  test('编造防护：分项缺 full / score 非数字 → 拒绝入库', async () => {
    const bad = '{"subject":"数学","total":90,"sections":[{"name":"选择题","score":40,"full":0}]}';
    expect((await parseGradeReport({ imageDataUrl: DATA_URL }, portReturning(bad))).ok).toBe(false);
    const bad2 = '{"subject":"数学","total":"95","sections":[{"name":"a","score":1,"full":2}]}';
    expect((await parseGradeReport({ imageDataUrl: DATA_URL }, portReturning(bad2))).ok).toBe(false);
  });

  test('识图失败 → {ok:false} error 透传（不抛、不存原图）', async () => {
    const result = await parseGradeReport(
      { imageDataUrl: DATA_URL },
      { completeVision: async () => { throw new Error('识图网络错误'); } },
    );
    if (result.ok) throw new Error('应为失败结果');
    expect(result.error).toBe('识图网络错误');
  });

  test('appendGradeEvent：入 profile.facts.gradeEvents，只存结构化数字（序列化后无图像数据）', async () => {
    const parse = await parseGradeReport({ imageDataUrl: DATA_URL }, portReturning(GOOD_JSON));
    if (!parse.ok) throw new Error('前置解析失败');
    let saved: LearnerProfile | null = null;
    const store = {
      loadProfile: async () => null,
      saveProfile: async (p: LearnerProfile) => { saved = p; },
    };
    await appendGradeEvent(store, parse.gradeEvent);
    const profile = saved as unknown as LearnerProfile;
    expect(profile.facts.gradeEvents).toHaveLength(1);
    expect(profile.facts.gradeEvents[0]!.subject).toBe('数学');
    expect(JSON.stringify(profile).includes('data:image')).toBe(false); // §5.5 硬约束：原图不落盘
    // 空档案兜底：createEmptyProfile 其余字段完好
    expect(profile.facts.goals).toEqual([]);
    expect(profile.facts.answerEvents).toEqual([]);
  });
});
