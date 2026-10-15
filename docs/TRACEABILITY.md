# TRACEABILITY.md —— 可追溯矩阵（M1）

> PRD 每节 / UID 每章 → 工程落点（模块/文件）→ 交付里程碑。目标：**无孤儿条款**。
> 缩写：`domain/`、`orchestrator/`、`cloud/`、`skills/`、`pipeline/`、`tools/`、`a2ui/`、`components/`、`design-system/`、`storage/`、`pages/` 均指 `edu-agent/src/` 下目录（见 ARCHITECTURE §1）。
> "V1 不做"= PRD §8 明确排除；"V1.x"= 方案自身标注的后续版本项；"Dn"= 用户决策（2026-10-15 总控 §0.1 已全部裁决），索引见 ARCHITECTURE §16 决策记录。

## 1. PRD 章节矩阵

| PRD § | 条款要点 | 工程落点 | 里程碑 |
|---|---|---|---|
| §0 决策表 | 云侧 LLM/DeepSeek、默认 flash/单次升 pro、无 API 配置入口、三份语料、不推送但首屏见计划、无账号本地优先 | cloud/client.ts（模型配置常量+零配置）；storage/（本地优先）；pages/Home.tsx（首屏即计划）；无任何 Key/baseURL/模型设置页 | M2/M4 |
| §0.1 内容三层 | ①元课程首启语料 ②心理学验证语料 ③搜索/识图摄入路径；批量导入 V1 不做 | pipeline/seeds（①②）；tools/search+vision（③）；批量导入：**V1 不做**（V1.x 灰度复用 §4.3 闸） | M5/M6 |
| §1 定位与画像 | 通用学习 Agent、三类目标用户、设计约束（不假设目标/计划/科目） | 约束落到提示词①段（cloud/context-builder.ts）与交互结构（pages/）；无科目硬编码（§7.5） | M2/M4 |
| §2 核心循环 | 打开→今天一件事→3s/30s/60-180s 节奏→反馈→结束微成就→次日变化；四牵引力 | orchestrator/machine.ts（主循环）；pages/Home.tsx（首页流六卡：欠账/未完成/到期/推荐/目标卡前三日/入口卡）；domain/queue+decision（欠账/连续性/个性化/进展牵引数据源）；GrowthPage（进展） | M2/M4 |
| §3 档1 Quick | 地图卡+30~60s 口播+1~3 复述级自检；一批两用（深度参数+时长预算切换）；快速回顾 90s 变体 | skills/packs/quick-learning.ts（SkillParams.goal/budgetMinutes 切换）；components/MapView+TTSBar+QuestionCard | M2/M3/M4 |
| §3 档2 Review | 到期卡、先答后揭晓、三档反馈、10~30s/卡、一轮 3~6 分钟 | skills/packs/review.ts；components/RevealCard+FeedbackBar（判定触觉，D1）；domain/fsrs.ts（correct/wrong→Rating，fuzzy 不记账 D8）；FlowParams.sessionMinutes=[3,6]（D9） | M2/M3/M4 |
| §3 档3 Standard | 四段式（概念→例子→反例→常见坑）、讲完即问、答错才补讲 | skills/packs/standard-learning.ts；components/ExplainStep+QuestionCard | M2/M3/M4 |
| §3 档4 Deep | 板块地图+进度环、记忆→理解→应用→分析逐级、费曼复述 | skills/packs/deep-learning.ts；components/MapView+ProgressRing+MicButton；tools/asr.ts（费曼） | M2/M3/M4/M6 |
| §3 心理学取舍 | 快速不上高难度提取；标准精加工为主；复习纯提取；深度才上交错迁移 | 提示词②段心理学策略库（cloud/context-builder.ts）；difficulty.ts 按档不同调节策略 | M2 |
| §4.1 三元组 | 概念/判据/过程；四档=原语上深度×时长×操作组合 | domain/alu.ts（AluKind）；SkillManifest.params | M2 |
| §4.2 数据模型 | Subject─Module─ALU 全字段（类型/正题/变式/依赖/难度/出处 span/用户状态+FSRS） | CONTRACTS §1（Alu/AluUserState/SourceRef）；storage/repos/alu+alu_state | M2 |
| §4.3 切分链路 | 两层分流（知识型→可测 ALU；资源型→入口卡）；验收闸三指标；灰度判定；回链不自研；闲时成本 | pipeline/splitter.ts+gate.ts+sampler.ts（CONTRACTS §8）；components/EntryCard | M5 |
| §4.4 三份资料角色 | 方法论→学习科学知识库+参数化四档；资源清单=验证语料+出处+搜索白名单 | skills/packs/score-boost.ts（方法论）；pipeline/seeds（语料）；SkillManifest.references（白名单） | M2/M5 |
| §4.5 流转状态机 | 未见→见过→学过一轮→暂记→已稳固；三条硬规则；允许跳档 | domain/session.ts（硬规则代码强制；规则3 fuzzy 分支按 D8=再讲一遍不记账，仅 wrong 拉补讲）；domain/events.ts（alu_status/card_generated/remediation_*）；orchestrator/activator.ts | M2 |
| §4.6 复习算法 | ts-fsrs（禁自研）、R 排序、交错 5~8、当日预算、前置归因、冷启动 1-2-4-7-15、队列三来源 | domain/fsrs.ts+queue.ts（CONTRACTS §2；fuzzy 不写 FSRS，D8）；domain/alu.ts（prereq 图 + 前置归因 tracePrereqSuspects → judge 事件 prereqSuspect 字段，F1）；队列来源②收藏=AluUserState.bookmarked（会话+资料库两入口，D11）；个人参数=V1 共默认（D6 已裁决） | M2 |
| §5.1 画像四层 | 学习事实/能力画像/偏好边界/会话摘要 | domain/profile.ts（CONTRACTS §4；GradeEvent 入口=拍照解析 D4：tools/grade-entry.ts）；storage/repos/profile | M2 |
| §5.2 触发规则 | 事件即时/周期（10min 或 8 次）/会话结束（空闲90s/后台/2跳过/再见） | domain/profile.ts（ProfileTrigger）；orchestrator/machine.ts（SessionEnd 触发检测） | M2/M4 |
| §5.3 结束分析 | 三产出（心理状态 TTL/偏好防噪音落库/下次建议）；静默不打断 | domain/profile.ts（SessionEndAnalysis）；cloud（分析请求走闲时小上下文）；pages/Session（不弹窗） | M2/M4 |
| §5.4 记录粒度 | 事实逐条原子级；偏好≥2次或声明；心理状态会话级 TTL | domain/profile.ts（observedCount/expiresAt 字段即落点） | M2 |
| §5.5 隐私与遗忘 | 画像可见可改可删；TTL；成绩端侧解析不存原图不用于训练；分级开关；端侧为主 | pages/ProfilePage（逐条编辑/删除）；storage/repos（硬删除）；AppSettings.privacyAdaptive/privacyCloudInference；成绩解析入口=拍照解析（D4 已裁决）：tools/grade-entry.ts + ProfilePage 入口，只存结构化数字不存原图，失败兜底手动录入 | M4/M6 |
| §5.6 路径自适应 | 首页一件事=欠账vs新学vs补讲；档位/难度起点；保持率与催收；讲法；定向补漏；优先级 | domain/decision.ts（TodayDecision；优先级=复习(R升序)>补讲>新学，D10 已裁决；保持率催收规则：目标期限临近→上调 requestRetention、压缩新卡预算，阈值参数化，经 createScheduler(requestRetention) 承接，F17）；cloud/context-builder（⑤段画像注入讲法约束）；pipeline 补漏专项=score-boost 错因四分类注入 | M2 |
| §6 条件式首屏 | 首启方案 D（0s 骨架/≤0.5s 文字/3s 小课/30s 闭环/180s 收尾+目标卡）；回访=今日计划面板零等待 | pages/Home.tsx；pipeline/seeds 元课程；components/StreamSkeleton+TodayPlanPanel+SessionEndCard；domain/decision（端侧零网络）。首启 A/C 后续分流（§6 括号备注）：V1 不做——首启已锁定方案 D 闭环，A/C 为备选分流细节，列 V1.x 观察项 | M4/M5 |
| §7.1 Lynx 总览 | 双线程、A2UI 流式、首帧直出、webview 承接外部资源 | a2ui/surface+stream-parser（后台解析/主线程呈现）；pages（ReactLynx 首帧直出）；外部资源页用 `<webview>`（EntryCard 跳转） | M3/M4 |
| §7.2 Skill 加载调度 | 技能包=模板+工具声明+数据结构+组件按名引用；catalog 产品级常量不内嵌；调度器后台线程；分包/热更新 | skills/runtime.ts+registry.ts+packs；a2ui/catalog.ts（常量）；orchestrator（后台）；热更新=skills/updater.ts（D3 已裁决 V1 就要）：远端 manifest→版本比对→拉包→哈希/签名校验→本地应用→失败回滚内置包；端点可配置、开发期 fixture、静态托管即可（协议 CONTRACTS §6）；"数据结构"要素由全局契约承担（CONTRACTS §6 注，F13） | M2（协议+fixture）/M3/M6（联网联调） |
| §7.3 内置工具 | 搜索（提炼转 ALU 必留出处）/识图（过闸）/白名单限额/TTS 全档（sherpa-onnx+Kokoro 按需下载）/ASR 仅档4+文字兜底/offline:true/语速音色接画像 | tools/registry+search+vision+tts+asr（CONTRACTS §6 ToolName）；android/modules/SpeechModule；Preferences.tts | M6 |
| §7.4 端云边界 | 端侧存算清单、送云最小化、离线降级、同步开关默认关 | storage/repos（端侧全量）；cloud/context-builder（最小注入）；AppSettings.cloudSync；离线降级路径见 ARCHITECTURE §6 | M2 |
| §7.5 任意学科 | 统一原语+ALU；组件原语非科目硬编码；三入口；验证层级=机制+摄入 | domain/alu（元数据 only）；a2ui/catalog（通用学习原语）；代码无科目字面量（M7 验收检查项） | M2/M3/M7 |
| §7.6 模型路由 | flash 默认；稳定前缀吃缓存；前缀禁时间戳/random id；history 只追加；卡死五信号单次升级；成本护栏闲时 | cloud/client+context-builder+escalation+budget（CONTRACTS §7）；模型名=配置常量（D2 已裁决：Key 到位后核实，默认按 PRD 名） | M2 |
| §7.7 上下文设计 | 八段顺序；①②③字节级固定；⑤不进前缀；压缩保命清单；三 sub-agent 隔离；结构化标签；错误原文保留 | cloud/context-builder+compressor；tools 三个 sub-agent 独立窗口（ARCHITECTURE §5） | M2 |
| §7.8 调用率四层 | 触发/指令/兜底（确定性激活+后置校验+唯一路径）/度量（埋点+负例评测集） | skills/runtime（①）；提示词模板（②）；orchestrator/activator+validator（③）；orchestrator/metrics（④，评测集 M7）；A/B 调整 description 措辞=运营项，不落代码（F17 显式标注） | M2/M7 |
| §7.9 提示词方法论 | 职责/判据/岔口/失败模式/条件-动作；硬约束落代码（自检强制/卡 schema 校验/组装顺序固定） | skills/packs 提示词结构；orchestrator 会话回合强制自检；pipeline/gate schema 校验；context-builder 代码固定 | M2/M5 |
| §8 做什么（10 项） | 核心循环/四档全量/自适应简版/工具+语音/画像+隐私+成长/条件首屏/内容管线/模型层/验收闸/心流 | 全量分布于本矩阵各行；汇总验收=M7 | M2~M7 |
| §8 不做什么 | 账号/推送/批量导入/轮播/社区/付费/iOS 等 | **V1 不做**：无对应模块；同步开关仅占位（§7.4）；多学科轮播 V1.x | — |
| §9 失败风险 | 切分最可能失败；首页决策次高风险；人机分工+判定闸缓解 | pipeline/gate（判定闸）；pipeline/seeds（人机分工种子集）；domain/decision（决策可解释 reason 字段） | M2/M5 |
| §10.1 心流三条件 | 有界会话+进度细线；判定<1s 按下先行；实时难度调节；复习档调节拍不调难度 | domain/events.ts（FlowParams.boundedSession）；components/FeedbackBar（pendingJudge）；orchestrator/difficulty.ts | M2/M4 |
| §10.2 正反馈 | 绑能力增量三信号（S 上涨/比上次错少/模糊→对）；奖励挣扎后想起；过程型话术；正向峰值收尾；四红线禁用 | GrowthPage+ProgressRing（S 可视化）；AnswerRecord.struggleWin（fuzzy 记录会话内可见即可，D8）；"比上次错得少"=domain/session.ts 结束分析对比同卡/同板块历史 AnswerRecord 派生（F17）；过程型话术=提示词②段/技能包模板措辞约束（F17）；SessionEndCard（正向峰值）；红线：GrowthPage 无连胜/资产/排行/时长奖（代码即不存在） | M3/M4 |
| §10.3 四档参数表 | 目标成功率/判定时延/单次时长/维持手段 | domain/events.ts（FlowParams 常量表；复习行单次时长按 PRD §3"3~6 分钟"执行，§10.3 复习行 60~90s 系误植档1 值——用户裁决 D9） | M2 |
| 附录 ALU 样例 | psy-001~res-001 字段样例+FSRS 初始参数 | pipeline/seeds 种子包数据格式依据（CONTRACTS §8 SeedContentPack） | M5 |
| 附 外部依据 | FSRS/Lynx A2UI/DeepSeek 缓存/sherpa-onnx | ARCHITECTURE §12 依赖选型表 | M2~M6 |

## 2. UID 章节矩阵

| UID § | 条款要点 | 工程落点 | 里程碑 |
|---|---|---|---|
| 一 设计纪律 | 一次一件事（无 TabBar/九宫格/抽屉）；会长的才动画；欠账用"还剩几张" | pages/（单列流）；design-system/motion.css（三动词）；DueChip/进度细线 | M4 |
| 1.1 视觉方向 | 纸与墨：token 亮暗两套（prefers-color-scheme）；排版数值（16/1.75/20~25 字/对比度≥4.5）；衬线标题可退化；纸纹理静态或不做；不用 LUNA | design-system/tokens.css+typography.css；theme.ts | M2 |
| 1.2 动效母题 | 生长/归位/落下三动词；多出的删掉 | design-system/motion.css（曲线/时长 token：M3 组件实现遵守） | M2/M3 |
| 2.1 打开前半秒 | 骨架定高不白屏；0.5s 首条内容；缓存先给 | components/StreamSkeleton；pages/Home 首帧直出 + 本地缓存渲染 | M4/M7 |
| 2.2 首页 | 六种卡片；底部说困惑入口（V1 文字版）+口播条；宽屏两栏 `@media(width>=600px)`；推荐卡一次最多两条 | pages/Home.tsx（推荐卡渲染上限 2，数据源 domain/decision）；六卡=components 对应件；困惑入口=文字输入（V1）；flex+相对单位自适应 | M4 |
| 2.3 会话页 | 四档共用容器只差步子；复习左右滑作答；标准卡住即降难度补讲；结束一句话收尾 | pages/Session.tsx；components（RevealCard 等）；orchestrator/difficulty.ts | M4 |
| 2.4 四页面 | 地图页/资料库（两类分摆+回链原句）/我的画像（逐条改删+隐私开关）/成长轨迹（掌握度+S 柱） | pages/MapPage/LibraryPage/ProfilePage/GrowthPage；SourceLink（回链） | M4 |
| 2.5 首屏时间线 | 0s/≤0.5s/3s/30s/180s 五档时刻表 | pages/Home 首启分支时序实现（M7 全链路验收项） | M4/M7 |
| 三 招牌时刻 | "今天有 3 张要还"；一次一张；1s 撤销；进度细线一格；正向峰值+柱子轻跳；卡住当场降档补讲；只用"归位"曲线 | pages/Session 复习分支 + 会话进度细线（Session 页局部组件，右下角一格一格缩短，**不进 catalog**，F10 落点）；storage（撤销窗口延迟写）；components/ProgressRing+SessionEndCard（峰值/柱跳）；难度调节即补讲 | M4 |
| 四 16 零件+三规则 | catalog 全量常驻、技能包按名引用；未知组件降级纯文本不白屏；className+token、无样式 primitive | a2ui/catalog.ts；a2ui/fallback.tsx；components/primitives（CONTRACTS §5） | M3 |
| 5.1 手感三原则 | 即时不等后台；1:1 跟手；松手交物理 | components 手势实现总纲（主线程脚本） | M4 |
| 5.2 有名字的动作 | 选答案/揭晓/左右滑作答（30% 阈值、模糊走按钮、1s 撤销）/翻条（Swiper）/长按倾诉 350ms（仅档4）/口播条/点欠账/拍照"正在看"/地图走/跳过收工 | components 各件 + @lynx-js/lynx-ui-swiper/-draggable；MicButton 仅档4；拍照态=vision 工具异步+占位 UI；连续 2 跳过→SessionEndTrigger；左右滑/拖拽吸附到位触发触觉（D1，components/haptics.ts） | M4/M6 |
| 5.3 主线程脚本写法 | 'main thread' 指令、runOnBackground 上报、useMainThreadRef、shared import、main-thread:ref、bindlayoutchange | pages/hooks（封装）；ARCHITECTURE §2 纪律 | M4 |
| 5.4 判定反馈 | 按下先行判定异步；对/模糊/错三态动效（错=下沉不抖）；模糊=脚手架入口不记账（D8 已裁决：不写 FSRS）；挣扎后答对反馈更足；减少动态效果降级 | components/FeedbackBar（判定触觉，D1）；design-system（三态动效参数）；AppSettings.reduceMotion→theme.ts 降级 | M3/M4 |
| 六 大厂规则 | 1~2 帧应答；可打断动画用数值驱动不用 CSS 关键帧；松手交速度；多手势同起判（8px 锁主轴）；边界软；行为思考；帧节奏稳；动效可关非唯一通道；空间/透明度两族曲线 | components 手势层实现准则；@lynx-js/motion（MotionValue+velocity）；design-system/motion.css（M3 换算曲线） | M3/M4 |
| 6.1 落地边界 | motion spring velocity 透传实测；主线程可读当前值；Element.animate 无 currentTime | M3 接入验证任务（velocity 实测→风险 R2） | M3 |
| 7.1 三档动画 | CSS transition/被看见 CSS+motion/跟手主线程脚本或 lynx-ui 回调；能用现成不自研 | components 实现分层；@lynx-js/motion mini 入口 | M3/M4 |
| 7.2 十条禁令 | 只动 transform/opacity/z-index；不增删节点；并发≤2/stagger≤6；滚动不测量；图片定尺寸；音频解码不在帧上；跨线程节流；>50ms 切分；blur 不进逐帧；降级档 | 组件实现 code review 检查单（M3/M4 评审依据）；节流参数入 design-system | M3/M4 |
| 7.3 Trace 验收 | 红橙帧<3%、P95<16.7ms、0.5s 首屏、冷启动≤1.5s、中低端机实测、帧间隔方差单列 | M7 验收报告（Trace+Recorder 流程） | M7 |
| 7.4 降级三档 | 完整/精简（跟手保留）/静止（只留透明度切换）；后台线程判定切换不跳界面；静止档仍保留触觉（D1 与"减少动态效果"互补） | design-system/theme.ts | M3/M4 |
| 八 替你定了的事 | 无 LUNA、无 TabBar、毛玻璃两处、长按 350ms、退出快于进入、stagger 前 6 条、FeedList、无共享元素转场、跟手仅复习+快速、可打断不用关键帧、两族曲线、手势同起判、惯性不自研、判定优先级、正向峰值收尾、四红线、有界会话、左右滑规则 | 散布于 design-system/components/pages——M3/M4 实现与评审对照本清单逐条核 | M3/M4 |
| 九 触觉（已拍板） | 吸附到位/判定对错两处触觉（@sigx/lynx-haptics） | **D1 已裁决：V1 引入**——components/haptics.ts 封装 + 手势/判定触发点；与"减少动态效果"互补（静止档保留触觉）；依赖选型见 ARCHITECTURE §12、风险 R6 | M6 |
| 附录 参数表 | 全量参数（阈值/曲线/弹簧/节流/字阶/圆角/色板命名…） | design-system/motion.css+tokens.css 常量逐一落（M3 验收对照） | M2/M3 |

## 3. 孤儿条款自查结论

- PRD §0~§10、附录、附外部依据：全部有落点；"V1 不做"项（§8 排除清单、批量导入、多学科轮播、首启 A/C 后续分流）已显式标注。
- UID 一~九、附录：全部有落点；UID §九（触觉）已经用户裁决 D1 落地（components/haptics.ts，M6）。
- 5 个 SKILL.md：全部经 skills/packs 装载（quick/review/standard/deep 为模式档，score-boost 为知识库型），references 资源清单原样装载为搜索起始白名单。
- 开放项清账：D1~D11 已全部裁决（总控 §0.1），决策记录见 ARCHITECTURE §16；评审报告 §三缺失清单逐行已补落点或显式标注（前置归因/收藏/模糊口径/复习时长/保持率催收/过程型话术/进度细线/A/B 运营项/M7 指标补全均已处理；首启 A/C 分流=V1 留白并注明原因；推荐上限两条=Home 渲染上限 2）。
