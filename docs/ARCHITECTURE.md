# ARCHITECTURE.md —— 工程架构蓝图（M1）

> 事实源：《通用学习教育Agent_产品方案.md》v1.3（下称 PRD）、《UI_微交互_动效_详细方案.md》v3（下称 UID）、`edu-agent/docs/00_项目总控方案.md`（下称 总控）。
> 本文档是 M2~M7 全体编码子智能体的唯一架构依据。接口类型见 `CONTRACTS.md`，条款落点见 `TRACEABILITY.md`。
> 约定：所有 `§x.y` 无前缀指 PRD，`UID §x` 指 UID 章节。

## 0. 架构总览

一句话：**端侧确定性域层（FSRS/队列/画像）+ 后台线程 Orchestrator 状态机 + 云侧 DeepSeek 生成（Skill 提示词 → A2UI v0.9 协议消息）+ ReactLynx 渲染**。

- 推理：云侧 DeepSeek API，默认 flash、卡死单次升 pro（§7.6），用户零配置。
- 界面：A2UI（Google 发起、Lynx 4.0 官方 `@lynx-js/genui/a2ui` 渲染实现，v0.9 协议），Agent 流式产出 JSONL 片段，客户端渐进渲染（PRD §7.1）。
- 数据：无账号、本地优先（§0）；一切学习数据端侧持久化，送云最小化（§7.4）。
- 复用优先：FSRS→`ts-fsrs`；动效→`@lynx-js/motion`（mini）；手势/列表→`@lynx-js/lynx-ui-*`；语音→sherpa-onnx；A2UI→`@lynx-js/genui/a2ui`。自研仅：内容结构化（切分器+验收闸）、四档编排（Orchestrator）、技能包运行时。

## 1. 目录结构（edu-agent/src 完整布局）

兼容 rspeedy/ReactLynx 约定：`src/index.tsx` 为入口，`rspeedy.config.mts` 位于工程根。

```
edu-agent/
├── rspeedy.config.mts            # 构建配置（M0 已建）
├── android/                      # Android 宿主工程（总控 §1）
│   └── app/src/main/java/.../
│       ├── MainActivity.kt
│       ├── modules/StorageModule.kt      # NativeLocalStorageModule（见 §9 存储）
│       └── modules/SpeechModule.kt       # sherpa-onnx TTS/ASR 桥（M6）
├── src/
│   ├── index.tsx                 # rspeedy 入口
│   ├── App.tsx                   # 路由：条件式首屏两分支（PRD §6）
│   │
│   ├── design-system/            # ── 设计系统（UID §1.1）
│   │   ├── tokens.css            # 语义 token 亮暗两套（ambient/surface/...）
│   │   ├── typography.css        # 字阶/行高/字体栈（UID 1.1 排版表）
│   │   ├── motion.css            # 动效曲线/时长 token（UID 附录参数表）
│   │   └── theme.ts              # 降级三档判定（UID §7.4，后台线程切换）
│   │
│   ├── a2ui/                     # ── A2UI 层（PRD §7.1/§7.2；UID §四）
│   │   ├── catalog.ts            # 16 零件 catalog：产品级全局常量 + JSON Schema（§7.2）
│   │   ├── surface.tsx           # @lynx-js/genui/a2ui 运行时接入（A2UISurface）
│   │   ├── stream-parser.ts      # 后台线程 JSONL 流式块解析 → 渐进写入 A2UI 运行时
│   │   └── fallback.tsx          # 未知组件名 → 纯文本块降级，绝不白屏（UID §四规则2）
│   │
│   ├── components/               # ── 16 零件的 ReactLynx 实现（catalog 的实现侧）
│   │   ├── ConceptCard.tsx  QuestionCard.tsx  RevealCard.tsx  MapView.tsx
│   │   ├── ProgressRing.tsx ExplainStep.tsx  ChoiceGrid.tsx  MicButton.tsx
│   │   ├── TTSBar.tsx     FeedbackBar.tsx  SourceLink.tsx  DueChip.tsx
│   │   ├── TodayPlanPanel.tsx EntryCard.tsx StreamSkeleton.tsx SessionEndCard.tsx
│   │   └── primitives/           # 无样式 primitive（UID §四规则3）
│   │
│   ├── domain/                   # ── 端侧域层（纯 TS、无 UI/IO 依赖，可单测）
│   │   ├── alu.ts                # ALU 实体 + 依赖图（§4.2）
│   │   ├── fsrs.ts               # ts-fsrs 封装：三档→Rating 映射、目标保持率 0.9（§4.6）
│   │   ├── queue.ts              # 复习队列：R 升序、交错抽取 5~8、当日预算（§4.6②）
│   │   ├── decision.ts           # 今日决策：欠账 vs 补讲 vs 新学（§5.6）
│   │   ├── profile.ts            # 画像四层 + 三类触发（§5.1/§5.2）
│   │   ├── session.ts            # 会话状态机（§4.5 三硬规则、§5.3 结束分析）
│   │   └── events.ts             # 领域事件（四档会话事件流，见 CONTRACTS）
│   │
│   ├── orchestrator/             # ── 调度器（跑后台线程，PRD §7.2）
│   │   ├── machine.ts            # 主状态机（见 §4 本文）
│   │   ├── activator.ts          # Skill 确定性激活（§7.8③）
│   │   ├── validator.ts          # 后置校验回路：该用 Skill 没用 → 强制纠偏（§7.8③）
│   │   ├── difficulty.ts         # 实时难度调节：答快对升/卡住先降（§10.1③）
│   │   └── metrics.ts            # Skill 调用率埋点：漏触发/误触发样本留存（§7.8④）
│   │
│   ├── cloud/                    # ── 云侧接入
│   │   ├── client.ts             # DeepSeek 客户端（OpenAI 兼容 fetch；Key 只进本地配置）
│   │   ├── context-builder.ts    # 八段分层拼装器（§7.7①，端侧固定，代码硬约束）
│   │   ├── compressor.ts         # 窗口压缩保命清单（§7.7④，只动后段）
│   │   ├── escalation.ts         # 卡死升级检测器 + 单次 pro 升级（§7.6）
│   │   ├── budget.ts             # 成本护栏：token 日预算、升级配额、闲时调度（§7.6）
│   │   └── mock/                 # Mock 客户端 + Mock A2UI 流（M2 起，Key 到位切换）
│   │
│   ├── skills/                   # ── 技能包运行时（PRD §7.2）
│   │   ├── runtime.ts            # 装载协议：name/description 常驻、正文按需（§7.8①）
│   │   ├── registry.ts           # 技能包索引 + 分层路由（四档即四域，§7.8①）
│   │   └── packs/                # 5 个技能包资产（源：/skill/ 只读，装载为 TS 资产）
│   │       ├── quick-learning.ts  review.ts  standard-learning.ts
│   │       ├── deep-learning.ts  score-boost.ts   # score-boost=知识库型（自适应/方法论）
│   │       └── references/       # 各 SKILL.md 引用的资源清单（原样装载）
│   │
│   ├── pipeline/                 # ── 内容管线（§4.3）
│   │   ├── splitter.ts           # 切分器：两层分流（知识型→可测 ALU；资源型→入口卡）
│   │   ├── gate.ts               # 验收闸：可追溯率 100% 程序化逐卡校验（硬门槛）
│   │   ├── sampler.ts            # 抽样评审编排：LLM 评审 + ≥20% 人工抽检（闲时）
│   │   └── seeds/                # 种子内容包：首启元课程 + 心理学 ALU（§0.1①②）
│   │
│   ├── tools/                    # ── 内置工具层（§7.3）
│   │   ├── registry.ts           # 工具注册表：白名单、限额、offline:true 标注
│   │   ├── search.ts             # 联网搜索（sub-agent 隔离窗口，§7.7⑤）
│   │   ├── vision.ts             # 识图（拍题/拍书页，sub-agent 窗口）
│   │   ├── tts.ts                # sherpa-onnx + Kokoro，端侧离线，模型按需下载
│   │   └── asr.ts                # sherpa-onnx 流式 zipformer，仅档4 费曼，文字兜底
│   │
│   ├── storage/                  # ── 持久化（见 §9）
│   │   ├── kv.ts                 # NativeModule 桥的 JS KV 封装（异步）
│   │   └── repos/                # 仓库层：alu/state/review-log/profile/session/settings/gate
│   │
│   ├── pages/                    # ── 页面（UID §2）
│   │   ├── Home.tsx              # 条件式首屏：首启方案D / 回访今日计划面板 + 六卡流
│   │   ├── Session.tsx           # 四档共用会话容器（A2UISurface 宿主）
│   │   ├── MapPage.tsx  LibraryPage.tsx  ProfilePage.tsx  GrowthPage.tsx
│   │   └── hooks/                # useMainThreadRef/runOnBackground 封装等
│   │
│   └── __tests__/                # 单元测试（domain/orchestrator/pipeline 优先）
```

## 2. 线程模型（UID §五/§七）

Lynx 双线程：主线程负责渲染与 UI 提交，后台线程跑 JS/React 运行时（PRD §7.1）。

| 逻辑 | 线程 | 依据 |
|---|---|---|
| React 组件树、A2UI 运行时校验后向主线程提交 UI | 后台→主 | PRD §7.1（A2UI 协议消息后台解析、UI 更新主线程呈现） |
| 手势即时反馈（按下缩放、跟手位移、弹簧吸附） | **主线程脚本**（`'main thread'` 指令 + `setStyleProperty`） | UID §5.1/§5.3：手感不能等后台线程 |
| `@lynx-js/motion` 动画（MotionValue 数值驱动） | 主线程 | UID §7.1：可被打断的动画必须主线程数值驱动 |
| Orchestrator 状态机、域层计算、FSRS、画像 | 后台线程 | PRD §7.2：调度器跑后台线程 |
| 云侧请求/流式解析、工具调用、切分管线 | 后台线程 | PRD §7.1 |
| 存储读写（KV 全量读写在原生侧完成） | 后台线程发起 | §7.7：回合边界批量落盘 |
| 作答结果上报（`runOnBackground`） | 主→后台 | UID §5.3 范式：业务上报走 runOnBackground，不占手感 |
| UI 状态更新（React setState 常规路径） | 后台 React → 主线程 patch | ReactLynx 常规管线 |

**跨线程边界纪律**（UID §5.3 五件事 + §7.2 禁令 7/8）：
1. 主线程脚本只做手感：即时反馈、跟手、弹簧；不写业务逻辑、不做 I/O。
2. 主线程函数捕获的外部变量必须可 `JSON.stringify()`，跨调用状态用 `useMainThreadRef()`。
3. 主↔后台只在结果上报时往返（`runOnMainThread`/`runOnBackground`）；拖拽/滚动类上报节流 ≥1 次/50ms。
4. 复用代码与三方库 `import ... with { runtime: 'shared' }`。
5. 条目真正上屏时机用 `main-thread:ref`；布局后改样式用 `main-thread:bindlayoutchange`。

## 3. 模块清单与职责边界

| 模块 | 职责 | 不负责 | 出处 |
|---|---|---|---|
| design-system | 语义 token（亮暗）、字阶、动效曲线/时长常量、降级三档 | 组件逻辑 | UID §1.1/§7.4/附录 |
| a2ui | catalog 常量（16 零件 schema）、A2UI v0.9 流式解析、渐进渲染接入、未知组件降级 | 组件视觉实现 | PRD §7.1/§7.5；UID §四 |
| components | 16 零件 ReactLynx 实现 + 无样式 primitive | 协议解析 | UID §四表格 |
| domain | ALU/FSRS/队列/决策/画像/会话状态机：全部确定性计算，离线可跑 | 云侧调用、渲染 | PRD §4/§5 |
| orchestrator | 今日决策驱动、Skill 确定性激活、会话循环 thought→action→observation、验证器回路、难度调节、调用率埋点 | 具体生成（交云侧） | PRD §5.6/§7.2/§7.7/§7.8/§10.1 |
| cloud | DeepSeek 客户端、八段上下文拼装、压缩、卡死升级、成本护栏、Mock | 端侧数据计算 | PRD §7.6/§7.7 |
| skills | 技能包装载协议、索引、5 包资产；name+description 常驻、正文按需 | 执行调度（交 orchestrator） | PRD §7.2/§7.8；总控 §0 |
| pipeline | 切分器两层分流、验收闸三指标、抽样评审、种子内容包 | 运行时复习消费 | PRD §4.3/§9 |
| tools | 搜索/识图/TTS/ASR 注册表与实现；白名单、限额、offline 标注 | 提示词决策 | PRD §7.3 |
| storage | KV 桥 + 仓库层；回合边界批量落盘；1s 撤销窗口的延迟写入 | 业务语义 | PRD §7.4/§7.7；UID §三 |
| pages | 六页面 + 条件式首屏 + 手势/主线程脚本 | 域计算 | PRD §6/§8；UID §2 |

## 4. Orchestrator 状态机（核心）

主循环（PRD §5.6 → §7.8③ → §7.7② → §5.3）：

```
[AppStart]
   ├─ 首启（无任何待办与记录）→ FirstRun 分支（方案 D 元课程小课，PRD §6）
   └─ 回访 → TodayDecision（端侧、离线、零网络，PRD §6 回访分支）
        ↓
[TodayDecision]（domain/decision.ts，§5.6）
   输入：复习队列（R 升序）+ 补讲列表 + 能力画像 + 目标
   输出：TodayDecision = { review } | { remediation } | { new_learn } | { first_run }
   优先级：当日补讲 > 到期复习（R 最低优先）> 新学建议
        ↓
[SkillActivation]（orchestrator/activator.ts，§7.8③ 确定性激活）
   决策已定档 → 直接激活对应 Skill，不经模型选择；
   候选集天然收敛到 1~2 个（四档即四域，§7.8①）；
   用户点名/主动入口（"复习一下"）→ 同样由调度器直连激活。
        ↓
[SessionLoop]（§7.7②，每回合）
   thought（云侧，含 A2UI 片段产出）
     → action（A2UI 消息流下发渲染 / 工具调用 / TTS）
     → observation（用户作答 / 工具结果，Action 回传）
   每回合经 validator：本场景该用 Skill 却没调 → 强制纠偏重发（§7.8③）；
   difficulty：答得快又对→立刻升难度/给变式；卡住→先降难度给脚手架，不直接判错（§10.1③）；
   escalation：五类卡死信号 → 单次 pro 升级 → 切回 flash（§7.6）。
        ↓
[SessionEnd]（§5.2/§5.3，触发：空闲>90s | 退后台 | 连续2次跳过 | 主动再见）
   会话结束分析（三产出：心理状态推断/偏好修正/下次建议，静默不弹窗）
   → SessionEndCard（正向峰值收尾，UID §2.3）
   → 画像回合边界落盘 → 回到 [TodayDecision]
```

**四档流转状态机**（domain/session.ts，PRD §4.5）：ALU 产品状态 `未见 → 见过 → 学过一轮 → 暂记 → 已稳固`。三条硬规则由代码强制（§7.9"能硬约束就别用软提示"）：
1. 快速档默认不产生复习欠账 → activator 对 quick 档禁用卡片生成 action。
2. "学过→待复习"唯一入口 = 标准/高质量档讲完并自检过 → 只有 standard/deep 的会话事件能触发 `card_generated`。
3. 复习失败自动拉起补讲 → review 档 `wrong/fuzzy` 判定 → 自动注入 remediation 子会话（standard 档 90 秒）→ 补完重新入队（间隔按答错处理）。

**产品 status 与 FSRS State 映射**：未见/见过=`New`（见过不入队，硬规则1）；学过一轮=入队 `Learning→Review`，due=T+1；暂记=`Review` 且近期有 lapse；已稳固=`Review` 且 `scheduled_days ≥ 21`（建议初值，可调参数，见待裁决 D5）。

## 5. 上下文组装（PRD §7.7）

`cloud/context-builder.ts`，固定八段顺序，端侧拼装为代码硬约束（§7.9）：

| 段 | 内容 | 稳定性工程要求 |
|---|---|---|
| ① | System 约束（角色/工作准则/安全） | 跨所有请求字节级不变，置最前 |
| ② | 心理学策略库（含 score-boost 方法论要点） | 随产品版本变，禁止时间戳/随机 id |
| ③ | **A2UI catalog 全量常驻**（16 零件 JSON Schema） | 产品级常量，跨所有用户/所有档不变（§7.2/§7.6/§7.7 口径统一） |
| ④ | Skill 模板（当前档位提示词） | 换档时缓存从这段起失效（设计内行为） |
| ⑤ | 长期记忆片段（端侧画像，最小注入） | 绝不进前缀；只在回合边界更新落盘 |
| ⑥ | 任务指令（当前 ALU、节奏、预算） | 每轮变 |
| ⑦ | 对话历史 | **只追加**，不改写 |
| ⑧ | 按需检索结果（出处/搜索/识图，截断+摘要后入窗） | just-in-time，用完即弃 |

要点落法：①②③ 为字节级固定前缀，吃 DeepSeek 上下文硬盘缓存（§7.6）；窗口内用标签分段 `<skill> <memory> <alu> <catalog>`（§7.7⑥）；可寻址引用（`alu-id + 出处 + 句子级 span`）代替原文粘贴（§7.7③）。

**压缩**（compressor.ts，§7.7④）：必须保住 ①当前目标 ②用户约束（偏好边界）③未完成步骤 ④关键引用（alu-id+出处）⑤未解决错误原文；可丢久远对话与已完成回合；**只动第④段之后，绝不改缓存前缀**。

**三个 sub-agent 隔离窗口**（§7.7⑤）：切分器/识图/搜索各自独立 ContextWindow（互不共享、不进主窗）；只回传结构化结论（ALU JSON / OCR+ALU / 提炼要点+出处）。

## 6. 端云边界（PRD §7.4）

| 位置 | 工程落法 |
|---|---|
| 端侧存储 | storage/repos 全部集合：ALU 主数据+状态、FSRS 参数、复习日志、画像四层、会话摘要、设置、验收闸报告 |
| 端侧计算 | 今日决策、队列、FSRS 调度、交错抽取、画像派生——**离线可看可清待办** |
| 送云最小化 | context-builder 每次只发 当前 ALU + 最小上下文片段（⑤段仅注入与当前板块相关的画像摘要），**不发完整画像**；声明不用于训练 |
| 云侧 | 仅生成式讲解（DeepSeek）；不留存（客户端无会话持久化，服务端按 Provider 政策） |
| 离线降级 | 待办可看可清 + TTS/ASR 端侧可用；讲解请求失败 → 提示需联网 + 本地可用功能照常 |
| 端云同步 | 做成开关、默认关闭（§7.4；V1 仅留设置项占位，同步本体 V1 不做） |

## 7. 模型路由（PRD §7.6）

`cloud/client.ts + escalation.ts + budget.ts`：
- 默认 `deepseek-v4.1-flash`（PRD 模型名，实际 API 模型名以 M2 接入时核实为准，做成配置常量，见待裁决 D2）。
- 卡死升级（学 Trae Advisor）：五类触发信号（同义重试不收敛/工具连续失败/输出反复偏离/用户明显不满或纠错/模型自评低置信）→ 向 pro 发**一次**请求（上下文最小化：只带"卡在哪+目标"）→ 拿到"下一步怎么做"即切回 flash 执行。**每次卡死只升一次**；升级与结果记入画像学习事实层（"这个点在 Flash 上卡过"）。
- 成本护栏：用户 token 日预算 + 升级配额（budget.ts 计数持久化）；非实时任务（批量切卡、批量评审）调度到闲时（sampler.ts 挂闲时队列）。

## 8. Skill 调用率四层机制与提示词方法论落点（PRD §7.8/§7.9）

| 层 | 工程落点 |
|---|---|
| ① 触发层 | skills/runtime.ts：name+description 常驻窗口、正文按需加载；description 写"何时用"（源：5 个 SKILL.md 的 frontmatter 原文）；四档即四域，分层路由天然收敛候选集 |
| ② 指令层 | 提示词模板内硬约束措辞 + 优先级链（用户点名 > description 强匹配 > 默认流程）；正反例与默认参数齐备（SKILL.md 已含） |
| ③ 兜底层 | orchestrator/activator.ts 确定性激活（不经模型）；validator.ts 后置校验强制纠偏；学习流程不留旁路 |
| ④ 度量层 | orchestrator/metrics.ts 埋点：调用率 + 漏触发/误触发样本留存；评测集含负例（M7 验收用） |

§7.9 方法论落点："讲完必须自检"= activator 会话回合结构强制；"复习卡必须可判对错"= gate.ts schema 校验；"上下文组装顺序"= context-builder 代码固定。提示词资产 = `skills/packs/`（5 个 SKILL.md 装载，格式见 CONTRACTS §6）。

## 9. 内容管线（PRD §4.3/§9）

`pipeline/`，两层分流 + 验收闸：

1. **切分器**（splitter.ts，云侧 sub-agent 独立窗口）：读资料 → 只回传 ALU 结构化 JSON。知识型条目 → 可测 ALU（进复习队列）；资源型条目（书/MOOC/视频链接）→ 入口卡 EntryCard + 出处字段，不进队列。
2. **验收闸**（gate.ts）：
   - 可追溯率 **100% 硬门槛**：程序化逐卡校验——每卡 `出处文件 + 句子级 span` 回链存在且原文可命中（`source.text` 在 `source.doc` 指定句区间内命中）；不达标者隔离、不入复习队列（`isolated` 状态）。
   - 可判对错率 ≥90% / 颗粒度合格率 ≥85%：抽样（每批分层抽 100~200 张），LLM 评审规则 + ≥20% 人工抽检，闲时调度。
   - 灰度判定：连续两批达标→扩大灰度；任一未达标→退回种子内容模式（Agent 只做装配与变式，不做自动切分）。
3. **回链不自研**：创建 ALU 即写入出处+span，用现成 citation/span-anchor 思路的字符串区间命中实现。
4. 搜索/识图摄入的 ALU 走**同一条闸**（§9 风险口径）。
5. 种子内容包（seeds/）：首启元课程（学习科学）+ 心理学研究方法 ALU，M5 以人工校验后的种子集形态内置（"人机分工"缓解 §9 首败风险）。

## 10. A2UI 消息流（PRD §7.1/§7.2；UID §四）

采用 **A2UI v0.9 协议**（Google 发起）+ Lynx 官方渲染实现 `@lynx-js/genui/a2ui`，不自研协议：

```
Skill（云侧，受提示词约束）
  → 产出 A2UI v0.9 JSONL 消息（surfaceUpdate.components[]，组件来自 catalog）
  → 后台线程 stream-parser 逐行解析 → A2UI 运行时按 catalog 校验
  → 渐渐进渲染（用户看着界面长出来，无空白等待）
  → 用户操作以 Action 回传：
      Agent 响应 Action（作答、追问）→ 进 SessionLoop 的 observation
      Client 响应 Action（TTS 播放/暂停、跳出处、埋点）→ 本地直接处理
```

- **catalog（a2ui/catalog.ts）**：16 零件清单及各组件声明字段（JSON Schema，见 CONTRACTS §5）。catalog 是产品级全局常量、全量常驻、全量进上下文③段；技能包只**按名引用**、不内嵌（PRD §7.2）。
- **未知组件降级**（UID §四规则2）：渲染器收到 catalog 外组件名 → 降级为纯文本块，绝不白屏；首屏直出 + 降级兜底永远不留空屏。
- **本地组件 vs 生成组件**：16 零件全部注册进 catalog；其中 TodayPlanPanel/DueChip/EntryCard/StreamSkeleton 主要由端侧页面直接渲染（非 Agent 生成路径），其余 12 个为 Agent 生成主力。

## 11. 技能包运行时协议（PRD §7.2）

- **装载**：`/skill/` 下 5 个 SKILL.md 为只读源；构建期装载为 `skills/packs/*.ts`（SkillManifest + 提示词模板字符串 + references 原文）。格式定义见 CONTRACTS §6。
- **与 catalog 关系**：manifest 的 `components` 字段按名引用 catalog（§7.2），禁止内嵌目录副本——避免按档复制 catalog 打散缓存前缀。
- **score-boost 特殊角色**（总控 §0）：mode=`knowledge`，不参与四档调度；其方法论拆为三处注入：②段心理学策略库要点（稳定前缀）、⑤段画像相关片段（按需）、⑧段按需检索（错因四分类/提分闭环等，用于会话结束分析与定向补漏，§5.6）。
- **分包/热更新预留**：V1 技能包打进应用包（本地常量资产）；`SkillManifest` 含 `version` 字段，热更新走云端 JSON 下发通道为 **V1.x 预留**（见待裁决 D3）。

## 12. 依赖选型

| 能力 | 选型 | 说明与出处 |
|---|---|---|
| FSRS 调度 | `ts-fsrs`（open-spaced-repetition，v5.x，MIT） | 总控禁自研；API：`fsrs/generatorParameters/createEmptyCard/Rating/State/Card`，导入自 `'ts-fsrs'` |
| 动效 | `@lynx-js/motion`，**mini 入口**（~135KB，仅数字） | UID §7.1；确需颜色/单位字符串再升全量 |
| 手势/翻条 | `@lynx-js/lynx-ui-swiper` | UID §5.2"翻到下一条"；lynx-ui 官方 headless 库，分包安装 |
| 拖拽/长按 | `@lynx-js/lynx-ui-draggable`（`onMTSDragging` 主线程回调；长按档 350ms 对齐） | UID §5.2 |
| 流式长列表 | `@lynx-js/lynx-ui-feed-list`（虚拟列表+下拉刷新+加载更多） | UID §八"虚拟列表不自研" |
| A2UI 渲染 | `@lynx-js/genui/a2ui`（A2UI v0.9 Renderer，ReactLynx 实现） | Lynx 4.0 官方；复用现有组件库/设计系统 |
| TTS | sherpa-onnx + Kokoro（中文优先，Apache-2.0），Piper 英文备选 | PRD §7.3；模型按需下载、不进 APK |
| ASR | sherpa-onnx 流式 zipformer | 仅档4 费曼 + 文字兜底；质量不得阻塞 V1 |
| 云侧 API | 原生 `fetch`（DeepSeek OpenAI 兼容接口） | 不引 SDK，减依赖；Key 只进本地配置不进代码库（总控 §0） |
| 触觉 | 不引入（V1.x 候选 `@sigx/lynx-haptics`） | UID §九开放问题，见待裁决 D1 |

**存储方案（已用 WebSearch 核实）**：Lynx **无内置磁盘持久化 API**——内置仅会话级 SessionStorage（`lynx.setSessionStorageItem` 等）；官方《原生模块-本地持久存储》指南即教学用 Native Module 承接（Android=SharedPreferences）。候选与推荐：

| 候选 | 方案 | 评估 |
|---|---|---|
| **A（推荐）** | 自建薄原生 `StorageModule`（官方 Native Modules 模式：继承 LynxModule + `@LynxMethod`，落 SharedPreferences/内部文件），JS 侧 `storage/kv.ts` 封装异步 KV | 官方文档路径、零三方依赖；android/ 宿主工程本就存在，增量小 |
| B | 社区包 `@sigx/lynx-storage` / `@kafitra/lynx-async-storage` | 形状同 localStorage/AsyncStorage；成熟度未验证，列备选 |
| C | SQLite 通道（自建桥 android.database.sqlite） | V1 数据量（万级 ALU 状态）用不上；列 V1.x 候选 |

数据形态：分集合 JSON（alu / alu_state / review_log / profile / session_summary / settings / gate_report），仓库层（storage/repos）读写；**回合边界批量落盘**（§7.7），FSRS 作答写入经 **1 秒撤销窗口**（UID §三：松手后 1s 内可撤销，撤销期内不落盘不进日志）。

## 13. 里程碑映射（总控 §2）

| 里程碑 | 对应模块（上文目录） |
|---|---|
| M2 核心域层 | domain/*、storage/*（kv+repos）、orchestrator/*（状态机+激活+校验）、design-system/*、cloud/*（client+builder+mock）、skills/*（runtime+5 packs）；随附单元测试 |
| M3 A2UI 组件库 | a2ui/*（catalog+surface+stream-parser+fallback）、components/*（16 零件+primitives）、design-system 动效参数对齐 UID 附录 |
| M4 页面与会话 | pages/*（六页面+条件式首屏+四档会话容器）、手势与主线程脚本（UID §五/§六）、pages/hooks |
| M5 内容管线 | pipeline/*（splitter+gate+sampler）、pipeline/seeds（首启元课程+心理学种子 ALU） |
| M6 工具与语音 | tools/*（registry+search+vision+tts+asr）、android/modules/SpeechModule、模型按需下载 |
| M7 集成验收 | 首启方案 D 全链路、Trace 验收（红橙帧<3%、P95<16.7ms、0.5s 首屏、中低端机实测）、可安装 APK、metrics 评测集（含负例） |

## 14. 待裁决清单（不自行拍板，提请用户/总控裁决）

- **D1 触觉反馈**：UID §九明确留白"要不要加"（`@sigx/lynx-haptics`，吸附到位/判定对错两处）。本蓝图 V1 不引入，列为 V1.x 候选。请用户拍板。
- **D2 DeepSeek 实际模型名**：PRD §7.6 写 `deepseek-v4.1-flash` / `deepseek-v4-pro`；实际 API 模型名（如 deepseek-chat/deepseek-reasoner 或新版本名）需在 Key 到位后核实。云侧做成配置常量，不影响架构。
- **D3 技能包热更新通道**：PRD §7.2"可动态加载、支持热更新不发版"。Lynx 分包/动态加载面向页面模板；提示词资产热更新需自建云端配置下发。V1 建议：技能包内置 + version 字段预留；热更新列 V1.x。请确认。
- **D4 成绩单解析入口**：PRD §5.1/§5.2 含"发成绩单"事件与"端侧解析存结构化数字"；§8 V1 范围第 3 条未明确该入口形态。识图工具（M6）可承接拍照解析；或 V1 先手动录入结构化字段。契约已含 GradeEvent 类型，两种入口均可接。请拍板 V1 形态。
- **D5 "已稳固"阈值**：PRD §4.2 状态链未定义"已稳固"判定值。本蓝图建议 `Review 态且 scheduled_days ≥ 21`，参数化可调。请确认或给值。
- **D6 FSRS 个人参数切换**：PRD §4.6"积累足够复习记录后切换到个人参数"。ts-fsrs 不含 optimizer（参数优化在 py-fsrs/fsrs-rs 生态）。V1 建议全体用户共用默认参数（w 常量），个人参数优化管线列 V1.x。请确认。
- **D7 内置 Key 分发安全**：App 直连 DeepSeek（总控：用户提供测试 Key、只进本地配置）。正式分发时内置 Key 存在被提取风险；PRD §7.6 提及"App 后端单账户代理"可最大化缓存命中并隐藏 Key，但属自建后端。V1 按直连，代理列为发布前决策项。

## 15. 自查发现的风险（架构层面）

- **R1**：`@lynx-js/genui/a2ui` 为 4.0 新能力，文档标注"接入文档预览版"；M3 需先做接入验证（catalog 自定义组件 + 流式 + Action 回传全链路），失败则回退方案为"按 A2UI v0.9 消息格式自实现轻量 renderer"（协议本身简单：JSONL→组件树）。
- **R2**：Motion 弹簧 `velocity` 透传需接入时实测（UID §6.1 已标注）；不透传则跟手降级为从零起步弹簧，可接受但需记录。
- **R3**：SharedPreferences 存集合 JSON 在数据增长后有全量读开销；V1 量级可控 + 回合边界批量写已缓解；万级以上需迁移 SQLite（候选 C）。
- **R4**：sherpa-onnx 与 Lynx Android 宿主集成复杂度（总控风险登记已有）；TTS 阻塞四档口播体验，M6 需优先打通最小链路。
- **R5**：验收闸"可判对错率/颗粒度合格率"依赖 LLM 评审 + 人工抽检，人工环节在无用户参与的开发期由总控/评审子智能体代行，需在 M5 验收时明确责任人。
