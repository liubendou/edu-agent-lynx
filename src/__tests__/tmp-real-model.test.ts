/**
 * 【临时证据脚本，用完即删】Node 侧真模型首启开场回合 —— 打印首屏实际会渲染的内容。
 * 不是为了留测试：只为把"真模型到底吐出什么"逐字拿出来给用户看。
 */
import { test } from '@rstest/core';
import { createAppMachine, seedFirstRunContent } from '../composition';
import { loadCloudConfig } from '../cloud/config';

function clip(value: unknown, max = 500): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…[截断 ${String(text.length - max)} 字]`;
}

test('EVIDENCE 真模型首启开场回合', { timeout: 180_000 }, async () => {
  const cfg = await loadCloudConfig();
  console.log('[CFG]', JSON.stringify({ mock: cfg.mock, source: cfg.source, baseUrl: cfg.baseUrl, modelFlash: cfg.modelFlash, hasKey: cfg.apiKey !== '' }));

  const machine = await createAppMachine();
  const boot0 = await machine.orchestrator.boot();
  console.log('[BOOT0]', JSON.stringify({ isFirstRun: boot0.isFirstRun, reason: boot0.reason, decision: boot0.decision.kind }));
  if (boot0.isFirstRun) {
    const seeded = await seedFirstRunContent(machine.repos);
    console.log('[SEED]', seeded);
  }
  const boot = await machine.orchestrator.boot();
  console.log('[BOOT]', clip({ isFirstRun: boot.isFirstRun, reason: boot.reason, decision: boot.decision }, 600));

  machine.orchestrator.openSession();
  const out = await machine.orchestrator.runTurn({ kind: 'open' });
  console.log('[TURN]', clip(out, 600));

  const anyOut = out as unknown as { output?: { raw?: string[]; unparsed?: string[]; tts?: unknown[]; toolCalls?: unknown[] } };
  const raw = anyOut.output?.raw ?? [];
  const unparsed = anyOut.output?.unparsed ?? [];
  console.log('[RAW 行数]', raw.length);
  for (const [i, line] of raw.entries()) console.log(`[RAW ${String(i)}]`, clip(line, 500));
  console.log('[UNPARSED 行数]', unparsed.length);
  for (const [i, line] of unparsed.entries()) console.log(`[UNPARSED ${String(i)}]`, clip(line, 500));

  const snap = machine.a2uiParser.snapshot();
  console.log('[SURFACE 组件数]', snap.components.length);
  console.log('[PARSER 错误]', JSON.stringify(snap.errors));
  for (const node of snap.components) {
    console.log('[COMPONENT]', node.name, clip(node.props, 400));
  }
});
