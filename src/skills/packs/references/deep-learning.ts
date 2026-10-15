/**
 * deep-learning 资源清单原样装载（源：/skill/deep-learning/references/资源清单.md，只读）。
 * 逐字保真——运行时按需检索素材与搜索起始白名单（§4.4），不做任何改写。
 */
export const DEEP_LEARNING_REFERENCE_CONTENTS: Record<string, string> = {
  'references/资源清单.md': `# 高质量学习档（档 3）· 参考资源清单

> 来源：《心理学研究方法_四档学习资源清单.md》《心理学研究方法_四档视频资料.md》档 3 部分，原样保留未做概括。
> 档位目标：进阶方法，能发正规论文；投入 6 个月~2 年；通过标准：独立复现高阶分析并过审；最常见坑：学了一堆方法但不会选。

---

## 一、档 3 · 文本资源

### 3.1 统计推断与元科学（打底上限）
- Lakens《Improving Your Statistical Inferences》全书 https://lakens.github.io/statistical_inferences/
- Lakens 全书**中文版**（社区翻译，免费）https://lakens.github.io/statistical_inferences_chinese/
- Lakens《Improving Your Statistical Questions》（MOOC）
- Justify Your Alpha（Shiny）https://shiny.ieis.tue.nl/JustifyAlpha/
- Munafò et al. (2017) https://www.nature.com/articles/s41562-016-0021

### 3.2 结构方程 / 潜变量模型
- lavaan.org 官方教程与书籍复刻页 https://lavaan.ugent.be/resources/books.html
- lavaan tutorial（Rosseel 官方，语法 \`=~\` \`~\` \`:=\`）https://faculty.washington.edu/matsueda/courses/529/Readings/Lavaan%20tutorial.pdf
- LADAL《Structural Equation Modelling in R》 https://ladal.edu.au/tutorials/structural_equations/structural_equations.html
- Usami Lab lavaan 教程（路径分析/CFA/SEM/LGM/交叉滞后/中介）https://usami-lab.com/lavaan_tutorial_en.html
- 《A Mild Introduction to SEM using lavaan》(User! Oslo) https://www.uv.uio.no/cemo/english/people/aca/ronnysc/user-sem-lavaan.pdf
- 书：Beaujean《Latent Variable Modeling Using R》；Broc & Gana《Structural Equation Modeling with lavaan》(Wiley)

### 3.3 测量等值 / 测量不变性
- semTools \`partialInvariance\` 效应量说明 https://cran.curtin.edu.au/web/packages/semTools/vignettes/partialInvariance.Rnw
- 《Multiple-Group CFA in R — measurement invariance tutorial》(连续/序数指标) https://files.eric.ed.gov/fulltext/EJ1038101.pdf
- 《Advances in Measurement Invariance and Mean Comparison of Latent Variables》(含 equaltestMI 包) https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.01823/full
- 《Advances in Psychometric Theory and Measurement for Psychological Sciences》(Rafa Bastos，开放书，含不变性章) https://elliedegb.quarto.pub/psychometrics/10-Measurement_Invariance.html

### 3.4 多层 / 混合效应模型
- lme4 + afex + emmeans（R 标准工具链）
- Barr et al. (2013)《Random effects structure for confirmatory hypothesis testing》
- debruine《Understanding mixed effects models through data simulation》 https://debruine.github.io/lmem_sim/
- Washington PSY524《Linear Mixed Models》 https://courses.washington.edu/psy524a/_book/linear-mixed-models.html
- 格拉斯哥 PSYC412 混合模型工作簿 https://lu-psy-r.github.io/previous-content/2425/PSYC412/part2/03-mixed-workbook.html
- LMU 心理 LMM 练习（交叉随机效应）https://www.oer.psy.lmu.de/MSc_UK/LMM/

### 3.5 纵向 / 交叉滞后模型
- Hamaker, Kuiper & Grasman (2015) RI-CLPM（Psychological Methods）
- Mplus RI-CLPM 多指标实现 https://www.statmodel.com/download/RI-CLPM.pdf
- RI-CLPM 常见问答与扩展 https://jeroendmulder.github.io/RI-CLPM/faq.html
- 治疗机制研究中的交叉滞后效应（多层 vs SEM 比较）https://pmc.ncbi.nlm.nih.gov/articles/PMC9245087/

### 3.6 贝叶斯统计
- Bayes Thinking Lab（含本科/研究生/博士三档，配 brms）https://www.bayes-thinking-lab.uni-osnabrueck.de/
- Stanford Psych 201s《Bayesian Data Analysis for Psychology》 https://web.stanford.edu/class/psych201s/
- Dienes《Using Bayes to get the most out of non-significant results》 https://users.sussex.ac.uk/~dienes/inference/Bayes.htm
- Etz《Bayesian Analysis with JASP》(SPSP，OSF 材料) https://osf.io/encp9
- 书：Kruschke《Doing Bayesian Data Analysis》；McElreath《Statistical Rethinking》

### 3.7 心理网络分析
- psychonetrics（SEM + 确认性网络分析）https://psychonetrics.org/
- psychonetrics 教程（specify → runmodel → modify → compare 流程）https://psychonetrics.org/tutorial.html
- psychonetrics 示例（GGM、阈值网络、多组网络）https://psychonetrics.org/examples.html
- 相关：qgraph / bootnet（Epskamp 网络分析工具链）

### 3.8 元分析 / 系统综述
- 流程教程：Field & Gillett (2010)《How to do a meta-analysis》 https://discoveringstatistics.com/repository/2010_field_&_gillett.pdf
- R 实操：van Lissa《Meta-Analysis Tutorial in R》 https://cjvanlissa.github.io/meta_workshop/tutorial.html
- 多元元分析（含 OSF 代码）https://files.eric.ed.gov/fulltext/EJ1429606.pdf
- 效应量理论：Schulze《Effect sizes》专书章节 https://www.methdiag.uni-wuppertal.de/
- 筛查工具：Rayyan（免费，支持盲筛/双人）https://www.rayyan.ai/workbench
- 工具对比与去重流程（Zotero 去重 → 盲筛 → PRISMA）https://researchgold.org/blog/covidence-alternatives-systematic-review-tools
- R 包：metafor / metaSEM / robumeta；书：Borenstein et al.《Introduction to Meta-Analysis》

### 3.9 缺失数据与稳健性
- 《Sensitivity analysis for multivariable missing data using multiple imputation: a tutorial》(NARFCS) https://arxiv.org/pdf/2502.02892v1.pdf
-  psychotherapy 效果研究中的 MI 敏感性分析 https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.01042/full
- mHealth 研究中的 MNAR 敏感性分析 https://pmc.ncbi.nlm.nih.gov/articles/PMC8277392/
- R 包：mice / miceFast / smdi；stata 对应实现

### 3.10 功效分析与模拟
- 《Simulating the Power of Statistical Tests: A Collection of R Examples》 https://arxiv.org/html/2110.09836v3
- LADAL《Power Analysis in R》（simr 扩展样本量）https://ladal.edu.au/tutorials/power_analysis/power_analysis.html
- Washington PSY315 Power 教程 https://courses.washington.edu/psy315/tutorials/power_tutorial.pdf
- Michigan Tech PSY5220 Power Analysis（pwr 包）https://pages.mtu.edu/~shanem/psy5220/daily/Day04Power/poweranalysis.html
- R 包：pwr / simr / PowRPriori / Superpower

### 3.11 因果推断
- Pearl 因果图 / DAG（区分混杂与中介）
- Rohrer 心理学因果推断论文
- Thornton《Learn》免费课（贝叶斯网络、d-分离、结构学习，bnlearn）https://research.thorntonstatistical.com/learn
- 书：Pearl《Causality》；Hernán & Robins《Causal Inference: What If》（免费在线）

### 3.12 心理测量 / 量表开发
- 《Best practice guidelines for scale development and validation》(Frontiers 2024，三阶段) https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1494261/full
- Boateng et al.《Best Practices for Developing and Validating Scales》 https://www.scirp.org/journal/paperinformation?paperid=87941
- 《Modern Psychometrics With R》书评（CRAN "Psychometrics" 任务视图）https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.00606/full
- Cooper《An Introduction to Psychometrics and Psychological Assessment》(2nd ed., 2023) https://www.cambridge.org/core/
- AI-GENIE《AI-driven Scale Development in Generative Psychometrics》(2025) https://arxiv.org/html/2603.28643
- 交互式练习：Excel 实现 VARIMAX 旋转 / Spearman–Brown 预测 / 题目分析 https://pmc.ncbi.nlm.nih.gov/articles/PMC12805185/
- 中文：戴海琦、张锋《心理与教育测量》；金瑜《心理测量》
- R 包：psych / lavaan / mirt / semTools / psychonetrics

### 3.13 认知神经科学方法（EEG / fMRI / 眼动）
- MNE-Python 全教程（EEG/MEG 全流程，含 ERP）https://mne.tools/stable/auto_tutorials/index.html
- MNE 官方 ERP 教程 https://mne.tools/1.2/auto_tutorials/evoked/30_eeg_erp.html
- 《Python-EEG-Handbook》（中英双版，含 GitHub 代码）https://zitonglu1996.github.io/files/2024Lu_BrainX.pdf
- fMRIPrep / nilearn；NI-edu（阿姆斯特丹大学 fMRI 导论 + 模式分析，完全免费开源）https://lukas-snoek.com/NI-edu/
- SPM 教程（block design 一阶建模）https://www.fil.ion.ucl.ac.uk/spm/docs/tutorials/fmri/block/modelling/block_design/
- FSL Course 讲义（静息态功能连接）https://pages.fmrib.ox.ac.uk/fslcourse/
- MIT OCW AFNI Training Bootcamp（视频）https://www.ocw.mit.edu/courses/res-9-006-afni-training-bootcamp-spring-2018/
- BrainIAK Tutorials（MVPA / RSA / 搜索光 / 背景连接）https://brainiak.org/tutorials/
- 《Introduction to Eye Tracking: A Hands-on Tutorial》(arXiv 2024) https://arxiv.org/pdf/2404.15435
- gazeR（R，注视与瞳孔数据处理）https://pmc.ncbi.nlm.nih.gov/articles/PMC7544668/
- pypillometry（Python 瞳孔数据）https://ihrke.github.io/pypillometry/usage.html
- 《Methods in cognitive pupillometry: Design, preprocessing, and statistical analysis》 https://pmc.ncbi.nlm.nih.gov/articles/PMC10556184/
- Pupillometry Bio-protocol（简单自动流程）https://pmc.ncbi.nlm.nih.gov/articles/PMC11986704/pdf/BioProtoc-15-7-5265.pdf
- OpenNeuro（开放脑影像数据集）/ Allen Brain Map（开放神经解剖数据）

### 3.14 特殊设计
- 单被试 / 单案例实验设计（SCED）
  - SCRIBE 2016 报告规范（26 条清单）https://academic.oup.com/ptj/article/96/7/e1/2864911
  - 单被试设计数据分析（视觉分析为主）https://kpu.pressbooks.pub/psychmethods4e/chapter/single-subject-research-designs/
  - AB 设计 / 中断时间序列 https://saylordotorg.github.io/text_research-methods-in-psychology/s14-single-subject-research.html
- 经验取样 / 生态瞬时评估（ESM / EMA）
  - 《Preprocessing ESM data: framework + tutorial website + R package + 报告模板》 https://ppw.kuleuven.be/okp/_pdf/RevolInPressPEDAS.pdf
  - ESM 方法总览（KU Leuven 讲稿）https://www.kuleuven.be/child-youth/en-in-the-spotlight/slides-esm/
  - 智能手机追踪婴儿发展：ESM 实操指南 https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.703743/full
  - EMA 概念与设计 https://www.simplypsychology.org/ecological-momentary-assessment.html
- 中断时间序列 / 倾向得分匹配 / 工具变量（准实验方法补充）

### 3.15 开放科学与可复现流程
- Experimentology https://experimentology.io/
- Stanford Psychology Guide to Doing Open Science（Poldrack）https://poldrack.github.io/psych-open-science-guide/
- 透明度实操指南（科隆大学）https://psych-transparency-guide.uni-koeln.de/preregistration.html
- Preregistration Standards for Psychology（APA 官方模板）https://www.apa.org/pubs/journals/resources/preregistration.pdf
- 预注册模板（T/A/I/M/AP 全条目）https://www.psycharchives.org/bitstream/20.500.12034/4043/1/
- 复现研究五步（Brandt et al.）https://www.fernuni-hagen.de/psychologie/forschung/open-science/
- 把研究资产做成 R 包（Crump，终极可复现）https://crumplab.github.io/vertical/manuscript/manuscript.pdf
- inrep（2025，问卷评估全流程 + LLM 适配）https://arxiv.org/html/2507.15893v3
- 平台：OSF / Zenodo / Figshare / Dryad / PsyArXiv / OpenNeuro

### 3.16 学术写作
- APA Publication Manual（第 7 版）
- 《美国心理协会写作手册》中译
- 《如何写作规范的论文（原书第 9 版）》 https://www.cqup.com.cn/
- 基于 APA 格式的写作指导（实证/综述结构、引用、图表）
- 《心理学研究方法：从选题到论文发表》（第 2 版）
- 英文写作辅助：科学写作公开课；Grammarly（AI 润色，注意学术诚信）

### 3.17 偏倚 / 数据异常检测（复核与自查）
- statcheck（自动重算 APA 格式 p 值，Lakens 书有中文说明）https://lakens.github.io/statistical_inferences_chinese/12-bias.html
- p-curve / z-curve（检验证据价值与 p-hacking）https://replicationindex.com/
- 《Beyond the p < 0.05 trap: 检测与预防 p-hacking》 https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2025.1675991/full
- GRIM / GRIMMER / SPRITE（校验均值方差一致性）
- 复现指数 / 可重复性指数（Schimmack）

### 3.18 工具链与资源合集（省时入口）
- awesome-reproducible-research（可复现研究案例/项目/教程合集）https://github.com/leipzig/awesome-reproducible-research
- emptymalei/awesome-research（科研工具全景）https://www.trackawesomelist.com/emptymalei/awesome-research/
- FORRT 学科资源页 https://forrt.org/disciplines/
- Open Science MOOC https://opensciencemooc.eu/
- o2r R2S2 知识库（可复现研究知识库索引）https://o2r.info/r2s2/knowledge-base/
- R2S2 / EOSC Research Data Management 课程 https://eosc.eu/events/research-data-management-introductory-course
- 中文：《中国早期职业研究人员开放科学技术指南》（中科院文献情报中心）http://gooa.las.ac.cn/gooa_mobile/mobile/newsdetail.htm?id=791
- 中文：《早期职业研究人员开放科学能力指南》PDF https://open4science.cn/static/ECR_OpenScience_Guide_CN.pdf

---

## 二、档 3 · 视频资源

### 3.1 结构方程 / 潜变量
- Mikko Rönkkö SEM 视频（YouTube 200+ 集，SEM 各方面）[英] https://www.explanatorytrials.com/Resources.html
- Lesa Hoffman 讲义视频（多层模型与 SEM 精讲，Iowa PSQF 6249 公开）[英] https://jonathantemplin.github.io/Structural-Equation-Modeling-Fall-2025/
- SEMinR PLS-SEM 视频系列（5 集：反映/形成测量、结构模型、PLSpredict、中介、调节）[英] https://seminr.io/posts/2026-08-09-video-series-pls-sem-in-r-with-seminr/
- ResearchWithFawad SmartPLS4 系列（含数据清洗、SEM、中介调节分步视频）[英] https://researchwithfawad.com/index.php/lp-courses/smartpls4-tutorial-series/steps-in-data-analsis/

### 3.2 多层 / 混合模型
- Lesa Hoffman 混合模型课程视频（见上条，同一站点）
- StatQuest 进阶播放列表（回归族、机器学习基础，为混合模型打底）[英] https://statquest.org/video_index.html
- Quantitude（播客+视频，多层模型与心理统计讨论）[英]

### 3.3 贝叶斯
- Coursera《Improving your statistical inferences》第 5~8 周贝叶斯模块（视频）[英] https://www.coursera.org/learn/statistical-inferences
- Bayes Thinking Lab 交互演示（本科 / 研究生 / 博士三档，配 brms）[英] https://www.bayes-thinking-lab.uni-osnabrueck.de/
- SPSP 工作坊录像《Bayesian Analysis with JASP》[英] https://osf.io/encp9

### 3.4 元分析 / 系统综述
- 系统综述筛查工具演示：Rayyan（含盲筛、双人协作、冲突处理）[英] https://www.rayyan.ai/workbench
- Cochrane 官方培训视频（系统综述方法全流程）[英] https://training.cochrane.org/
- R 元分析实操（van Lissa 工作坊，含视频与代码）[英] https://cjvanlissa.github.io/meta_workshop/tutorial.html

### 3.5 认知神经科学
- MNE-Python 教程（含官方视频/Notebook 讲解，EEG/MEG/ERP 全流程）[英] https://mne.tools/stable/auto_tutorials/index.html
- MIT OpenCourseWare《AFNI Training Bootcamp》（fMRI 分析全套录像）[英] https://www.ocw.mit.edu/courses/res-9-006-afni-training-bootcamp-spring-2018/
- NI-edu fMRI 课程（阿姆斯特丹大学，讲义 + Jupyter 实验室，免费开源）[英] https://lukas-snoek.com/NI-edu/
- BrainIAK Tutorials（MVPA / RSA / 搜索光 / 背景连接，Jupyter 教程）[英] https://brainiak.org/tutorials/
- Python-EEG-Handbook（中英双版，配套 GitHub 代码，可跟做）[中/英] https://zitonglu1996.github.io/files/2024Lu_BrainX.pdf
- 眼动 / 瞳孔：pypillometry 使用示例、gazeR 处理流程（含教程文档）[英] https://ihrke.github.io/pypillometry/usage.html

### 3.6 开放科学 / 可复现
- Stanford Psychology Guide to Doing Open Science（预注册等，配示例）[英] https://poldrack.github.io/psych-open-science-guide/
- 科隆大学透明度指南（含预注册、分析可复现章节）[英] https://psych-transparency-guide.uni-koeln.de/preregistration.html
- FORRT 教学资源（含术语表与教学模块）[英] https://forrt.org/
- 中文：中国开放科学网络 / 中科院文献情报中心 开放科学讲座与指南 [中] http://os.las.ac.cn/zh-CN/events
- 中文：《中国早期职业研究人员开放科学技术指南》（工具书）[中] http://gooa.las.ac.cn/gooa_mobile/mobile/newsdetail.htm?id=791
`,
};
