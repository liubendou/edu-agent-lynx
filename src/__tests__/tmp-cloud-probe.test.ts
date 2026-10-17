/**
 * 【临时取证脚本，用完即删】真模型传输层探针：直接打 DeepSeek，看 HTTP 到底返回什么。
 */
import { test } from '@rstest/core';
import { loadCloudConfig } from '../cloud/config';
import { CloudClient } from '../cloud/client';

test('PROBE 真模型传输层', { timeout: 120_000 }, async () => {
  const cfg = await loadCloudConfig();
  console.log('[CFG]', JSON.stringify({
    mock: cfg.mock,
    source: cfg.source,
    baseUrl: cfg.baseUrl,
    modelFlash: cfg.modelFlash,
    modelPro: cfg.modelPro,
    hasKey: cfg.apiKey.length > 0,
  }));

  const client = new CloudClient({ config: cfg });
  try {
    const r = await client.completeText({ prompt: '用一句中文自我介绍。' });
    console.log('[COMPLETE OK]', JSON.stringify({ len: r.text.length, text: r.text.slice(0, 300), usage: r.usage }));
  } catch (e) {
    const err = e as { name?: string; code?: string; status?: number; message?: string; retryable?: boolean };
    console.log('[COMPLETE ERR]', JSON.stringify({
      name: err.name, code: err.code, status: err.status, message: err.message, retryable: err.retryable,
    }));
  }
});
