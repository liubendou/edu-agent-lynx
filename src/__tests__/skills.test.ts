// M2d 技能包运行时 + 5 包资产 + 路由 + 热更新客户端测试（ARCHITECTURE §8/§10/§11/§16-D3；CONTRACTS §6）。
// 保真断言：以 node:fs 读 /skill/ 只读源做逐字比对（trim 口径容忍首尾空白），防止资产装载改写原文。
import { expect, test } from '@rstest/core';
import { readFileSync } from 'node:fs';

import type { KnowledgeSkillName, SkillName } from '../domain/types';
import { createMemoryKVStore } from '../storage/kv';
import { Repositories } from '../storage/repos';
import { DEFAULT_APP_SETTINGS, SKILL_PACKS_KEY, type InstalledSkillPack } from '../storage/repos/collections';
import { BUILT_IN_PACKS, BUILT_IN_PACK_MAP } from '../skills/packs';
import { quickLearningParams, quickRecallParams } from '../skills/packs/quick-learning';
import {
  extractProfileFragment, extractStrategyLibraryPoints, retrieveScoreBoostFragment,
} from '../skills/packs/score-boost';
import { compareVersions, SkillRuntimeImpl, type OverridePack } from '../skills/runtime';
import { createSkillRegistry, type RouteMode } from '../skills/registry';
import { createSkillUpdater, hashHex, type FetchLike } from '../skills/updater';
import { SKILL_SRC_ROOT } from './skill-root';

type AnyPackName = SkillName | KnowledgeSkillName;
const ALL_NAMES: AnyPackName[] = ['quick-learning', 'review', 'standard-learning', 'deep-learning', 'score-boost'];
const SRC_ROOT = SKILL_SRC_ROOT;

/** 读只读源 SKILL.md：剥 frontmatter，提取 description 原文与正文。 */
function readSource(name: string): { description: string; body: string } {
  const src = readFileSync(`${SRC_ROOT}/${name}/SKILL.md`, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  expect(m).not.toBeNull();
  const fm = m![1];
  const body = src.slice(m![0].length);
  const dm = /^description: "(.*)"$/m.exec(fm);
  expect(dm).not.toBeNull();
  return { description: dm![1], body };
}

/* ───────────── A. 5 包装载完整性与内容保真 ───────────── */

test('A1 内置 5 包齐备：name 唯一、version 1.0.0、mode 划分正确', () => {
  expect(BUILT_IN_PACKS).toHaveLength(5);
  expect(BUILT_IN_PACKS.map((p) => p.summary.name)).toEqual(ALL_NAMES);
  for (const pack of BUILT_IN_PACKS) {
    expect(pack.summary.version).toBe('1.0.0');
    expect(pack.summary.description.length).toBeGreaterThan(0);
    expect(pack.summary.description).toContain('Invoke when'); // §7.8① description 写"何时用"
  }
  for (const name of ['quick-learning', 'review', 'standard-learning', 'deep-learning'] as const) {
    expect(BUILT_IN_PACK_MAP.get(name)!.summary.mode).toBe('pattern');
  }
  expect(BUILT_IN_PACK_MAP.get('score-boost')!.summary.mode).toBe('knowledge'); // 总控 §0：不参与四档调度
});

test('A2 promptTemplate 与源 SKILL.md 正文逐字一致（trim 口径）', () => {
  for (const pack of BUILT_IN_PACKS) {
    const { body } = readSource(pack.summary.name);
    const loaded = pack.loadBody();
    expect(loaded.promptTemplate.trim()).toBe(body.trim());
  }
});

test('A3 description 为 frontmatter 原文（§7.8① 何时用）', () => {
  for (const pack of BUILT_IN_PACKS) {
    const { description } = readSource(pack.summary.name);
    expect(pack.summary.description).toBe(description);
  }
});

test('A4 references 原文逐字装载（key=装载路径）', () => {
  for (const pack of BUILT_IN_PACKS) {
    const refs = pack.summary.references ?? [];
    expect(refs.length).toBeGreaterThan(0);
    const { referenceContents } = pack.loadBody();
    for (const ref of refs) {
      const src = readFileSync(`${SRC_ROOT}/${pack.summary.name}/${ref}`, 'utf8');
      expect(referenceContents[ref], ref).not.toBeUndefined();
      expect(referenceContents[ref].trim()).toBe(src.trim());
    }
  }
});

test('A5 组件按名引用划分与 ARCHITECTURE §10 一致（12 生成主力）', () => {
  expect(BUILT_IN_PACK_MAP.get('quick-learning')!.summary.components).toEqual(
    ['MapView', 'QuestionCard', 'ConceptCard', 'TTSBar'],
  );
  expect(BUILT_IN_PACK_MAP.get('review')!.summary.components).toEqual(
    ['RevealCard', 'QuestionCard', 'FeedbackBar', 'SourceLink'],
  );
  expect(BUILT_IN_PACK_MAP.get('standard-learning')!.summary.components).toEqual(
    ['ExplainStep', 'QuestionCard', 'ConceptCard', 'TTSBar', 'ChoiceGrid', 'SourceLink'],
  );
  expect(BUILT_IN_PACK_MAP.get('deep-learning')!.summary.components).toEqual(
    ['MapView', 'ProgressRing', 'QuestionCard', 'MicButton', 'TTSBar', 'ChoiceGrid'],
  );
  expect(BUILT_IN_PACK_MAP.get('score-boost')!.summary.components).toEqual([]); // knowledge 型无组件
});

test('A6 工具声明与参数断言（quick 一批两用；硬规则1 卡不入队）', () => {
  const quick = BUILT_IN_PACK_MAP.get('quick-learning')!.summary;
  expect(quick.tools).toEqual(['tts_speak']);
  expect(quick.params).toEqual(quickLearningParams);
  expect(quickLearningParams).toEqual({ budgetMinutes: [3, 10], goal: 'map', cardGeneration: false });
  expect(quickRecallParams).toEqual({ budgetMinutes: [1, 1.5], goal: 'recall', cardGeneration: false }); // 60~90 秒唤醒
  expect(BUILT_IN_PACK_MAP.get('review')!.summary.tools).toEqual([]);
  expect(BUILT_IN_PACK_MAP.get('review')!.summary.params?.cardGeneration).toBe(false); // 复习不生卡
  expect(BUILT_IN_PACK_MAP.get('standard-learning')!.summary.tools).toEqual(['tts_speak']);
  expect(BUILT_IN_PACK_MAP.get('standard-learning')!.summary.params?.cardGeneration).toBe(true);
  expect(BUILT_IN_PACK_MAP.get('deep-learning')!.summary.tools).toEqual(['tts_speak', 'asr_transcribe']);
  expect(BUILT_IN_PACK_MAP.get('deep-learning')!.summary.params?.cardGeneration).toBe(true);
  expect(BUILT_IN_PACK_MAP.get('score-boost')!.summary.tools).toEqual([]);
  expect(BUILT_IN_PACK_MAP.get('score-boost')!.summary.params).toBeUndefined();
});

/* ───────────── B. 索引 + 四档路由 + 点名直查 ───────────── */

test('B1 四档即四域：route 恒等映射', () => {
  const registry = createSkillRegistry(new SkillRuntimeImpl());
  for (const tier of ['quick-learning', 'review', 'standard-learning', 'deep-learning'] as SkillName[]) {
    expect(registry.route(tier)).toBe(tier);
  }
});

test('B2 remediation → 标准档 90 秒补讲（硬规则3）', () => {
  const registry = createSkillRegistry(new SkillRuntimeImpl());
  expect(registry.route('remediation')).toBe('standard-learning');
});

test('B3 候选集每档收敛 1~2 个，不含 score-boost', () => {
  const registry = createSkillRegistry(new SkillRuntimeImpl());
  const modes: RouteMode[] = ['quick-learning', 'review', 'standard-learning', 'deep-learning', 'remediation'];
  for (const mode of modes) {
    const cands = registry.candidates(mode);
    expect(cands.length).toBeGreaterThanOrEqual(1);
    expect(cands.length).toBeLessThanOrEqual(2);
    expect(cands).not.toContain('score-boost');
    expect(cands).toContain(registry.route(mode)); // 主档必在候选集
  }
});

test('B4 用户点名直查：按序首匹配、无命中 null', () => {
  const registry = createSkillRegistry(new SkillRuntimeImpl());
  expect(registry.routeByMention('帮我复习一下昨天的')).toBe('review');
  expect(registry.routeByMention('快速给我搭个框架')).toBe('quick-learning');
  expect(registry.routeByMention('这块帮我系统学一遍')).toBe('standard-learning');
  expect(registry.routeByMention('这一章我要彻底吃透')).toBe('deep-learning');
  expect(registry.routeByMention('考前两周怎么提分')).toBe('score-boost');
  expect(registry.routeByMention('今天天气不错')).toBeNull();
});

test('B5 score-boost 走独立 knowledge 通道', () => {
  const registry = createSkillRegistry(new SkillRuntimeImpl());
  expect(registry.knowledgeChannel()).toBe('score-boost');
  expect(registry.isKnowledge('score-boost')).toBe(true);
  expect(registry.isKnowledge('review')).toBe(false);
});

/* ───────────── C. 装载协议（轻量索引常驻 + 正文按需加载） ───────────── */

test('C1 listSummaries 仅 name+description（不暴露正文，保持窗口轻量）', () => {
  const rt = new SkillRuntimeImpl();
  const summaries = rt.listSummaries();
  expect(summaries).toHaveLength(5);
  for (const s of summaries) {
    expect(Object.keys(s).sort()).toEqual(['description', 'name']);
  }
});

test('C2 正文惰性加载：初始未物化、loadBody 后缓存同引用、getBody 为别名', () => {
  const rt = new SkillRuntimeImpl();
  expect(rt.isBodyLoaded('review')).toBe(false);
  const first = rt.loadBody('review');
  expect(rt.isBodyLoaded('review')).toBe(true);
  expect(rt.getBody('review')).toBe(first); // 缓存命中返回同一引用
  expect(first.name).toBe('review');
  expect(first.promptTemplate.length).toBeGreaterThan(0);
});

test('C3 loadReferenceContent：内置命中与未命中空串', () => {
  const rt = new SkillRuntimeImpl();
  const refs = BUILT_IN_PACK_MAP.get('quick-learning')!.summary.references!;
  const src = readFileSync(`${SRC_ROOT}/quick-learning/${refs[0]}`, 'utf8');
  expect(rt.loadReferenceContent('quick-learning', refs[0]).trim()).toBe(src.trim());
  expect(rt.loadReferenceContent('quick-learning', 'references/不存在.md')).toBe('');
});

test('C4 applyOverrides 版本选择：低于内置拒用、只升不降、平版本热包胜、缓存失效', () => {
  const rt = new SkillRuntimeImpl();
  const hot = (version: string, template: string): OverridePack => {
    const s = BUILT_IN_PACK_MAP.get('review')!.summary;
    return {
      name: 'review', description: s.description, version, mode: s.mode,
      promptTemplate: template, tools: s.tools, components: s.components,
    };
  };
  // 低于内置版本：拒（App 升级后旧热包不生效）
  rt.applyOverrides([hot('0.9.0', '# 低版本正文')]);
  expect(rt.installedVersion('review')).toBe('1.0.0');
  expect(rt.loadBody('review').promptTemplate).toContain('复利引擎'); // 仍是内置正文
  // 高于内置：接受（已物化的缓存同时失效）
  rt.applyOverrides([hot('1.5.0', '# 热包正文A')]);
  expect(rt.installedVersion('review')).toBe('1.5.0');
  expect(rt.loadBody('review').promptTemplate).toBe('# 热包正文A');
  // 已有更高热包：不降级
  rt.applyOverrides([hot('1.2.0', '# 热包正文B')]);
  expect(rt.installedVersion('review')).toBe('1.5.0');
  // 平版本：热包胜（换新内容）
  rt.applyOverrides([hot('1.5.0', '# 热包正文C')]);
  expect(rt.loadBody('review').promptTemplate).toBe('# 热包正文C');
  // 热包 description 覆盖常驻索引
  const hot2 = { ...hot('1.5.0', '# 热包正文C'), description: '热包何时用描述' };
  rt.applyOverrides([hot2]);
  expect(rt.listSummaries().find((s) => s.name === 'review')!.description).toBe('热包何时用描述');
});

test('C5 hydrateFromStorage：合法热包冷启动生效；损坏数据忽略走内置', async () => {
  const kv = createMemoryKVStore();
  const installed: Record<string, InstalledSkillPack> = {
    review: {
      name: 'review', description: '热包描述', version: '1.2.0', mode: 'pattern',
      promptTemplate: '# 冷启动热包正文', tools: [], components: [],
      sha256: 'abc', appliedAt: '2026-10-15T00:00:00.000Z',
    },
  };
  await kv.set(SKILL_PACKS_KEY, JSON.stringify(installed));
  const rt = new SkillRuntimeImpl();
  await rt.hydrateFromStorage(kv);
  expect(rt.installedVersion('review')).toBe('1.2.0');
  expect(rt.loadBody('review').promptTemplate).toBe('# 冷启动热包正文');
  // 损坏 JSON：不抛错、内置兜底
  const kvBad = createMemoryKVStore();
  await kvBad.set(SKILL_PACKS_KEY, '{损坏数据');
  const rt2 = new SkillRuntimeImpl();
  await expect(rt2.hydrateFromStorage(kvBad)).resolves.toBeUndefined();
  expect(rt2.installedVersion('review')).toBe('1.0.0');
});

test('C6 compareVersions 语义化比较', () => {
  expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  expect(compareVersions('2.0', '10.0')).toBe(-1); // 数值比较非字符串
  expect(compareVersions('1.0.1', '1.0')).toBe(1); // 缺段补 0
});

/* ───────────── D. score-boost 三处注入（ARCHITECTURE §11） ───────────── */

test('D1 ②段策略库要点：总纲 + 证据最强 5 技术（含反面清单）', () => {
  const fragment = extractStrategyLibraryPoints();
  expect(fragment).toContain('## 0. 一句话总纲');
  expect(fragment).toContain('检索练习');
  expect(fragment).toContain('## 一、证据最强的 5 个技术');
  expect(fragment).toContain('反面清单'); // 检索练习的反面清单（重读/划重点=假努力）
  expect(fragment).not.toContain('错题本方法论'); // 只含 ②段约定的切片
});

test('D2 ⑤段画像片段：提分闭环 + 刷题错因归类', () => {
  const fragment = extractProfileFragment();
  expect(fragment).toContain('## 二、提分闭环系统');
  expect(fragment).toContain('1-2-4-7-15'); // 闭环间隔复测原文
  expect(fragment).toContain('## 四、刷题方法论');
  expect(fragment).toContain('错因归类'); // 消费成绩/错因画像的锚点
});

test('D3 ⑧段按需检索：关键词命中、文档序拼接、无命中空串', () => {
  expect(retrieveScoreBoostFragment(['错因'])).toContain('错题本方法论');
  expect(retrieveScoreBoostFragment(['状态'])).toContain('耶克斯-多德森定律');
  const multi = retrieveScoreBoostFragment(['刷题', '记忆']);
  expect(multi).toContain('刷题方法论');
  expect(multi).toContain('记忆方法论');
  expect(multi.indexOf('刷题方法论')).toBeLessThan(multi.indexOf('记忆方法论')); // 按文档序去重拼接
  expect(retrieveScoreBoostFragment(['没有任何命中的词'])).toBe('');
});

/* ───────────── E. updater 全链路（本地 fixture，不走网络） ───────────── */

const MANIFEST_URL = 'https://fixture.test/skill-manifest.json';
const packUrl = (name: string, version: string): string => `https://fixture.test/packs/${name}-${version}.json`;

/** fixture fetch：files 按 URL 返回 200 正文；failures 命中返回 HTTP 500；未登记返回 404。 */
function fixtureFetch(files: Record<string, string>, failures: string[] = []): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    if (failures.includes(url)) return { ok: false, status: 500, text: async () => '' };
    const body = files[url];
    if (body === undefined) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
  return Object.assign(fn, { calls });
}

/** 构造远端包 JSON（字段与内置对齐，正文可覆盖；模拟静态托管的包文件）。 */
function remotePackJson(name: AnyPackName, version: string, overrides: Record<string, unknown> = {}): string {
  const s = BUILT_IN_PACK_MAP.get(name)!.summary;
  return JSON.stringify({
    name,
    description: s.description,
    version,
    mode: s.mode,
    promptTemplate: `# ${name} 热更新正文 v${version}`,
    tools: [...s.tools],
    components: [...s.components],
    ...overrides,
  });
}

function fixtureManifest(entries: Array<{ name: string; version: string; url: string; sha256: string }>): string {
  return JSON.stringify({ packs: entries, generatedAt: '2026-10-15T00:00:00.000Z' });
}

test('E1 hashHex 与 SHA-256 标准向量一致', async () => {
  expect(await hashHex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('E2 新版本应用成功全链路：比对→下载→校验→存储→runtime 注入', async () => {
  const rt = new SkillRuntimeImpl();
  const kv = createMemoryKVStore();
  const reviewJson = remotePackJson('review', '1.1.0', {
    referenceContents: { 'references/资源清单.md': '# 远端资源清单 v1.1' },
  });
  const scoreJson = remotePackJson('score-boost', '1.1.0');
  const manifestJson = fixtureManifest([
    { name: 'review', version: '1.1.0', url: packUrl('review', '1.1.0'), sha256: await hashHex(reviewJson) },
    { name: 'score-boost', version: '1.1.0', url: packUrl('score-boost', '1.1.0'), sha256: await hashHex(scoreJson) },
  ]);
  const fetch = fixtureFetch({
    [MANIFEST_URL]: manifestJson,
    [packUrl('review', '1.1.0')]: reviewJson,
    [packUrl('score-boost', '1.1.0')]: scoreJson,
  });
  const updater = createSkillUpdater(rt, kv, { fetch, now: () => '2026-10-15T12:00:00.000Z' });

  expect(await updater.checkAndApply({ manifestUrl: MANIFEST_URL })).toBe('updated');
  // 存储生效（skill_packs 集合，整体原子写）
  const installed = JSON.parse((await kv.get(SKILL_PACKS_KEY))!) as Record<string, InstalledSkillPack>;
  expect(Object.keys(installed).sort()).toEqual(['review', 'score-boost']);
  expect(installed['review'].version).toBe('1.1.0');
  expect(installed['review'].sha256).toBe(await hashHex(reviewJson)); // 审计留痕
  expect(installed['review'].appliedAt).toBe('2026-10-15T12:00:00.000Z');
  // runtime 生效（热更新已应用包 > 内置包）
  expect(rt.installedVersion('review')).toBe('1.1.0');
  expect(rt.loadBody('review').promptTemplate).toContain('热更新正文 v1.1.0');
  expect(rt.loadReferenceContent('review', 'references/资源清单.md')).toBe('# 远端资源清单 v1.1');
  expect(rt.installedVersion('score-boost')).toBe('1.1.0');
});

test('E3 sha256 不匹配：拒用并整体回滚（存储 null、runtime 保持内置）', async () => {
  const rt = new SkillRuntimeImpl();
  const kv = createMemoryKVStore();
  const reviewJson = remotePackJson('review', '1.1.0');
  const manifestJson = fixtureManifest([
    { name: 'review', version: '1.1.0', url: packUrl('review', '1.1.0'), sha256: 'deadbeef' },
  ]);
  const fetch = fixtureFetch({ [MANIFEST_URL]: manifestJson, [packUrl('review', '1.1.0')]: reviewJson });
  const updater = createSkillUpdater(rt, kv, { fetch });

  expect(await updater.checkAndApply({ manifestUrl: MANIFEST_URL })).toBe('rolled_back');
  expect(await kv.get(SKILL_PACKS_KEY)).toBeNull();
  expect(rt.installedVersion('review')).toBe('1.0.0'); // 内置兜底
});

test('E4 下载失败：整体回滚', async () => {
  const rt = new SkillRuntimeImpl();
  const kv = createMemoryKVStore();
  const reviewJson = remotePackJson('review', '1.1.0');
  const manifestJson = fixtureManifest([
    { name: 'review', version: '1.1.0', url: packUrl('review', '1.1.0'), sha256: await hashHex(reviewJson) },
  ]);
  const fetch = fixtureFetch({ [MANIFEST_URL]: manifestJson }, [packUrl('review', '1.1.0')]); // 包下载 500
  const updater = createSkillUpdater(rt, kv, { fetch });

  expect(await updater.checkAndApply({ manifestUrl: MANIFEST_URL })).toBe('rolled_back');
  expect(await kv.get(SKILL_PACKS_KEY)).toBeNull();
  expect(fetch.calls).toHaveLength(2); // manifest 已拉、包失败即止
});

test('E5 版本相同：skipped 且只拉 manifest（无谓下载不发生）', async () => {
  const rt = new SkillRuntimeImpl();
  const kv = createMemoryKVStore();
  const reviewJson = remotePackJson('review', '1.0.0'); // 与内置同版本
  const manifestJson = fixtureManifest([
    { name: 'review', version: '1.0.0', url: packUrl('review', '1.0.0'), sha256: await hashHex(reviewJson) },
  ]);
  const fetch = fixtureFetch({ [MANIFEST_URL]: manifestJson, [packUrl('review', '1.0.0')]: reviewJson });
  const updater = createSkillUpdater(rt, kv, { fetch });

  expect(await updater.checkAndApply({ manifestUrl: MANIFEST_URL })).toBe('skipped');
  expect(fetch.calls).toEqual([MANIFEST_URL]); // 只 fetch manifest 一次
  expect(await kv.get(SKILL_PACKS_KEY)).toBeNull();
});

test('E6 失败回滚保留既有热包（快照语义：回到应用前状态）', async () => {
  const rt = new SkillRuntimeImpl();
  const kv = createMemoryKVStore();
  // 第一轮：应用 1.1.0 成功
  const v1Json = remotePackJson('review', '1.1.0');
  const fetch1 = fixtureFetch({
    [MANIFEST_URL]: fixtureManifest([
      { name: 'review', version: '1.1.0', url: packUrl('review', '1.1.0'), sha256: await hashHex(v1Json) },
    ]),
    [packUrl('review', '1.1.0')]: v1Json,
  });
  const updater = createSkillUpdater(rt, kv, { fetch: fetch1 });
  expect(await updater.checkAndApply({ manifestUrl: MANIFEST_URL })).toBe('updated');
  // 第二轮：2.0.0 但 sha256 坏 → 整体回滚到第一轮后状态
  const v2Json = remotePackJson('review', '2.0.0');
  const fetch2 = fixtureFetch({
    [MANIFEST_URL]: fixtureManifest([
      { name: 'review', version: '2.0.0', url: packUrl('review', '2.0.0'), sha256: 'bad' },
    ]),
    [packUrl('review', '2.0.0')]: v2Json,
  });
  const updater2 = createSkillUpdater(rt, kv, { fetch: fetch2 });
  expect(await updater2.checkAndApply({ manifestUrl: MANIFEST_URL })).toBe('rolled_back');
  const installed = JSON.parse((await kv.get(SKILL_PACKS_KEY))!) as Record<string, InstalledSkillPack>;
  expect(installed['review'].version).toBe('1.1.0'); // 既有热包未被破坏
  expect(rt.installedVersion('review')).toBe('1.1.0');
});

test('E7 manifest 拉取失败：skipped（不动任何本地状态，下次再试）', async () => {
  const rt = new SkillRuntimeImpl();
  const kv = createMemoryKVStore();
  const fetch = fixtureFetch({}, [MANIFEST_URL]);
  const updater = createSkillUpdater(rt, kv, { fetch });

  expect(await updater.checkAndApply({ manifestUrl: MANIFEST_URL })).toBe('skipped');
  expect(await kv.get(SKILL_PACKS_KEY)).toBeNull();
  expect(rt.installedVersion('review')).toBe('1.0.0');
});

test('E8 checkAndApplyFromSettings：未配置 skipped；配置后走更新', async () => {
  const kv = createMemoryKVStore();
  const repos = new Repositories(kv);
  const rt = new SkillRuntimeImpl();
  const reviewJson = remotePackJson('review', '1.2.0');
  const fetch = fixtureFetch({
    [MANIFEST_URL]: fixtureManifest([
      { name: 'review', version: '1.2.0', url: packUrl('review', '1.2.0'), sha256: await hashHex(reviewJson) },
    ]),
    [packUrl('review', '1.2.0')]: reviewJson,
  });
  const updater = createSkillUpdater(rt, kv, { fetch });

  expect(await updater.checkAndApplyFromSettings()).toBe('skipped'); // AppSettings.skillUpdateManifestUrl 未配置
  await repos.saveSettings({ ...DEFAULT_APP_SETTINGS, skillUpdateManifestUrl: MANIFEST_URL });
  expect(await updater.checkAndApplyFromSettings()).toBe('updated');
  expect(rt.installedVersion('review')).toBe('1.2.0');
});
