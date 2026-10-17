/**
 * 验证体系共用工具（静态 / 运行时 / 冒烟三层脚本共用；只用 Node 内置模块）。
 *
 * 纪律（electron-app-engineering §八§九）：
 *  - 单一事实源：工程根 / skill/ 只读源目录各自只在本文件定位一次；
 *  - 跨平台：无硬编码绝对路径，靠 import.meta.url + 逐级向上查找
 *    （思路照抄 src/__tests__/skill-root.ts，差别是这里用 ESM 的 fileURLToPath）；
 *  - 错误让脚本以非零退出码结束，警告只打印。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本文件所在目录（scripts/lib）。 */
export const LIB_DIR = dirname(fileURLToPath(import.meta.url));

/** 逐级向上找工程根（判据：package.json + src/ 同时存在）。 */
export function findProjectRoot(startDir = LIB_DIR) {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'package.json')) && existsSync(resolve(dir, 'src'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`未能从 ${startDir} 逐级向上定位工程根（缺 package.json / src）`);
}

/** 只读事实源根目录 skill/（判据：quick-learning/SKILL.md），顺序同 skill-root.ts。 */
export function findSkillRoot(projectRoot) {
  const env = process.env['EDU_SKILL_ROOT'];
  if (env !== undefined && env.trim() !== '') return env.trim();
  const marker = 'quick-learning/SKILL.md';
  let dir = projectRoot;
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, 'skill');
    if (existsSync(resolve(candidate, marker))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(projectRoot, '..', 'skill');
}

export const PROJECT_ROOT = findProjectRoot();
export const SKILL_ROOT = findSkillRoot(PROJECT_ROOT);

/** 读工程内文件（相对工程根；不存在返回 null，由调用方决定报错口径）。 */
export function readSource(relPath) {
  const abs = resolve(PROJECT_ROOT, relPath);
  return existsSync(abs) ? { abs, text: readFileSync(abs, 'utf8') } : null;
}

/** 读任意路径文本（只读事实源在工程外，需绝对路径入口）。 */
export function readText(absPath) {
  return readFileSync(absPath, 'utf8');
}

/**
 * 取注册表字面量所在行区间：从含 marker 的行开始，到第一条以 closeChar（`]` 或 `}`）
 * 开头的行为止。够用即可，不做完整 TS 语法解析（本层只做规范/一致性校验）。
 */
export function literalBlock(text, marker, closeChar) {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const closeRe = new RegExp(`^\\s*${closeChar === ']' ? '\\]' : '\\}'}`);
  const lines = text.slice(start).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (out.length > 0 && closeRe.test(line)) {
      out.push(line);
      break;
    }
    out.push(line);
  }
  return out.join('\n');
}

export const blockOfArray = (text, marker) => literalBlock(text, marker, ']');
export const blockOfObject = (text, marker) => literalBlock(text, marker, '}');

/** 联合类型 / 单行类型声明区间：从 marker 行到第一条以 `;` 结束（可带行尾注释）的行为止。 */
export function unionBlock(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const lines = text.slice(start).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    out.push(line);
    if (/;\s*(?:\/\/.*)?$/.test(line)) break;
  }
  return out.join('\n');
}

/** 区间内所有单引号字面量（按出现顺序，去重前）。 */
export const quotedIn = (block) => [...block.matchAll(/'([^']*)'/g)].map((m) => m[1]);

/** 区间内所有标识符（`const X = [a, b];` → ['a','b']）。 */
export const identifiersIn = (block) =>
  [...block.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)]
    .map((m) => m[0])
    .filter((id) => !['as', 'const', 'satisfies', 'ReadonlyArray', 'readonly'].includes(id));

/** 集合/顺序比较工具。 */
export function diffSets(actual, expected) {
  const a = new Set(actual);
  const e = new Set(expected);
  return {
    missing: [...e].filter((x) => !a.has(x)),
    extra: [...a].filter((x) => !e.has(x)),
  };
}

export function diffOrder(actual, expected) {
  if (actual.length !== expected.length) return `长度不一致：${actual.length} vs ${expected.length}`;
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) return `第 ${i + 1} 项不一致：${actual[i]} vs ${expected[i]}`;
  }
  return '';
}

/**
 * 检查器：收集 OK/FAIL/WARN，打印结果并给出退出码。
 * 规范（verification.md）：错误让构建失败（退出码 1），警告只打印。
 */
export function createChecker(layer) {
  const failures = [];
  const warnings = [];
  let passes = 0;
  const prefix = `[${layer}]`;
  return {
    ok(msg) {
      passes += 1;
      console.log(`  OK   ${prefix} ${msg}`);
    },
    fail(msg) {
      failures.push(msg);
      console.log(`  FAIL ${prefix} ${msg}`);
    },
    warn(msg) {
      warnings.push(msg);
      console.log(`  WARN ${prefix} ${msg}`);
    },
    info(msg) {
      console.log(`  INFO ${prefix} ${msg}`);
    },
    report() {
      console.log(`\n${prefix} 小结：通过 ${passes} · 失败 ${failures.length} · 警告 ${warnings.length}`);
      if (warnings.length > 0) console.log(`${prefix} 警告：\n  - ${warnings.join('\n  - ')}`);
      if (failures.length > 0) console.log(`${prefix} 失败：\n  - ${failures.join('\n  - ')}`);
      return failures.length === 0 ? 0 : 1;
    },
  };
}

/**
 * 跨平台跑 npm 子脚本：npm run 会注入 npm_execpath（npm-cli.js 路径），
 * 直接 node 调用它，避开 Windows 上 .cmd 的 shell 差异；拿不到时按平台回退。
 */
export function spawnNpm(args, options = {}) {
  const npmCli = process.env['npm_execpath'];
  if (npmCli !== undefined && /\.(c?js|mjs)$/.test(npmCli) && existsSync(npmCli)) {
    return spawn(process.execPath, [npmCli, ...args], { stdio: 'inherit', ...options });
  }
  const win = process.platform === 'win32';
  return spawn(win ? 'npm.cmd' : 'npm', args, { shell: win, stdio: 'inherit', ...options });
}

/** 收尾清理子进程树（Windows 必须 taskkill /T，否则 rspack worker 残留占端口）。 */
export function killTree(child) {
  if (child === null || child === undefined || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* 进程已退出 */
  }
}
