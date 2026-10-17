/**
 * 【临时取证脚本，用完即删】流式路径探针：看 streamChat 到底返回几行、内容是什么。
 */
import { test } from '@rstest/core';
import { loadCloudConfig } from '../cloud/config';
import { CloudClient } from '../cloud/client';
import type { CloudRequestSegments } from '../cloud/context-builder';

const segments: CloudRequestSegments = {
  system: '你是学习 agent。',
  psychologyLibrary: '',
  catalog: '',
  skillTemplate: '用中文口语回答。',
  profileFragment: '',
  taskInstruction: {
    aluIds: [],
    mode: 'quick-learning',
    params: { budgetMinutes: [3, 10], goal: 'map', cardGeneration: false },
    budget: { minutes: 15, cards: 10, newAlus: 3 },
    boundaries: [],
  },
  history: [],
  retrieved: [],
};

test('PROBE 流式路径', { timeout: 180_000 }, async () => {
  const cfg = await loadCloudConfig();
  const client = new CloudClient({ config: cfg });
  try {
    const r = await client.streamChat({ segments });
    console.log('[STREAM OK]', JSON.stringify({ lines: r.a2uiLines.length, modelUsed: r.modelUsed, usage: r.usage }));
    for (const [i, line] of r.a2uiLines.entries()) console.log(`[STREAM LINE ${String(i)}]`, line.slice(0, 400));
  } catch (e) {
    const err = e as { name?: string; code?: string; status?: number; message?: string; retryable?: boolean };
    console.log('[STREAM ERR]', JSON.stringify({
      name: err.name, code: err.code, status: err.status, message: err.message, retryable: err.retryable,
    }));
  }
});
