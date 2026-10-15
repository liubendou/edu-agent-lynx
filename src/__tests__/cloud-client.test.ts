// M2c DeepSeek 客户端测试：SSE 流式解析、错误分类（网络/限流/内容过滤）、幂等重试、超时。
import { describe, expect, test } from '@rstest/core';
import { CloudClient, CloudClientError } from '../cloud';
import type { CloudConfig } from '../cloud';
import { segments } from './cloud-fixtures';

const CONFIG: CloudConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://mock.deepseek.test/v1',
  modelFlash: 'deepseek-v4.1-flash',
  modelPro: 'deepseek-v4-pro',
  mock: false,
  source: 'file',
};

function sseBody(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
}

function sseResponse(events: string[]): Response {
  return new Response(sseBody(events), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function chunkEvent(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

const USAGE_EVENT = 'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_cache_hit_tokens":80}}\n\n';
const DONE_EVENT = 'data: [DONE]\n\n';

describe('cloud-client: SSE 流式解析', () => {
  test('chat.completion.chunk 文本增量逐块回调 + usage/cacheHit + modelUsed', async () => {
    const line1 = '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"c1","name":"ConceptCard","props":{}}]}}';
    const line2 = '{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"c2","name":"QuestionCard","props":{}}]}}';
    const fetches: unknown[] = [];
    const client = new CloudClient({
      config: CONFIG,
      fetchImpl: (async (_url: unknown, _init?: unknown) => {
        fetches.push(_url);
        return sseResponse([
          chunkEvent({ content: `${line1}\n` }),
          chunkEvent({ content: `${line2}\n` }),
          USAGE_EVENT,
          DONE_EVENT,
        ]) as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const deltas: string[] = [];
    const toolDeltas: unknown[] = [];
    const result = await client.streamChat({
      segments: segments(),
      callbacks: {
        onTextDelta: (t) => deltas.push(t),
        onToolCallDelta: (d) => toolDeltas.push(d),
      },
    });
    expect(deltas).toEqual([`${line1}\n`, `${line2}\n`]);
    expect(result.a2uiLines).toEqual([line1, line2]);
    expect(result.usage.promptTokens).toBe(100);
    expect(result.usage.completionTokens).toBe(20);
    expect(result.usage.cacheHit).toBe(true); // prompt_cache_hit_tokens>0 → 前缀命中
    expect(result.modelUsed).toBe('flash');
    expect(fetches).toHaveLength(1);
    expect(String(fetches[0])).toBe('https://mock.deepseek.test/v1/chat/completions');
  });

  test('工具调用增量透传；跨 TCP 块的残缺行正确缓冲拼接', async () => {
    // 一个 data 行被拆到两个网络块里：解析器必须缓冲拼接
    const full = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'web_search', arguments: '{"q":' } }] } }] });
    const half = Math.floor(full.length / 2);
    const client = new CloudClient({
      config: CONFIG,
      fetchImpl: (async () => sseResponse([
        `data: ${full.slice(0, half)}`,
        `${full.slice(half)}\n\n`,
        USAGE_EVENT,
        DONE_EVENT,
      ])) as unknown as typeof fetch,
    });
    const toolDeltas: unknown[] = [];
    const result = await client.streamChat({
      segments: segments(),
      callbacks: { onToolCallDelta: (d) => toolDeltas.push(d) },
    });
    expect(toolDeltas).toEqual([{ index: 0, id: 'call-1', function: { name: 'web_search', arguments: '{"q":' } }]);
    expect(result.a2uiLines).toEqual([]);
  });
});

describe('cloud-client: 错误分类与重试（幂等才重试）', () => {
  test('429 限流重试后成功（指数退避经注入 sleep 清零）', async () => {
    let calls = 0;
    const client = new CloudClient({
      config: CONFIG,
      sleep: async () => {},
      fetchImpl: (async () => {
        calls += 1;
        if (calls <= 2) return new Response('{"error":{"message":"rate limited"}}', { status: 429 });
        return sseResponse([chunkEvent({ content: '{"surfaceUpdate":{}}\n' }), DONE_EVENT]);
      }) as unknown as typeof fetch,
    });
    const result = await client.streamChat({ segments: segments() });
    expect(calls).toBe(3);
    expect(result.a2uiLines).toEqual(['{"surfaceUpdate":{}}']);
  });

  test('已产出增量后流中断 → 不重试（非幂等），直接抛错', async () => {
    let calls = 0;
    const brokenStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(chunkEvent({ content: 'partial' })));
      },
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const client = new CloudClient({
      config: CONFIG,
      sleep: async () => {},
      fetchImpl: (async () => {
        calls += 1;
        return new Response(brokenStream, { status: 200 });
      }) as unknown as typeof fetch,
    });
    await expect(client.streamChat({ segments: segments() })).rejects.toMatchObject({
      code: 'invalid_response',
      producedOutput: true,
    });
    expect(calls).toBe(1); // 绝不重试
  });

  test('网络错误（未产出）可重试；4xx 不重试', async () => {
    let calls = 0;
    const client = new CloudClient({
      config: CONFIG,
      sleep: async () => {},
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed'); // 首次网络错误（未产出 → 幂等可重试）
        return sseResponse([DONE_EVENT]);
      }) as unknown as typeof fetch,
    });
    const result = await client.streamChat({ segments: segments() });
    expect(calls).toBe(2);
    expect(result.a2uiLines).toEqual([]);

    const badRequest = new CloudClient({
      config: CONFIG,
      sleep: async () => {},
      fetchImpl: (async () => new Response('{"error":{"message":"bad request"}}', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(badRequest.streamChat({ segments: segments() })).rejects.toMatchObject({
      code: 'http',
      status: 400,
      retryable: false,
    });
  });

  test('内容过滤 400 → content_filtered 不重试；超时 abort → timeout', async () => {
    const filtered = new CloudClient({
      config: CONFIG,
      sleep: async () => {},
      fetchImpl: (async () => new Response('{"error":{"message":"content filter triggered"}}', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(filtered.streamChat({ segments: segments() })).rejects.toMatchObject({
      code: 'content_filtered',
      retryable: false,
    });

    const timeoutClient = new CloudClient({
      config: CONFIG,
      sleep: async () => {},
      fetchImpl: (async (_url: unknown, init: { signal: AbortSignal } | undefined) => new Promise((_resolve, reject) => {
        init?.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      })) as unknown as typeof fetch,
    });
    await expect(timeoutClient.streamChat({ segments: segments(), timeoutMs: 20, maxRetries: 1 }))
      .rejects.toMatchObject({ code: 'timeout', retryable: true });
  });

  test('错误实例为 CloudClientError 且分类字段齐备', async () => {
    const client = new CloudClient({
      config: CONFIG,
      fetchImpl: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch,
    });
    let caught: unknown;
    try {
      await client.streamChat({ segments: segments() });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudClientError);
    const err = caught as CloudClientError;
    expect(err.code).toBe('http');
    expect(err.status).toBe(401);
    expect(err.retryable).toBe(false);
  });

  test('completeText 非流式：pro 模型路由与文本返回', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new CloudClient({
      config: CONFIG,
      fetchImpl: (async (_url: unknown, init: { body: string } | undefined) => {
        bodies.push(JSON.parse(init!.body));
        return new Response(JSON.stringify({
          choices: [{ message: { content: '下一步：拆小步骤' } }],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const result = await client.completeText({ prompt: '卡在: x\n目标: y', modelRole: 'pro' });
    expect(result.text).toBe('下一步：拆小步骤');
    expect(result.usage.promptTokens).toBe(50);
    expect(bodies[0]).toMatchObject({ model: 'deepseek-v4-pro' });
    expect(bodies[0]).not.toHaveProperty('stream'); // 非流式
    expect((bodies[0] as { messages: { role: string; content: string }[] }).messages[0].content).toContain('卡在: x');
  });
});
