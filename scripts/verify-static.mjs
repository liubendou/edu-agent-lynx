/**
 * 静态层：规范校验脚本（electron-app-engineering §八 静态层 / §五 单一事实源）。
 *
 * 只读文本、不改任何文件，做两件事：
 *  A. 只读事实源 skill/ 的规范：五个技能包 SKILL.md 存在、frontmatter 合法
 *     （name 命名规则 / description 非空且 ≤1024 / 只允许 name+description 键）；
 *  B. 单一事实源一致性：同一列表（16 零件 / 技能包 / 工具白名单 / 种子包）在工程内
 *     出现的那几处必须逐一对得上，任何漂移都报 FAIL（发现真实不一致只报告，不改 src/）。
 *
 * 声明：本层是源码文本解析，不是运行时断言；语义正确性由单元层（rstest）与
 * 运行时层（scripts/verify-runtime.mjs）负责。
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROJECT_ROOT, SKILL_ROOT, blockOfArray, blockOfObject, createChecker, diffOrder,
  diffSets, identifiersIn, quotedIn, readSource, readText, unionBlock,
} from './lib/verify-utils.mjs';

const check = createChecker('静态');

/** 规范上限（对齐 references/verification.md 的静态校验样例）。 */
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 64;
const DESC_MAX = 1024;
const DESC_MIN = 20;
const BODY_MAX_LINES = 500;

// ── A. skill/ 只读事实源 ─────────────────────────────────────────────

/** 极简 frontmatter 解析（只认 `---` 头 + 单行 `key: value`；不引 YAML 依赖）。 */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (match === null) return null;
  const block = match[1];
  const keys = [...block.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((m) => m[1]);
  const raw = (key) => {
    const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    if (m === null) return null;
    const value = m[1].trim();
    return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  };
  return { keys, name: raw('name'), description: raw('description'), body: text.slice(match[0].length) };
}

/** 内置技能包注册表（src/skills/packs/index.ts）→ 包名顺序。 */
function builtInPackNames() {
  const src = readSource('src/skills/packs/index.ts');
  if (src === null) return null;
  const imports = new Map(
    [...src.text.matchAll(/^import \{ (\w+) \} from '\.\/([^']+)';/gm)].map((m) => [m[1], m[2]]),
  );
  const block = blockOfArray(src.text, 'const BUILT_IN_PACKS');
  if (block === null) return null;
  const ids = identifiersIn(block.slice(block.indexOf('[') + 1)).filter((id) => imports.has(id));
  return { names: ids.map((id) => imports.get(id)) };
}

function checkSkillPacks() {
  const builtIn = builtInPackNames();
  if (builtIn === null) {
    check.fail('src/skills/packs/index.ts：未能解析 BUILT_IN_PACKS 注册表');
    return { names: [] };
  }
  check.ok(`内置技能包注册表（src/skills/packs/index.ts）= ${builtIn.names.join(' / ')}`);

  if (existsSync(SKILL_ROOT)) {
    const dirs = readdirSync(SKILL_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const drift = diffSets(dirs, builtIn.names);
    if (drift.missing.length > 0) check.fail(`skill/ 目录缺内置包目录：${drift.missing.join('、')}`);
    if (drift.extra.length > 0) check.fail(`skill/ 目录多出未注册目录：${drift.extra.join('、')}`);
    if (drift.missing.length === 0 && drift.extra.length === 0) {
      check.ok(`skill/ 目录集合 === 内置包注册表（${dirs.length} 包）`);
    }
  } else {
    check.fail(`只读事实源目录不存在：${SKILL_ROOT}（可用 EDU_SKILL_ROOT 指定）`);
  }

  for (const name of builtIn.names) {
    const mdPath = resolve(SKILL_ROOT, name, 'SKILL.md');
    if (!existsSync(mdPath)) {
      check.fail(`skill/${name}/SKILL.md 不存在`);
      continue;
    }
    const fm = parseFrontmatter(readText(mdPath));
    if (fm === null) {
      check.fail(`skill/${name}/SKILL.md：缺 frontmatter（头部未用 --- 包裹）`);
      continue;
    }
    const extraKeys = fm.keys.filter((k) => k !== 'name' && k !== 'description');
    if (extraKeys.length > 0) check.fail(`skill/${name}/SKILL.md：frontmatter 出现未约定字段 ${extraKeys.join('、')}`);
    if (fm.name === null || !NAME_RE.test(fm.name)) {
      check.fail(`skill/${name}/SKILL.md：name 不合规（须 ^[a-z0-9]+(-[a-z0-9]+)*$）：${String(fm.name)}`);
    } else if (fm.name !== name) {
      check.fail(`skill/${name}/SKILL.md：name(${fm.name}) 与目录名(${name}) 不一致`);
    } else if (fm.name.length > NAME_MAX) {
      check.fail(`skill/${name}/SKILL.md：name 超长（>${NAME_MAX}）`);
    }
    if (fm.description === null || fm.description.length < DESC_MIN) {
      check.fail(`skill/${name}/SKILL.md：description 缺失或过短（<${DESC_MIN} 字）`);
    } else if (fm.description.length > DESC_MAX) {
      check.fail(`skill/${name}/SKILL.md：description 超长（${fm.description.length} > ${DESC_MAX}）`);
    }
    const bodyLines = fm.body.split(/\r?\n/).length;
    if (bodyLines > BODY_MAX_LINES) check.warn(`skill/${name}/SKILL.md：正文 ${bodyLines} 行（建议 <${BODY_MAX_LINES}）`);
    if (fm.name === name && fm.description !== null && fm.description.length >= DESC_MIN) {
      check.ok(`skill/${name}/SKILL.md：frontmatter 合法（name 合规 / description ${fm.description.length} 字 / 正文 ${bodyLines} 行）`);
    }

    // 同一描述字符串在两处存放（只读源 SKILL.md 与内置包 manifest）→ 漂移检查
    const pack = readSource(`src/skills/packs/${name}.ts`);
    if (pack !== null && fm.description !== null) {
      const mirror = pack.text.match(/summary:\s*\{[\s\S]*?description:\s*"([^"]*)"/);
      if (mirror === null) {
        check.warn(`src/skills/packs/${name}.ts：未解析到 summary.description（跳过镜像比对）`);
      } else if (mirror[1] !== fm.description) {
        check.fail(`description 两处不一致：src/skills/packs/${name}.ts 与 skill/${name}/SKILL.md`);
      } else {
        check.ok(`src/skills/packs/${name}.ts summary.description 与 SKILL.md frontmatter 逐字一致`);
      }
    }
  }
  return builtIn;
}

// ── B1. 16 零件（catalog ↔ surface 渲染注册表 ↔ components 桶）──────────

function checkComponents() {
  const catalog = readSource('src/a2ui/catalog.ts');
  const surface = readSource('src/a2ui/surface.tsx');
  const barrel = readSource('src/components/index.ts');
  if (catalog === null || surface === null || barrel === null) {
    check.fail('缺 src/a2ui/catalog.ts / src/a2ui/surface.tsx / src/components/index.ts 之一，跳过分区检查');
    return [];
  }

  const namesBlock = blockOfArray(catalog.text, 'const COMPONENT_NAMES');
  const names = namesBlock === null ? null : quotedIn(namesBlock);
  if (names === null || names.length === 0) {
    check.fail('src/a2ui/catalog.ts：未解析到 COMPONENT_NAMES');
    return [];
  }

  const catalogBlock = blockOfArray(catalog.text, 'const A2UI_CATALOG');
  const entries = catalogBlock === null
    ? null
    : [...catalogBlock.matchAll(/^\s*name: '([^']+)',/gm)].map((m) => m[1]);
  if (entries === null) check.fail('src/a2ui/catalog.ts：未解析到 A2UI_CATALOG');
  else {
    const drift = diffOrder(entries, names);
    if (drift !== '') check.fail(`A2UI_CATALOG 条目与 COMPONENT_NAMES 不一致：${drift}`);
    else check.ok(`A2UI_CATALOG 条目 === COMPONENT_NAMES（${names.length} 零件，同序）`);
  }

  const registryBlock = blockOfObject(surface.text, 'A2UI_COMPONENT_REGISTRY');
  const registryKeys = registryBlock === null
    ? null
    : [...registryBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]);
  if (registryKeys === null) check.fail('src/a2ui/surface.tsx：未解析到 A2UI_COMPONENT_REGISTRY');
  else {
    const d = diffSets(registryKeys, names);
    if (d.missing.length > 0) check.fail(`surface 渲染注册表缺实现：${d.missing.join('、')}`);
    if (d.extra.length > 0) check.fail(`surface 渲染注册表多出 catalog 外零件：${d.extra.join('、')}`);
    if (d.missing.length === 0 && d.extra.length === 0) {
      check.ok(`A2UI_COMPONENT_REGISTRY 键 === COMPONENT_NAMES（${registryKeys.length} 项，渲染侧不外扩）`);
    }
  }

  const entries2 = [...barrel.text.matchAll(/^export \{ ([^}]+) \} from '\.\/([^']+)';/gm)]
    .map((m) => ({
      names: m[1].split(',').map((s) => s.trim()).filter((s) => !s.startsWith('type ')),
      module: m[2],
    }));
  const exported = entries2.flatMap((e) => e.names);
  const catalogSide = entries2.filter((e) => !e.module.startsWith('primitives/')).flatMap((e) => e.names);
  const missing = names.filter((n) => !exported.includes(n));
  if (missing.length > 0) check.fail(`src/components/index.ts 未导出 catalog 零件：${missing.join('、')}`);
  else check.ok(`components 桶导出覆盖全部 ${names.length} 零件`);
  if (catalogSide.length !== names.length) {
    check.warn(
      `components 桶非 primitives 导出 ${catalogSide.length} 项 ≠ catalog ${names.length} 项`
      + `（多出：${catalogSide.filter((n) => !names.includes(n)).join('、') || '无'}）`,
    );
  }
  return names;
}

// ── B2. 技能档位路由（domain 联合类型 ↔ TIER_TO_SKILL ↔ 内置包）────────

function checkSkillRouting(packNames) {
  const types = readSource('src/domain/types.ts');
  const registry = readSource('src/skills/registry.ts');
  if (types === null || registry === null) {
    check.fail('缺 src/domain/types.ts / src/skills/registry.ts 之一，跳过路由检查');
    return;
  }
  const skillBlock = unionBlock(types.text, 'export type SkillName');
  const skillNames = skillBlock === null ? [] : quotedIn(skillBlock);
  const knowledge = types.text.match(/export type KnowledgeSkillName = '([^']+)'/)?.[1];
  const declared = knowledge === undefined ? skillNames : [...skillNames, knowledge];

  const d1 = diffSets(declared, packNames);
  if (d1.missing.length > 0) check.fail(`domain 联合类型缺内置包名：${d1.missing.join('、')}`);
  if (d1.extra.length > 0) check.fail(`domain 联合类型多出未注册包名：${d1.extra.join('、')}`);
  if (d1.missing.length === 0 && d1.extra.length === 0) {
    check.ok(`SkillName(${skillNames.length}) + KnowledgeSkillName(1) === 内置包注册表（${packNames.length} 包）`);
  }

  const tierBlock = blockOfObject(registry.text, 'const TIER_TO_SKILL');
  const tierKeys = tierBlock === null
    ? null
    : [...tierBlock.matchAll(/^\s{2}(?:'([^']+)'|([A-Za-z][A-Za-z0-9-]*)):/gm)].map((m) => m[1] ?? m[2]);
  if (tierKeys === null || tierKeys.length === 0) {
    check.fail('src/skills/registry.ts：未解析到 TIER_TO_SKILL 键');
  } else {
    const d2 = diffSets(tierKeys, skillNames);
    if (d2.missing.length > 0 || d2.extra.length > 0) {
      check.fail(`TIER_TO_SKILL 键与 SkillName 不一致（缺 ${d2.missing.join('、') || '无'}／多 ${d2.extra.join('、') || '无'}）`);
    } else check.ok(`TIER_TO_SKILL 键 === SkillName（${tierKeys.length} 档）`);
  }

  const channel = registry.text.match(/knowledgeChannel:\s*\(\)\s*=>\s*'([^']+)'/)?.[1];
  if (channel === undefined || channel !== knowledge) {
    check.fail(`knowledgeChannel() 返回值与 KnowledgeSkillName(${String(knowledge)}) 不一致：${String(channel)}`);
  } else check.ok(`knowledgeChannel() === KnowledgeSkillName（${channel}，独立通道不入档位路由）`);

  const literals = [...new Set([...registry.text.matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)].map((m) => m[1]))];
  const unknown = literals.filter((l) => !declared.includes(l) && l !== 'remediation');
  if (unknown.length > 0) check.fail(`src/skills/registry.ts 出现未注册的包名引用：${unknown.join('、')}`);
  else check.ok('skills/registry.ts 内所有包名引用均命中注册表');
}

// ── B3. 工具白名单（ToolName ↔ TOOL_WHITELIST ↔ TOOL_DAILY_LIMITS）────

function checkToolRegistry() {
  const runtime = readSource('src/skills/runtime.ts');
  const tools = readSource('src/tools/registry.ts');
  if (runtime === null || tools === null) {
    check.fail('缺 src/skills/runtime.ts / src/tools/registry.ts 之一，跳过工具检查');
    return;
  }
  const union = [...(runtime.text.match(/export type ToolName = ([^;]+);/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const whitelistBlock = blockOfArray(tools.text, 'const TOOL_WHITELIST');
  const whitelist = whitelistBlock === null
    ? null
    : [...whitelistBlock.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
  const limitsBlock = blockOfObject(tools.text, 'const TOOL_DAILY_LIMITS');
  const limitKeys = limitsBlock === null ? null : [...limitsBlock.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);

  if (union.length === 0 || whitelist === null || limitKeys === null) {
    check.fail('工具检查：未能解析 ToolName / TOOL_WHITELIST / TOOL_DAILY_LIMITS 之一');
    return;
  }
  const d1 = diffSets(whitelist, union);
  if (d1.missing.length > 0 || d1.extra.length > 0) {
    check.fail(`TOOL_WHITELIST 名与 ToolName 不一致（缺 ${d1.missing.join('、') || '无'}／多 ${d1.extra.join('、') || '无'}）`);
  } else check.ok(`TOOL_WHITELIST 名 === ToolName 联合（${whitelist.length} 工具）`);

  const d2 = diffSets(limitKeys, whitelist);
  if (d2.missing.length > 0 || d2.extra.length > 0) {
    check.fail(`TOOL_DAILY_LIMITS 键与白名单不一致（缺 ${d2.missing.join('、') || '无'}／多 ${d2.extra.join('、') || '无'}）`);
  } else check.ok(`TOOL_DAILY_LIMITS 键 === 白名单（${limitKeys.length} 项，限额表不另列）`);

  const numbers = [...(limitsBlock ?? '').matchAll(/^\s{2}[a-z_]+:\s*(-?\d+)/gm)].map((m) => Number(m[1]));
  if (numbers.some((n) => !Number.isFinite(n) || n <= 0)) {
    check.fail(`TOOL_DAILY_LIMITS 存在非正数限额：${numbers.join('、')}`);
  } else if (numbers.length > 0) check.ok(`TOOL_DAILY_LIMITS 全为正整数（${numbers.join(' / ')}）`);
}

// ── B4. 种子内容包（SEED_PACKS ↔ seeds/ 模块 ↔ 字段规范）──────────────

function checkSeedPacks() {
  const seeds = readSource('src/pipeline/seeds/index.ts');
  if (seeds === null) {
    check.fail('缺 src/pipeline/seeds/index.ts，跳过种子检查');
    return;
  }
  const dir = resolve(PROJECT_ROOT, 'src/pipeline/seeds');
  const modules = [...seeds.text.matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts').map((f) => f.replace(/\.ts$/, ''));
  const d = diffSets(files, modules);
  if (d.missing.length > 0) check.fail(`seeds/index.ts 引用了不存在的模块：${d.missing.join('、')}`);
  if (d.extra.length > 0) check.fail(`src/pipeline/seeds/ 存在未注册的模块文件：${d.extra.join('、')}`);
  if (d.missing.length === 0 && d.extra.length === 0) {
    check.ok(`seeds/ 模块文件集合 === index.ts 本地引用（${files.length} 个）`);
  }

  const layers = new Map();
  for (const name of ['SEED_META_COURSE', 'SEED_PSYCHOLOGY']) {
    const block = blockOfObject(seeds.text, `const ${name}`);
    if (block === null) {
      check.fail(`seeds/index.ts：未解析到 ${name}`);
      continue;
    }
    const packId = block.match(/packId: '([^']+)'/)?.[1];
    const version = block.match(/version: '([^']+)'/)?.[1];
    const layer = block.match(/layer: '([^']+)'/)?.[1];
    layers.set(name, layer);
    if (packId === undefined || version === undefined || layer === undefined) {
      check.fail(`seeds/${name}：packId / version / layer 缺失`);
      continue;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) check.fail(`seeds/${name}：version 非 semver：${version}`);
    if (layer !== 'meta_course' && layer !== 'real_subject') check.fail(`seeds/${name}：layer 非法：${layer}`);
    for (const field of ['subjects', 'modules', 'alus', 'reviewWhitelist']) {
      if (!new RegExp(`${field}:\\s*\\S`).test(block)) check.fail(`seeds/${name}：字段 ${field} 缺失或为空`);
    }
    check.ok(`seeds/${name}：packId=${packId} version=${version} layer=${layer}`);
  }

  const ids = [...seeds.text.matchAll(/packId: '([^']+)'/g)].map((m) => m[1]);
  if (new Set(ids).size !== ids.length) check.fail(`种子 packId 不唯一：${ids.join('、')}`);
  else if (ids.length > 0) check.ok(`种子 packId 唯一（${ids.join(' / ')}）`);

  const packsBlock = blockOfArray(seeds.text, 'const SEED_PACKS');
  const order = packsBlock === null ? null : identifiersIn(packsBlock.slice(packsBlock.indexOf('[') + 1)).filter((id) => layers.has(id));
  if (order === null || order.length === 0) check.fail('seeds/index.ts：未解析到 SEED_PACKS');
  else if (layers.get(order[0]) !== 'meta_course') {
    check.fail(`SEED_PACKS 首包必须是 meta_course（首启装配顺序），实为 ${String(layers.get(order[0]))}`);
  } else check.ok(`SEED_PACKS 顺序：${order.join(' → ')}（首包 meta_course）`);
}

// ── 运行 ─────────────────────────────────────────────────────────────

console.log(`静态层：工程根 ${PROJECT_ROOT}`);
console.log(`静态层：只读事实源 ${SKILL_ROOT}`);
const builtIn = checkSkillPacks();
const componentNames = checkComponents();
checkSkillRouting(builtIn.names);
checkToolRegistry();
checkSeedPacks();
check.info(`汇总：零件 ${componentNames.length} · 技能包 ${builtIn.names.length}；本层为文本解析，非运行时断言`);
process.exit(check.report());
