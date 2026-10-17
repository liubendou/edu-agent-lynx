/**
 * 运行时层：真实起服务 + HTTP 断言（electron-app-engineering §八 运行时层；
 * references/verification.md §3「断言真实运行时，不是看代码"应该没问题"」）。
 *
 * 本工程是 Lynx 4.0 移动端（Android 为目标平台），Windows 开发机无真机/模拟器，
 * 因此运行时断言的落点取 lynx.web-preview.config.ts 的 Web 预览（任务书指定的降级路径）：
 *   1) 起 rspeedy dev（web 预览配置，端口取 rsbud 默认 3000）；
 *   2) 轮询 `__web_preview?casename=main.web.bundle` 直到 200（真实起得来才算过）；
 *   3) 断言 HTML 外壳（#root 挂载点 + 脚本/样式引用）、外壳 JS/CSS 资源、应用 bundle 均为 200 且非空；
 *   4) 断言应用 bundle 里能找到 catalog 的全部 16 零件名（产物真的把零件编进去了）；
 *   5) 断言启动日志无编译错误；收尾杀进程树，失败退出码 1。
 *
 * 已知降级（如实记录，不粉饰）：
 *   - jsdom 直接跑 web 预览产物不可行：预览外壳 index.js 依赖 Worker/WASM，
 *     jsdom 无 Worker → `ReferenceError: Worker is not defined`（2026-10-17 实测）。
 *     故本工程的"真实 DOM 断言"由单元层 rstest + @lynx-js/react/testing-library + jsdom
 *     承担（src/__tests__/pages.test.tsx、a2ui-surface.test.tsx），本脚本只做 HTTP 层断言。
 *   - 真机/模拟器（adb + LynxView）断言未做：开发机无 Android 设备。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  PROJECT_ROOT, blockOfArray, createChecker, killTree, quotedIn,
} from './lib/verify-utils.mjs';

const PORT = Number(process.env['EDU_VERIFY_PORT'] ?? 3000);
const BASE = `http://127.0.0.1:${PORT}`;
const ENTRY = '/__web_preview?casename=main.web.bundle';
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

const check = createChecker('运行时');
console.log(`运行时层：web 预览 dev server → ${BASE}${ENTRY}（端口可用 EDU_VERIFY_PORT 覆盖）`);

/** 端口占用预检：被占用就直接报清原因，不让 3000 上的旧服务污染断言。 */
function portIsFree() {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.once('listening', () => probe.close(() => done(true)));
    probe.listen(PORT, '127.0.0.1');
  });
}

/** 解析 rspeedy CLI 入口（node_modules 内的 bin，不依赖 PATH / npx.cmd，跨平台）。 */
function rspeedyBin() {
  const bin = resolve(PROJECT_ROOT, 'node_modules/@lynx-js/rspeedy/bin/rspeedy.js');
  return existsSync(bin) ? bin : null;
}

/** 16 零件名从 catalog 单一事实源取（产物里必须找得到）。 */
function catalogComponentNames() {
  const text = readFileSync(resolve(PROJECT_ROOT, 'src/a2ui/catalog.ts'), 'utf8');
  const block = blockOfArray(text, 'const COMPONENT_NAMES');
  return block === null ? [] : quotedIn(block);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!(await portIsFree())) {
    check.fail(`端口 ${PORT} 已被占用，请先释放（或设 EDU_VERIFY_PORT 换端口）后再跑运行时层`);
    return;
  }
  const bin = rspeedyBin();
  if (bin === null) {
    check.fail('未找到 node_modules/@lynx-js/rspeedy/bin/rspeedy.js（请在工程根 npm install）');
    return;
  }

  const child = spawn(process.execPath, [bin, 'dev', '-c', 'lynx.web-preview.config.ts'], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += String(d); });
  child.stderr.on('data', (d) => { log += String(d); });

  try {
    // 1) 起服务：轮询入口页直到 200（真实可访问，而不是"应该能起"）
    let shell = null;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE}${ENTRY}`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) { shell = { status: res.status, html: await res.text() }; break; }
      } catch { /* 未就绪，继续轮询 */ }
      await sleep(POLL_INTERVAL_MS);
    }
    if (shell === null) {
      check.fail(`dev server 未在 ${READY_TIMEOUT_MS / 1000}s 内就绪；末尾日志：\n${log.trim().split('\n').slice(-8).join('\n')}`);
      return;
    }
    check.ok(`dev server 就绪：GET ${ENTRY} → 200（HTML ${shell.html.length} 字节）`);

    // 2) HTML 外壳：挂载点 + 脚本/样式引用（真 DOM 断言的前置条件）
    const hasRoot = /<div id="root">/.test(shell.html);
    hasRoot ? check.ok('HTML 外壳含挂载点 <div id="root">') : check.fail('HTML 外壳缺 #root 挂载点');
    const assets = [
      ...shell.html.matchAll(/<script[^>]+src="([^"]+)"/g),
      ...shell.html.matchAll(/<link[^>]+href="([^"]+)"/g),
    ].map((m) => m[1]);
    if (assets.length < 2) check.fail(`HTML 外壳资源引用少于 2 个：${JSON.stringify(assets)}`);
    else check.ok(`HTML 外壳引用资源 ${assets.length} 个：${assets.join(' , ')}`);

    // 3) 外壳资源真实可取（逐条 HTTP 断言）
    for (const asset of assets) {
      const res = await fetch(`${BASE}${asset}`, { signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || buf.length === 0) check.fail(`资源取用失败：${asset} → ${res.status} / ${buf.length} 字节`);
      else check.ok(`资源可取：${asset} → 200 / ${buf.length} 字节`);
    }

    // 4) 应用 bundle：200 + 体积门槛 + 16 零件名真的在里面
    const bundleRes = await fetch(`${BASE}/main.web.bundle`, { signal: AbortSignal.timeout(60_000) });
    const bundle = Buffer.from(await bundleRes.arrayBuffer()).toString('utf8');
    if (!bundleRes.ok) check.fail(`应用 bundle 未取到：${bundleRes.status}`);
    else if (bundle.length < 100_000) check.fail(`应用 bundle 过小（${bundle.length} 字节），疑似未真正编译`);
    else check.ok(`应用 bundle：GET /main.web.bundle → 200 / ${bundle.length} 字节（≥100KB）`);

    if (!bundle.includes('lynx')) check.fail('应用 bundle 未见 lynx 运行时标记');
    else check.ok('应用 bundle 含 lynx 运行时标记');

    const names = catalogComponentNames();
    const missing = names.filter((n) => !bundle.includes(n));
    if (names.length === 0) check.fail('未能从 catalog 解析出零件名（零件断言跳过）');
    else if (missing.length > 0) check.fail(`应用 bundle 缺零件名（产物未把零件编进去）：${missing.join('、')}`);
    else check.ok(`应用 bundle 含 catalog 全部 ${names.length} 个零件名（产物 → 运行时一致）`);

    // 5) 启动日志无编译错误（脚本静默死掉时这里才看得见）
    const errorLines = log.split(/\r?\n/).filter((l) => /Failed to compile|Module not found|Failed to resolve|Build failed/.test(l));
    if (errorLines.length > 0) check.fail(`dev server 日志出现编译错误：\n${errorLines.join('\n')}`);
    else check.ok('dev server 日志无编译错误（Failed to compile / Module not found 等）');

    check.info('降级说明：jsdom 跑 web 预览产物不可行（预览外壳依赖 Worker/WASM）；DOM 级断言由单元层 pages.test.tsx / a2ui-surface.test.tsx 承担');
  } finally {
    killTree(child);
  }
}

await main();
const code = check.report();
await sleep(300); // 给 taskkill 一点时间，避免退出时端口未释放
process.exit(code);
