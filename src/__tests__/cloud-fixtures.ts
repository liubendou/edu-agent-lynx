// M2c 云侧测试公共 fixture：八段输入的确定性构造（无时间戳/随机 id，前缀可复现）。
import type { CloudRequestSegments, TaskInstruction } from '../cloud';
import type { SkillName } from '../domain/types';

export const STABLE = {
  system: '你是端到端学习 Agent。产出只能是 A2UI v0.9 JSONL。安全第一。',
  psychologyLibrary: '心理学策略库 v1：检索练习、间隔重复、合意困难、双编码。',
  catalog: '{"version":"0.9","components":{"QuestionCard":{"question":"string"},"MapView":{"nodes":"[]","edges":"[]"}}}',
} as const;

export const SKILL_TEMPLATE_QUICK = '档1快速：先给地图骨架，再一道自检题，禁生成复习卡。';
export const SKILL_TEMPLATE_STANDARD = '档3标准：四段式讲解（概念→例子→反例→常见坑），讲完必须自检。';
export const PROFILE_FRAGMENT = '画像片段：用户偏好简洁；介意长类比；当前板块掌握度 0.4。';

export function taskInstruction(mode: SkillName | 'remediation', aluIds: string[] = ['psy-001', 'psy-002']): TaskInstruction {
  return {
    aluIds,
    mode,
    params: { cardGeneration: mode === 'standard-learning' || mode === 'deep-learning', goal: 'map' },
    budget: { newCards: 5, reviewCards: 20 },
    boundaries: ['别用太多类比', '不喜欢被问"听懂了吗"'],
  };
}

export function segments(overrides: Partial<CloudRequestSegments> = {}): CloudRequestSegments {
  return {
    system: STABLE.system,
    psychologyLibrary: STABLE.psychologyLibrary,
    catalog: STABLE.catalog,
    skillTemplate: SKILL_TEMPLATE_QUICK,
    profileFragment: PROFILE_FRAGMENT,
    taskInstruction: taskInstruction('quick-learning'),
    history: [
      { role: 'user', content: '第一问：什么是 p 值？' },
      { role: 'assistant', content: '{"surfaceUpdate":{"surfaceId":"main","components":[]}}' },
    ],
    retrieved: [
      {
        kind: 'alu_ref',
        aluId: 'psy-001',
        sourceRef: {
          docId: 'doc-1',
          docTitle: '档1·Lakens《Improving Your Statistical Inferences》',
          locator: { kind: 'span', start: 120, end: 189, sentenceIndex: 7 },
          text: 'p 值是……',
        },
        digest: 'p 值定义：在原假设为真时，观察到当前或更极端结果的概率。',
      },
    ],
    ...overrides,
  };
}
