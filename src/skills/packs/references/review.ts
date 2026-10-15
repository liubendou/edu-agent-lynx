/**
 * review 资源清单原样装载（源：/skill/review/references/资源清单.md，只读）。
 * 逐字保真——运行时按需检索素材与搜索起始白名单（§4.4），不做任何改写。
 */
export const REVIEW_REFERENCE_CONTENTS: Record<string, string> = {
  'references/资源清单.md': `# 复习档（档 4）· 参考资源清单

> 来源：《心理学研究方法_四档学习资源清单.md》《心理学研究方法_四档视频资料.md》档 4 部分，原样保留未做概括。
> 档位目标：巩固保持，转成可复现习惯；投入贯穿全程；通过标准：3 个月后仍能不看笔记跑通；最常见坑：用重读代替检索练习。

---

## 一、档 4 · 文本资源

### 4.1 学习科学（学法本身，有实证支撑）
- Dunlosky et al. (2013)《Improving Students' Learning With Effective Learning Techniques》（评出高效策略：检索练习、间隔、交错、自我解释、精细提问）
- Karpicke & Roediger (2008) 检索练习（一周后回忆率约 80% vs 35%）https://scholarly.so/blog/the-science-of-spaced-repetition-why-most-students-study-wrong
- Cepeda et al. (2006) 间隔效应元分析（254 项研究，间隔约为集中的 2 倍）https://www.structural-learning.com/post/improving-students-memory-a-guide-to-the-research
- Cornell Learning Strategies Center《Effective Study Strategies》 https://lsc.cornell.edu/how-to-study/studying-for-and-taking-exams/effective-study-strategies/
- SCU《Study Strategies》（spaced practice / active retrieval / 固定节奏）https://www.scu.edu/media/offices/oae/resources/efc/EFC-Study-Strategies-Slides-.pdf

### 4.2 学法书单 / 课程
- 《Make It Stick》Brown, Roediger & McDaniel（中译《认知天性》，讲透检索/间隔/交错/困难学习）https://www.makeitstick.com/about-the-book
- 《Ultralearning》Scott Young（中译《超级学习者》）
- Coursera《Learning How to Learn》Oakley & Sejnowski https://www.coursera.org/learn/learning-how-to-learn
- edX《Learn Like a Pro》Oakley & Schewe https://www.edx.org/learn/how-to-learn/
- Anki 手册 + 间隔重复实践（Nielsen 的多年 Anki 实验长文）

### 4.3 复习工具链
- Anki / SuperMemo（方法卡片：正面问“何时用”，背面写判据）
- Obsidian / Logseq（双链笔记：方法 ↔ 条件 ↔ 代码 ↔ 论文互链）
- Zotero + Better BibTeX
- Quarto / R Markdown（复现即复习）
- OSF / GitHub / Zenodo（版本与共享）

### 4.4 主动复现练习（比读书有效得多）
- 每月挑 1 篇带开放数据+代码的论文，从零复现其结果
- 用预注册模板写“假”预注册，与已发表论文对照
- 手工复算经典效应量（d、η²、OR、BF）与软件比对
- 用 Anki 做“方法选择判据”自测（t 检验 vs ANOVA vs 混合模型 vs 贝叶斯）
- 用公开数据集完整走一遍清洗→分析→写报告

### 4.5 报告规范 / 检查清单（写完即复习）
- CONSORT（随机对照试验）、CONSORT 扩展
- STROBE（观察性研究）
- PRISMA 2020 / PRISMA-P（系统综述与协议）
- SPIRIT（试验方案）
- STARD（诊断研究）、TRIPOD（预测模型）
- SRQR / COREQ（质性研究）
- CARE（个案报告）
- SCRIBE 2016（单被试/行为干预）
- APA JARS（量化）与 JARS-Qual（质性、混合方法）https://www.apa.org/pubs/journals/releases/amp-amp0000191.pdf
- EQUATOR Network（所有报告规范总入口）https://www.equator-network.org/reporting-guidelines-report-section/whole-report/
- Wicherts et al. (2016) 预注册检查清单；Brandt et al. (2014) 复现检查清单

### 4.6 社区与持续输入
- FORRT（开放与可复现研究教学框架）https://forrt.org/
- SIPS（Society for the Improvement of Psychological Science）
- PsyArXiv / OSF Preprints（跟踪最新方法）
- Cross Validated (StackExchange)、r/AskStatistics
- Class Central / Coursera（回看已购课程）
- Lakens 博客与 MOOC 更新（方法学前沿）

### 4.7 复习节奏表
| 时点 | 动作 |
|---|---|
| 学完当天 | 合上资料口头复述框架（主动回忆） |
| 第 2 天 | Anki 第一轮 + 复算 1 个公式 |
| 第 7 天 | 换新数据集重跑同类分析 |
| 第 21 天 | 给别人讲一遍（费曼式），标出讲不清处 |
| 第 60 天 | 复现一篇论文，检验是否真会 |
| 每季度 | 更新知识库，淘汰过时方法，补新方法 |

---

## 二、档 4 · 视频资源

### 4.1 学法视频课（先学怎么学）
- Coursera《Learning How to Learn》（Oakley & Sejnowski，视频课）[英] https://www.coursera.org/learn/learning-how-to-learn
- edX《Learn Like a Pro》（Oakley & Schewe，神经科学取向）[英] https://www.edx.org/learn/how-to-learn/
- B站：Anki 使用教程、间隔重复实操合集 [中]（B站搜「Anki 间隔重复 教程」）
- B站：Obsidian / Logseq 双链笔记教程合集 [中]

### 4.2 复现与工具操作视频
- Quarto / R Markdown 官方视频与教程（把分析做成可重跑报告）[英] https://quarto.org/docs/get-started/
- Zotero 官方教程视频（文献管理与引用）[英] https://www.zotero.org/support/
- Git / GitHub 入门视频（结合 OSF 做版本管理）[中/英]
- Statistics of Doom 的复现类实操视频 [英] https://statisticsofdoom.com/

### 4.3 报告规范讲解视频
- EQUATOR Network（各报告规范总入口，含讲解材料）[英] https://www.equator-network.org/reporting-guidelines-report-section/whole-report/
- APA JARS 量化报告标准（官方 PDF + 讲解）[英] https://www.apa.org/pubs/journals/releases/amp-amp0000191.pdf
- PRISMA 2020 官方讲解与工作坊视频 [英] http://www.prisma-statement.org/

### 4.4 中文视频平台入口（长期补给）
- 中国大学MOOC https://www.icourse163.org/
- 学堂在线（清华，视频课为主）https://www.xuetangx.com/
- 网易公开课（心理学 / 统计公开课合集）https://open.163.com/
- B站（搜索关键词：心理统计、心理学研究方法、论文写作、Anki、SEM、元分析）
- 超星学习通（部分高校《心理学研究方法》课程）

### 4.5 复习节奏（配合视频）
| 时点 | 用视频做什么 |
|---|---|
| 当天 | 看 1 个 StatQuest / B站短片，口头复述框架 |
| 第 2 天 | 回看软件操作视频，跟着点一遍 |
| 第 7 天 | 看一个方法对比视频（如 t 检验 vs ANOVA vs 混合模型） |
| 第 21 天 | 给别人讲一遍（录屏自测，费曼式） |
| 第 60 天 | 看复现类视频，跟着完整跑一遍分析 |
| 每季度 | 回看进阶播放列表，淘汰过时方法 |

---

## 三、附录 · 按目标选路（一句话版）
- 只想看懂论文 → 档1 + 档4.1
- 考研/本科毕业论文 → 档1 → 档2（中文教材 + MOOC + jamovi/JASP）
- 要发 SCI/SSCI → 档2 → 档3.1/3.2/3.4/3.15/3.16
- 做临床/干预研究 → 档2.8 + 档3.12/3.14 + 报告规范（CONSORT/JARS）
- 做认知神经 → 档2.6 + 档3.13
- 做测量/量表 → 档3.3 + 档3.12
- 长期保持不遗忘 → 档4 全套（Anki + 复现 + 检查清单）
`,
};
