# CHANGELOG

格式（electron-app-engineering §九）：**一条一改** —— 说清「改了什么 / 为什么 / 怎么回滚」。
版本号 = 产品版本，实验分支加 `-lab.N` 后缀；稳定线与实验线物理分开（本工程：`master` = 稳定线，`coldwhite-v1` = 实验分支）。

纪律备注：本文件只记录**实际发生**的改动；本轮由他人并行进行、无法确认的内容一律写成「待填」，不编造结论。

---

## 0.0.0-lab.1 — 2026-10-17 · 分支 coldwhite-v1

基线：上一提交 `54a1b62`（snapshot: preserve in-flight 首屏对话化 work before cold-white + de-mock rework）。`master` 稳定线本轮未改动。

### 新增（本轮工程化纪律落地：验证体系四层 + 单一事实源校验）

- `scripts/verify-static.mjs`（静态层）：只读文本的规范校验 ——
  ① `skill/` 五个技能包各自 `SKILL.md` 存在 + frontmatter 合法（`name` 命名规则且与目录名一致、`description` 20~1024 字、只允许 `name`/`description` 两键、正文 >500 行仅告警）；
  ② 单一事实源一致性：16 零件（`a2ui/catalog.ts` COMPONENT_NAMES ↔ A2UI_CATALOG ↔ `a2ui/surface.tsx` 渲染注册表 ↔ `components/index.ts` 桶导出）、技能包（`skills/packs/index.ts` 注册表 ↔ pack 名 ↔ `skill/` 目录 ↔ 内置包 manifest 的 description 镜像）、工具白名单（`ToolName` ↔ `TOOL_WHITELIST` ↔ `TOOL_DAILY_LIMITS`）、种子包（`SEED_PACKS` ↔ `pipeline/seeds/` 模块文件、packId 唯一、version 为 semver、layer 合法、首包 meta_course）。
  为什么：同一个列表此前在 2~4 处各存一份，靠人读保证一致；新增一项漏改一处只能等运行时/评审才发现（§五 验收标准：新增一项只改 1 个注册表 + 1 个分支）。
- `scripts/verify-runtime.mjs`（运行时层）：起 `lynx.web-preview.config.ts` 的 Web 预览 dev server（端口默认 3000，`EDU_VERIFY_PORT` 可覆盖），做真实 HTTP 断言 —— 入口 HTML 200 且含 `#root` 与脚本/样式引用、外壳资源 200 且非空、应用 bundle 200 且 ≥100KB、bundle 含 lynx 运行时标记与 catalog 全部 16 个零件名、启动日志无编译错误；收尾杀进程树（Windows 走 `taskkill /T`）。
  为什么：本工程目标平台是 Android，但开发机（Windows）无真机/模拟器，运行时断言只能在 Web 预览落点；不吃「看代码应该没问题」（§八 关键纪律）。
- `scripts/verify.mjs` + `package.json`（仅 `scripts` 块）新增入口：
  `npm run verify` = 校验 → 类型检查 → 单元 → 打包 → 运行时，**任一步失败即停**并把失败退出码传出；
  按层入口 `npm run verify:static` / `npm run verify:unit` / `npm run verify:runtime`（§九 构建顺序固定）。
- 未引任何新依赖（只用 Node 内置模块 `fs/path/url/child_process/net`）；**未改** `dependencies` / `devDependencies` 任何版本，未动 `package.json` 其他字段。

### 承接（当时写成「待填」的三项）

当时无法确认，故按纪律写「待填」，不编造结论；三项已由下一节 `0.0.0-lab.2` 落地并复核。此处只留当时的已知事实供追溯：`src/pages/Home.tsx:67` 注释写明删除「开始小课」按钮，而 `src/__tests__/pages.test.tsx:225` 仍断言该文案存在 → 单元层 1 条失败（见下）。

### 验证（2026-10-17 实测原始结果）

- `npm run verify:static` → 退出码 **0**（27 通过 / 0 失败 / 0 警告）
- `npm run verify:runtime` → 退出码 **0**（9 通过 / 0 失败；dev server 就绪，应用 bundle 3023965 字节）
- `npm run typecheck`（`tsc -b`）→ 退出码 **0**
- `npm test`（`rstest run`）→ 退出码 **1**：343 通过 / **1 失败**（`src/__tests__/pages.test.tsx:225` 找不到文本「开始小课」）
- `npm run build`（`rspeedy build`）→ 退出码 **0**（`dist/main.lynx.bundle` 461.9 kB；伴随 `MaxListenersExceededWarning` / `ObjectRef is not unref` 告警，不影响退出码）
- `npm run verify`（冒烟）→ 退出码 **1**：第 3 步「单元测试」失败即停（与上同一处失败）
- 降级说明（如实记录）：jsdom 直接加载 Web 预览产物不可行（预览外壳 `index.js` 依赖 Worker/WASM，实测 `ReferenceError: Worker is not defined`）；因此「真实 DOM 断言」由单元层 `rstest` + `@lynx-js/react/testing-library` + jsdom 承担（`pages.test.tsx`、`a2ui-surface.test.tsx`），运行时脚本只做 HTTP 层断言；真机/模拟器（adb + LynxView）断言本轮未做（无 Android 设备）。

### 回滚

- 回退到改造前的快照：`git switch coldwhite-v1 && git reset --hard 54a1b62`
  （⚠️ 会丢弃工作区未提交改动，含他人并行改造；回滚前先确认是否需要先备份）
- 只回退本轮工程化落地（三件相互独立，删掉即回到基线行为）：删除 `scripts/`、把 `package.json` 的 `scripts` 恢复为 5 项（`build`/`dev`/`preview`/`typecheck`/`test`）、删除本文件 `CHANGELOG.md`
- 放弃整个实验分支、回稳定线：`git switch master`（`master` 本轮未被写入）
- 回滚后自检：`npm run typecheck && npm test && npm run build` —— 应与 `54a1b62` 基线一致（typecheck / build 退出码 0；test 仍有 1 条既有失败）

### 结束行（§十二 模板）

当前：模块 = 工程化验证体系 / 改动 = 新增 scripts 三层验证 + verify 入口 + 本变更记录 / 验证结果 = 静态 0、运行时 0、typecheck 0、build 0、单元 1 条既有失败→`verify` 退出码 1 / 回滚方式 = 见上「回滚」。

---

## 0.0.0-lab.2 — 2026-10-17 · 分支 coldwhite-v1

基线：`0.0.0-lab.1` 的同一工作区（未提交）。`master` 稳定线仍未改动。本节落地 lab.1 的三项「待填」。

### 一、冷白极简视觉重构

- **改了什么**：`design-system/` 四件 + `App.css` + `components/components.css` + `design-system.test.ts`。
  - `tokens.css`：亮色整体换冷白 —— `--ambient:#F7F9FC`（原暖米 `#F6F3EC`）、`--surface:#FFFFFF`（原 `#FDFBF6`）、`--faint:#E4E8EE`、`--ink:#171A20`（原暖黑 `#221D18`）、`--ink-soft:#5A6472`、`--accent:#33506F`、`--good:#2F6A55`、`--warn:#8A6414`、`--bad:#A63C36`。暗色不是另做一套，而是同一设计的低亮度冷调版（`--ambient:#0F1216` / `--surface:#161A20` / `--ink:#E9EDF2` / `--accent:#8AA9D2` …）。
  - `typography.css`：换成无衬线系统字体栈（不引外部字体、不嵌字体文件）。
  - `motion.css`：补四个规范时长 token `--dur-micro:120ms` / `--dur-base:200ms` / `--dur-slow:600ms` / `--dur-draw:800ms`（原先仓库里只有 90/120/180/240/320ms 那一族，与设计文档的规范时长本就是两套值；本轮按「四个规范 token 必须存在」补齐，旧族原样保留，未合并——合并会牵动 `components.css` 全部时长，超出本轮范围）。
  - `App.css` / `components.css`：层级表达改为「1px 冷灰 `--faint` 细边 + 冷白分层」，不用投影；页面级留白放大到 `--space-6` / `--space-8`。
  - `design-system.test.ts`：18 处硬编码色值断言同步换新，并加冷调判据（B 通道 ≥ R）+ WCAG AA 对比度判据。
- **为什么**：产品要求「视觉冷白极简」（纯白底、无衬线、大留白、弱边框、几乎无阴影）；原设计是暖色「纸与墨」。
- **守住的不变量**（这是本轮验收的重点）：动效三档 `full/reduced/static`（文档称 `minimal`）的名称、语义、可配置入口**未动**，minimal 档信息不丢失（只把 duration 归零）；`--*` 变量名**零重命名**；`theme.ts` / `motion.ts` 的对外导出签名与数值**一字未动**（`App.tsx` 等消费方零改动）。
- **实测对比度**（主 agent 独立复算，非采信实现者自述）：`--ink` 对白底 17.4:1、`--ink-soft` 6.0:1、`--accent` 8.34:1、`--warn` 5.37:1，全部 ≥ AA。
- **遗留（如实记录）**：① 暗色主题**保留**（改冷调版）而非删除 —— 删 `.theme-dark` 会让 `App.tsx` 切到 `theme-dark` 时整页无变量；若产品决定「只做浅色」，需同时改 `App.tsx` 主题接线。② 上述时长 token 双轨并存。
- **回滚**：`git checkout 54a1b62 -- src/design-system src/App.css src/components/components.css src/__tests__/design-system.test.ts`

### 二、去掉运行时 mock（缺 Key 显式报错，不静默降级）

- **改了什么**：新增 `src/cloud/unconfigured.ts`（`UnconfiguredCloudClient` + `UNCONFIGURED_MESSAGE`）；`createCloudClient` 新增 `allowMock?: boolean`（**默认 false**），`config.mock === true` 且未显式 `allowMock` → 返回 `UnconfiguredCloudClient`；`client.ts` 的 `CloudErrorCode` 增 `'not_configured'`；`composition.ts` 的 `CompositionOptions` 增 `allowMock` 并透传；`tools/vision.ts` 缺 Key 从 `'invalid_response'` +「Mock 模式」旧措辞改为 `'not_configured'` +「去设置页填 API Key」；`cloud.local.example.json` 过期值 `modelFlash: deepseek-v4.1-flash` 改回真实常量 `deepseek-flash`，注释改写。
- **行为契约**：`UnconfiguredCloudClient` 实现与 `CloudClient` 相同的 `CloudLikeClient` 接口，**每次调用都抛** `CloudClientError('not_configured')`，`retryable:false`、`producedOutput:false`，消息面向用户给「下一步做什么」，不暴露堆栈。`MockCloudClient` 只在测试显式 `allowMock:true` 或直接注入 `options.cloud` 时生效。
- **为什么**：原来 `resolveCloudConfig` 令 `mock = (apiKey === '')`，`createCloudClient` 在 mock 时直接返回 `MockCloudClient` —— 生产环境没配 Key 会**静默走假数据**，用户看到正常输出但那是 mock，违反验收 S1.8「任何情况下不出现空白回合或静默失败」与红线 R-P3。
- **影响面**：约 20 个既有测试直接注入 `options.cloud`，一行未改；仅 `cloud-mock.test.ts` 那条「配置缺失 → 返回 MockCloudClient」的断言必须翻转为 `UnconfiguredCloudClient`（已翻，并补 `not_configured` / 不可重试 / 未产出断言）。`config.mock` 字段语义保留（仍表示「无 Key」），`cloud-config.test.ts` 不受影响。
- **回滚**：`git checkout 54a1b62 -- src/cloud src/composition.ts src/tools/vision.ts cloud.local.example.json src/__tests__/cloud-mock.test.ts src/__tests__/tools-vision-grade.test.ts src/__tests__/acceptance.test.ts`

### 三、首屏对话化收口（三级兜底 + 无 Key 引导）

- **改了什么**：
  - 修掉唯一失败测试 `pages.test.tsx:225`：`Home.tsx` 已删「开始小课」按钮、首屏改成对话引导；**以对话化后的真实 DOM 为准改测试**，没有为了迁就旧断言把首屏改回按钮式。
  - `chat/items.ts` 新增 `notice` 对话项（`ChatNoticeItem`）、三条兜底文案（`TURN_FAILURE_NOTICE` / `TURN_BUSY_NOTICE` / `TURN_NO_KEY_NOTICE`）与 `isRetryable`（排除 `answer` / `tool_result` —— 它们有记账副作用，重复重放会重复写 FSRS/流水，故不给重试入口）。
  - `chat/MessageList.tsx`：`notice` 项**在会话流里就地渲染**为可见提示，并带「接着讲」/「去设置页填 API Key」入口，用户不必自己找路。
  - `pages/Chat.tsx`：`turn()` 的三条失败路径（正常失败 / 本回合无任何可上屏内容 / 上一回合未跑完又发）**一律落可见提示、不留白**；并且不再把原始错误信息拼给用户（原实现是「这一回合没接上（${err.message}）」——泄露内部错误）。
  - `pages/Session.tsx`：同样把 `turnError` 换成「只放面向用户的提示」+「接着讲」重试（`failedRef` 持有可安全重放的 observation）。
  - `App.tsx`：冷启动读一次 `loadCloudConfig()`，把「无 Key」判据传给首屏 —— **不做首屏拦截**，App 照常启动、端侧复习/种子/画像照常可用，只在真正发起云侧生成且失败的那一刻引导去设置页。
- **为什么**：验收 S1.8 / 红线 R-P3「三级兜底：任何情况下不出现空白回合或静默失败」；以及不允许把内部错误暴露给用户。
- **注**：`src/pages/Home.tsx` 的对话化本身来自 `54a1b62` 快照里的 in-flight 成果，本轮只让测试跟随它，未重写首屏。
- **回滚**：`git checkout 54a1b62 -- src/chat src/pages src/App.tsx src/__tests__/pages.test.tsx`

### 验证（2026-10-17 实测，主 agent 独立复跑，不采信实现者汇报）

- `npm run verify:static` → 退出码 **0**（27 通过 / 0 失败 / 0 警告）
- `npm run typecheck`（`tsc -b`）→ 退出码 **0**
- `npm test`（`rstest run`）→ 退出码 **0**（33 文件 / 352 用例全绿；lab.1 那条唯一失败已消失，新增用例覆盖冷白判据、去 mock 契约、对话化 DOM 与兜底提示）
- `npm run build`（`rspeedy build`）→ 退出码 **0**（`dist/main.lynx.bundle` 466.2 kB；`MaxListenersExceededWarning` / `ObjectRef is not unref` 告警仍在，不影响退出码）
- `npm run verify:runtime` → 退出码 **0**（9 通过 / 0 失败；应用 bundle 3053732 字节，含 catalog 全部 16 零件名）
- `npm run verify`（冒烟五步：校验 → 类型检查 → 单元 → 打包 → 运行时）→ 退出码 **0**（全部 5 步通过）
- 未做：真机 M7-b 十项验收（本机无 Android 设备）；DOM 级断言仍由 rstest + jsdom 承担。

### 回滚

- 回退本轮三项改造（三者目录互斥，可分别回滚，命令见各节「回滚」）。
- 回退到改造前快照：`git switch coldwhite-v1 && git reset --hard 54a1b62`（⚠️ 丢弃工作区全部未提交改动，含 lab.1 的 scripts/ 与 CHANGELOG）。
- 放弃整条实验线：`git switch master`（`master` 自始至终未被写入）。
- 回滚后自检：`npm run typecheck && npm test && npm run build` —— 应与 `54a1b62` 基线一致（typecheck / build 退出码 0；test 有 1 条既有失败即 `pages.test.tsx:225`）。

### 结束行（§十二 模板）

当前：模块 = 冷白极简 + 去 mock + 首屏收口 / 改动 = design-system 冷白重构、cloud 缺 Key 显式降级、对话流三级兜底与无 Key 引导 / 验证结果 = 静态 27、typecheck 0、单元 352/352、build 466.2 kB、运行时 9/9、冒烟 5 步全绿 / 回滚方式 = 见上「回滚」。
