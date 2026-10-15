/**
 * quick-learning 资源清单原样装载（源：/skill/quick-learning/references/资源清单.md，只读）。
 * 逐字保真——运行时按需检索素材与搜索起始白名单（§4.4），不做任何改写。
 */
export const QUICK_LEARNING_REFERENCE_CONTENTS: Record<string, string> = {
  'references/资源清单.md': `# 快速学习档（档 1）· 参考资源清单

> 来源：《心理学研究方法_四档学习资源清单.md》《心理学研究方法_四档视频资料.md》档 1 部分，原样保留未做概括。
> 档位目标：建立地图，能读懂论文的方法/结果；投入半天~3 天；通过标准：复述研究流程，看懂 p 值/效应量/CI；最常见坑：只背术语不理解“为什么这样设计”。

---

## 一、档 1 · 文本资源

### 1.1 术语与速查
- FORRT Glossary of Open Science & Research Methods（最权威的方法学术语对照表）https://forrt.org/glossary/
- APA Dictionary of Psychology（概念速查）https://dictionary.apa.org/
- StatQuest with Josh Starmer（YouTube，一个概念一个短片）https://www.youtube.com/@statquest
- Crash Course Psychology（研究/实验/相关/变量 科普）
- 中文：知网/万方精读 3 篇核心期刊论文的“研究方法”章节
- 中文：把《心理与教育测量》的概念章 + 《心理统计学》目录拍照当速查表

### 1.2 单页 / 短文（读一遍就够）
- Lakens《Improving Your Statistical Inferences》（先读 p 值 / 效应量 / CI 三章）https://lakens.github.io/statistical_inferences/
- Munafò et al. (2017)《A manifesto for reproducible science》https://www.nature.com/articles/s41562-016-0021
- Experimentology 前言 + 第 1 章（斯坦福，讲什么算好实验）https://experimentology.io/
- Brandt et al. (2014)《The Replication Recipe》复现五步
- 中文：《心理学开放科学运动的中国实践》（中国社会科学网，一页看懂国内现状）https://cssn.cn/skgz/bwyc/202601/t20260129_5971174.shtml

### 1.3 中文速览
- 中国大学MOOC《心理学研究方法》华南师大（先看目录建知识图）https://www.icourse163.org/course/0401SCNU029-1207050815
- 中国大学MOOC《心理统计学》华南师大 https://www.icourse163.org/course/scnu-1461522173
- 学堂在线《心理统计》北京师范大学（看大纲）https://www.xuetangx.com/course/bnu07111001834/1515306
- 黄希庭《心理学研究方法》目录 + 前言

### 1.4 工具 30 分钟上手
- jamovi（免费开源，点选式统计）https://www.jamovi.org/
- JASP Video Library（逐功能短视频）https://jasp-stats.org/resources/
- AsPredicted（一页式预注册）https://aspredicted.org/
- OSF（开个项目，体验数据/材料/代码托管）https://osf.io/

### 1.5 视频 / 播客
- Method Minute / Quantitude / The Psychology Podcast（方法学碎片输入）
- B 站搜“心理统计 速成”“心理学研究方法 入门”挑高播放合集

### 1.6 档1 自检（能答上来即可进档2）
- 差异：实验 vs 相关 vs 准实验；自变量/因变量/混淆变量
- p 值到底在说什么？效应量和 CI 为什么更该看？
- 预注册是什么、为什么能防 p-hacking

---

## 二、档 1 · 视频资源

### 1.1 统计与概念短片（先看这些）
- StatQuest 视频总索引（Josh Starmer，一个概念一个短片，从均值/标准差开始按序看）[英] https://statquest.org/video_index.html
- StatQuest YouTube 频道 https://www.youtube.com/@statquest
- Crash Course Statistics（40 集完整系列，每集 10 分钟）[英] https://www.youtube.com/@crashcourse
- Crash Course Psychology（研究/实验/变量 相关集）[英] https://www.youtube.com/@crashcourse
- 3Blue1Brown（概率、中心极限定理的直觉可视化）[英] https://www.youtube.com/@3blue1brown

### 1.2 研究方法完整视频课（免费）
- Class Central 免费视频课《Psychology - Research Methods》（YouTube 导论课：抽样、调查、实验、相关、效度、p 值、伦理）[英] https://www.classcentral.com/course/youtube-psychology-research-methods-95066
- Bryan Koenig《Stats Video Textbook》（每章配视频，标注时长与编号）[英] https://bryankoenig.wixsite.com/statsvideotextbook

### 1.3 中文视频（快速建立感觉）
- B站《心理统计学》北京师范大学 刘红云（公开课全片，最系统的中文统计课）[中] https://www.bilibili.com/video/BV1MKSYBwEHr/
- B站 三分钟老赵：各种统计方法到底该怎么用 [中] https://www.bilibili.com/video/BV1ykES6aEhb/
- B站 60 分钟从相关到回归（强化营）[中] https://www.bilibili.com/video/BV1iW4y127qV
- B站 参数估计 / 双样本标准误公式推导（端木老师，考研向）[中] https://www.bilibili.com/video/BV16JYWzYE5i/

---

## 三、检索关键词速查（自己找更多）
- 中文：心理学研究方法 / 心理统计学 / 实验心理学 / 心理测量 / 文献综述 / 论文写作 / 元分析 / 结构方程模型 / 多层模型 / 预注册 / 开放科学
- 英文：psychology research methods / statistics for psychology / R for psychologists / SEM tutorial / multilevel modeling / Bayesian / meta-analysis / open science / preregistration / psychometrics
- 限定平台：\`site:youtube.com\`、\`site:bilibili.com\`、\`site:coursera.org\`、\`site:classcentral.com\`、\`site:xuetangx.com\`、\`site:icourse163.org\`
`,
};
