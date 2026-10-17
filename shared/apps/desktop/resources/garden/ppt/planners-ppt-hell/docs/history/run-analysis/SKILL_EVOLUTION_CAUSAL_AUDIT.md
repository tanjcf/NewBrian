# Planner PPT Skill 历史演化与因果审计

日期：2026-07-17  
审计范围：用户指定的 7 个历史 Codex 任务、当前 Skill、`Template-Runtime-Simplification-Handoff.md`、本次 fresh E2E 产物与现有分析报告。  
目的：解释当前问题是如何在连续优化中形成的，区分“当时合理的修复”“被后续需求取代的机制”“没有同步清理的残留”，并给出一次结构性收敛方案。

## 一、重新判断：问题不只是某个脚本有 bug

上一份报告正确找到了当前运行中的直接故障，例如 agent result 模板缺字段、时间戳返修、文档与实现不一致。但把 7 段历史合并后，根因需要上移一层：

> 当前主要问题是缺少“架构决策的替代与退役机制”。每次测试都解决了真实问题，但新决定覆盖旧决定时，代码、Prompt、合同、默认模板、测试和生成产物没有作为一个原子变更一起迁移。

因此，系统逐渐形成了多代设计叠加：

```text
强 Parent / 严格状态机
→ 首批审阅后并行
→ 全量并行、一次性审阅
→ 纯视觉模板方向
→ 真实图片资产复用
→ 原生 Shape / fidelity 组件
→ required-components 强绑定
→ layout canvas / locked hash
→ content_base 运行时简化
```

这条演化链本身有逻辑；问题是旧代合同没有完整退出。例如：

- 已经取消四维模板反馈，但 Skill 和 smoke fixture 仍有旧字段。
- 已经不向 SVG task 传完整 profile，SVG workflow 仍讲 profile binding。
- 已经要求 replace layer 为空，workflow 仍说替换“中性占位内容”。
- 已经采用 `content_base` 作为默认开放页，当前测试模板又把可选专用模型全部删掉，形成从“过度强制”到“过度删除”的反向过冲。
- Collector 已经严格要求 provenance，任务生成器仍输出不完整 result 模板。

所以当前不能继续采用“看到一个症状、补一个字段或判断”的方式。应先冻结最终架构语义，再做一次纵向收敛。

## 二、历史审计范围与量化

审计任务按时间顺序：

| 日期 | 任务 ID | 主要主题 |
|---|---|---|
| 2026-07-10 | `019f4b26-e955-7fb1-97aa-424853f9e1d5` | 三轮测试后的首次系统优化；Parent、并行、模板证据、审批会话；随后删除 `pptflow.py` |
| 2026-07-10 | `019f4bdf-9f43-7a00-9685-5534fde936ce` | Parent 启动、并行状态、结果收集、事件日志、审阅白屏与历史字段兼容 |
| 2026-07-11 | `019f4fc9-0e97-7cb0-8383-968889c9725e` | 模板提取从结构解析转为视觉方向；目录输入、证据和置信度 |
| 2026-07-11—12 | `019f50e8-528c-7e30-ab94-3067d16b1404` | 全量并行、batch Worker、一次性 Review、Parent 去设计职责、warning 降级、模板输入闭环 |
| 2026-07-14 | `019f5ff7-8d0c-78f1-87d6-87891739841f` | 模板真实资产复用、reuse plan、原生 Shape、fidelity 模板包、required components |
| 2026-07-15—16 | `019f651d-f843-7562-a864-e9cc70af68a3` | 真实运行复盘、Server、Agent affinity、Prompt 精简、模板人工审阅和本地模板库；最终形成简化交接文档 |
| 2026-07-16 | `019f6901-e7f9-7631-a698-cd0526f62a10` | 真实 6 页运行：视觉降级、模板弱复用、组件重建、错误项目路径、元数据返修、footer blocker |

七个根任务日志共记录：

- **1,380 次 exec 调用**；
- **324 次 patch apply 结束事件**。

这不是 324 个唯一文件或 324 个独立提交，部分是运行产物修正和同一文件的多轮调整；但它足以说明修改频率和热修密度很高。尤其 `019f651d...` 单任务记录了 599 次 exec 和 169 次 patch apply，真实测试与 Skill 升级高度交织。

## 三、逐阶段因果链

### 阶段 A：为解决“Parent 没有真正工作”，控制面不断增强

最早的问题是真实的：Skill 只在理念上说 Parent/Worker，却不能阻止主 Agent直接生产 SVG。为此先后引入或强化：

- 强制 Parent 启动协议；
- `next --json` 权威动作；
- Worker task/result；
- event logging；
- 合法并行模式切换；
- Parent 委托统一 Collector；
- 删除重复的 `pptflow.py` 状态推导。

这些方向大体正确，也解决了双状态机和主 Agent越权问题。但副作用是控制逻辑逐渐散布到：

- `SKILL.md`
- Parent workflow
- `ppt_parent.py`
- `pipeline_gate.py`
- `make_agent_task.py`
- `collect_agent_results.py`
- review server
- smoke fixtures

当一个字段或状态发生变化，需要同步的消费者很多。后续 agent result 模板与 Collector 不一致，就是这种“同一合同多处复制”的典型后果。

### 阶段 B：为解决“按页 Worker慢且跨页不一致”，改为 batch Worker

历史测试显示 6 个单页 SVG Worker重复读取 700 多行通用规则，8 个 Agent 总计约 54.2 万 tokens。用户明确要求：

- 一个 Worker负责一整个 batch；
- 所有 batch 一次性生成；
- 最后只做一次全 deck Review；
- Parent 不做设计总监；
- warning 不要被 Parent过度阻断。

因此系统从“首批 3 页校准后并行”改成“Layout批准后全部 batch 同轮生产”。这个变更提升了速度，也让当前 6 页任务由两个 Worker完成。

但有两项旧语义没有完全退出：

1. 一些文档和 gate 仍带有首批/顺序演化痕迹。
2. 为避免 validator 太敏感，warning 被整体弱化；后来又出现 0 error 但 105 warning 的结果。也就是说，修复“过度阻断”时，没有重新定义一小组真正应阻断的可读性 warning。

这不是简单地把 validator 调严或调松能解决，而是需要三层语义：technical error、blocking readability warning、advisory warning。

### 阶段 C：模板提取目标曾发生三次根本变化

#### C1：视觉方向阶段

最初从 PPTX XML 提取颜色和字体效果不可靠，因此模板路径被收缩为：

```text
PPTX/PDF/图片 → 页面 PNG → 多模态观察 → template_profile 设计方向
```

当时用户明确要求：模板只给色彩、字号家族、标题位置和疏密方向，不锁死组件、坐标和页面模型。这个阶段产生了 `design_direction + evidence + confidence`。

#### C2：真实资产复用阶段

真实测试随后暴露：只有设计方向时，SVG Worker会“仿照”模板，而不真实调用背景。于是加入：

- `template_asset_registry.json`
- `template_reuse_plan.json`
- required asset 引用校验

这解决了“背景确实来自 PPT”这一问题，但也把模板运行时从方向包扩展为资产绑定系统。

#### C3：fidelity 组件阶段

之后发现标题前红色圆角矩形属于 PPT原生 Shape，不在图片资产中。为解决这一点，又引入或强化：

- 原生 Shape 候选；
- `components.svg`；
- fidelity registry；
- required components；
- 组件来源与样式校验；
- layout canvas 与 locked layer hash。

这些机制解决了“模板元素必须真实复用”，但逐渐把源 PPT 的业务模型也固化进模板：漏斗、流程、数据表、三卡对比进入 required/locked 层。模板从“视觉身份”膨胀成“源案例页面模型集合”。

这就是后来黑灰占位块、模型框死和 SVG task 过重的直接历史来源。

### 阶段 D：真实运行中的模板弱化，引发一次反向过度补强

`019f6901...` 的真实运行中，Template Worker 最初只批准两个背景组件，所有 layout 的 required components 为空。结果：

- P1–P3 只用了浅灰背景；
- P4–P6 甚至没有调用模板组件；
- 名义上是 fidelity，实际上是 reference-only。

为修复这个问题，当场重建了 7 个组件并强制 required components。这个修复确实让 SVG “用上模板”，但发生了三个重要副作用：

1. Template Worker一度把文件写到另一个测试项目目录。
2. 组件被 Worker任意缩放和混用，导致每页标题红线不同、出现非模板底部红线。
3. 数据表、流程、漏斗、三卡等业务模型逐渐被当成模板锁定结构。

这说明“required components”本身不是错误；错误在于它没有只约束稳定视觉身份，而被用于解决所有模板相似度问题。

### 阶段 E：当前运行时简化是必要纠偏，但出现了反向过冲

`Template-Runtime-Simplification-Handoff.md` 给出的最终产品判断是目前最清晰的一版：

> 模板固定视觉身份和页面边界；Layout决定内容结构；SVG Worker执行批准的 canvas、wireframe 和文案。

它要求：

- `content_base` 默认开放画布；
- replace layer 为空；
- 未选专用模型不进入 task；
- SVG task 不带完整 profile、asset registry、components 或提取证据；
- required components 和 locked hash 继续保留。

当前 fresh run 已证明核心简化生效。但迁移不完整：

- 当前测试模板只剩 5 个核心页，专用模型被全部删除；
- SVG workflow 仍保留旧 profile/placeholder 说法；
- review UX 合同仍有旧四维度；
- agent result generator 与 Collector 仍不一致。

也就是说，Phase 方向正确，但没有完成“所有消费者同步迁移”和“被取代机制退役”。

## 四、历史决策变化与当前残留

| 主题 | 较早决定 | 后来有效决定 | 当前残留风险 |
|---|---|---|---|
| SVG Worker 粒度 | 每页一个 Worker | 每 batch 一个 Worker | 部分旧说明和 task/result 习惯仍按单页思考 |
| Review 节奏 | 首批审阅后再并行 | 全量生成后一次全 deck Review | 首批并行演化痕迹仍可能进入 gate/文案 |
| Parent 角色 | 项目经理兼设计审阅者 | 只做控制，不判断设计 | 有些文档仍暗示 Parent承担设计判断 |
| 模板人工介入 | 轻量子功能，不新增人工 gate | 新模板必须人工审阅并进入本地模板库 | 多代 review schema 共存，四维反馈未完全退役 |
| 模板输出 | 方向性 profile | 已批准运行时 canvas + 最小视觉身份 | 完整 profile/asset/components 的旧运行时说法仍在 |
| 模板强制程度 | reference only | fidelity required-components | required 的范围一度扩张到业务模型，后来又把专用模型全部删除 |
| replace layer | 中性占位块 | 空 replace layer | SVG workflow 仍讲替换占位内容 |
| warning 策略 | 设计 warning 可阻断 | 避免过度敏感，由视觉审阅判断 | 0 error + 大量小字/密度 warning 仍可宣称完成 |
| Worker 修订 | 可启动新 Agent | 优先恢复原 Agent | affinity 被当成正确性依赖时，Agent失效可能阻断；task仍须自包含 |

这些决策变化并不是“谁当时做错了”。大部分来自真实使用后对产品边界的重新认识。真正的问题是：新决定没有显式声明它替代哪些旧决定，也没有一份强制清理清单。

## 五、为什么测试一直通过，真实运行仍反复出问题

### 1. 测试数不是稳定、可比较的基线

历史中 smoke 通过数曾出现：17、19、21、23、24、随后 12、13、14、15、16，当前为 36。测试套件发生过多次重写、合并和清理，因此“通过项数量增加”不能证明旧需求持续被覆盖。

当前 36/36 仍没有覆盖：

- 新模板反馈 UX 已取消四维字段；
- 任务生成器的 output template 必须满足 Collector；
- revision 顶层 `feedback_sha256`；
- 当前模板保留可选专用模型；
- 默认模板真实不匹配内容选择 `content_base`；
- 高 warning 负担不能被描述为视觉完成。

### 2. 多次测试不是冻结版本测试

历史运行经常采用：

```text
启动真实项目
→ 发现问题
→ 直接修改 Skill 或运行产物
→ 沿用已有 task/hash/approval 继续运行
→ 最终通过
```

这样能验证“有工程师现场修复时最终能完成”，但不能验证“一个冻结 Skill 从头运行能稳定完成”。中途修改会造成：

- 旧 task 对新合同；
- 旧审批 hash 对新 HTML；
- 旧 result 对新 Collector；
- 旧 template registry 对新 SVG；
- 同一项目混合多个 Skill 版本。

当前 fresh run 已比早期更严格，但仍在真实运行中修改了模板反馈 UI、Layout renderer 和审阅文件。修复本身正确，然而最终应再用冻结后的 Skill 开一个全新 acceptance run，才能证明稳定性。

### 3. 运行产物曾被手工补写

历史中 Parent多次直接修 task/result/profile/registry 的字段和 hash，包括 `pages_reviewed`、`input_hashes`、时间戳和 output hash。这让 gate 最终通过，却掩盖了“任务生成器本来就不能生成一次可验收结果”的事实。

元数据修复不应该是 Agent推理任务，也不应通过现场 patch 运行产物解决。

### 4. 没有架构级一致性测试

现有测试擅长检查单个脚本行为，但缺少一条检查：

> 同一个概念是否在生成器、合同、Collector、Prompt、默认模板、review schema 和 smoke fixture 中只有一种有效定义？

因此每个局部测试可以通过，整体仍存在合同漂移。

## 六、最核心的架构问题

### 6.1 没有稳定的架构不变量清单

这个 Skill 需要的不是再写一份长架构文档，而是一小组不能被局部修复破坏的不变量：

1. Parent只控制流程，不直接生产 Worker业务产物。
2. Template、Content 可并行准备；Layout必须等待两者完成。
3. Layout处理整 deck，并冻结最终上屏文案、wireframe 和 canvas 选择。
4. 一个 batch 一个 SVG Worker；task 自包含；原 Agent优先但不是 correctness 唯一依赖。
5. 模板运行时只包含批准的视觉身份、页面边界、当前选中 canvas 和所需媒体。
6. `content_base` 是不匹配专用模型时的唯一默认回退。
7. required components 只约束被批准为稳定身份的元素；业务模型只有被 Layout精确选择时才成为当前页要求。
8. technical errors、blocking readability warnings、advisory warnings 三层分开。
9. 新模板、Layout、最终 deck 都需要真实人工审阅；审批绑定当前 artifact hash。
10. task/result provenance 由确定性脚本生成和验证，不交给模型手写。

后续所有修改先逐条检查是否违反这些不变量，而不是直接编辑最接近症状的文件。

### 6.2 同一合同存在多个“权威副本”

Agent result 字段目前至少在：

- Markdown contract；
- task output template；
- Collector required-fields；
- smoke fixture；
- Worker Prompt。

中重复定义。Review schema、template runtime 和 warning 语义也有同样问题。

这违反 Skill 创建中的低自由度原则：hash、时间戳、必填字段、路径等脆弱控制面应由唯一机器实现决定，不能让多个 Prompt和脚本分别维护。

### 6.3 模板提取证据、模板定义和模板运行时没有彻底分层

历史上这三层不断互相渗透：

- 提取证据：源页、结构候选、置信度、视觉对照。
- 模板定义：哪些元素是稳定身份、哪些 canvas 被批准、哪些模型是可选。
- 运行时：当前 batch 实际需要的 canvas、style 和媒体。

当前 simplification 已基本切断 SVG task 与提取证据，但文档和测试还没有完全完成同样的分层。

### 6.4 视觉能力被当作运行中偶然条件

历史 Worker在 Playwright沙箱失败后直接把 `vision_available=false` 当作可接受降级，直到用户追问才提权并补做视觉优化。

对于此 Skill，视觉检查不是可有可无的信息字段。应在派发 Worker前完成 capability preflight：

- 可渲染并查看：正常执行；
- 渲染因沙箱失败：立即走明确的提权路径；
- 模型没有图片能力：在开工前告知 Parent，改用有视觉能力的 Worker或请求用户选择；
- 不允许生成后才悄悄降级为纯结构自检。

## 七、应采用的最终架构边界

```text
用户输入/模板选择
        │
        ├── Template Worker：提取、构建、视觉自审、新模板人工审阅
        │                    ↓
        │             Approved Runtime Template
        │             registry + canvases + style + needed media
        │
        └── Content Worker：整 deck 内容结构
                             │
                             └──── join ───→ Layout Worker
                                              │
                                              ├─ final_on_slide
                                              ├─ wireframe
                                              └─ template_layout_id
                                                       │
                                          batch-scoped SVG Workers
                                                       │
                                      validator + PNG visual repair
                                                       │
                                            Full-deck Human Review
                                                       │
                                                    Export
```

关键边界：

- Template Worker 可以复杂；SVG runtime 必须简单。
- Layout可以做语义选择；SVG Worker不得重新选择模板模型。
- Validator严格保护文件、hash、锁定层和明确的必需身份；视觉启发式按分级策略处理。
- Review UI负责收集反馈，不承担隐藏的结构合同。
- Parent推进状态，但不能靠手工补 JSON让状态通过。

## 八、结构性收敛方案

### Phase 0：冻结决策，不改代码

先把上面的 10 条不变量作为本轮变更检查表，逐项映射到现有文件。任何历史机制必须标记：

- keep：仍是最终架构的一部分；
- narrow：保留但缩小范围；
- superseded：被新决定替代，所有引用必须删除；
- test-only：只用于测试，不进入运行时；
- audit-only：只保留为提取/审计证据。

没有完成这张映射前，不再新增字段、gate、registry 或 fallback。

### Phase 1：先统一控制面合同

优先解决 agent result，而不是先调视觉：

- 选择一个机器可执行 schema 作为唯一权威；
- `make_agent_task.py`、结果 finalizer 和 Collector 共用它；
- Worker不再手写 hash、输入摘要和时间戳；
- revision feedback hash 自动从 task生成；
- Markdown contract 由机器 schema 描述，不再另写一套字段规则。

这一阶段应删除重复字段列表，而不是再增加兼容分支。

### Phase 2：完成模板简化迁移，而不是继续增加模板能力

- 保留一个 registry；
- 保留 `content_base`、核心功能页和真正有证据的可选专用模型；
- 当前测试模板恢复 funnel/process/data/compare 为 optional，但普通页面不得看到它们；
- required components 只含稳定身份或当前明确选择的专用模型；
- replace layer 为空；
- 删除旧占位、旧预览、旧 `content_light` 和未引用代码；
- SVG workflow、task builder、default template、smoke 同步到同一语义。

### Phase 3：固定 Review 产品合同

新模板 Review 的最终交互固定为：

- 模板名称；
- 每个 Layout 的选择；
- 每个 Layout 的可选反馈；
- 整体反馈；
- 提交/批准绑定当前 artifact hash。

删除四维 feedback 的 Prompt、schema 假设和 smoke fixture。以后若产品交互再变，应一次修改 renderer、server parser、contract、fixture 和文档，不能只改 HTML。

### Phase 4：重建质量分级

不要回到“所有 warning 都阻断”，也不能继续“0 error 即完成”。建议：

- technical errors：始终阻断；
- blocking readability warnings：小于最低字号、明确重叠、footer invasion、标题越界，阻断 Worker completed；
- advisory warnings：密度、节奏、空白和轻微 baseline，展示给视觉审阅但不自动阻断。

阈值应集中在现有 validator 的一个权威位置，workflow 只引用类别，不重复列规则。

### Phase 5：建立冻结版本 acceptance protocol

以后每次真实测试遵循：

1. 记录当前 Skill 文件 hash/代码版本。
2. 新建全空项目，不复用 task、review、preview、registry 或 Server state。
3. 测试期间禁止修改 Skill；只记录失败。
4. 若发现阻断问题，终止该 run，修改 Skill并运行自动回归。
5. 用新目录从头重跑；不得在旧 task/hash 上继续。
6. 只有冻结版本 fresh run 完成，才能宣布稳定。

开发调试 run 可以边修边跑，但必须明确标注为 development run，不能作为最终 acceptance 证据。

### Phase 6：用四条 golden paths 验收

1. 无模板：默认模板 + 普通内容使用 `content_base`。
2. 新模板：完整提取、人工模板审阅、发布到本地库、再应用。
3. 专用模型：只有精确匹配时选择 data/process/compare 等 canvas；未选择时 task 中不存在。
4. Revision：原 Agent可用时复用；明确不可用时替代 Worker仍能凭自包含 task 正确完成；result 首次通过 Collector。

每条都检查：Server health、task context、artifact hash、warning 分级、最终人工门禁和导出。

## 九、当前应停止的做法

- 不再在真实 acceptance run 中直接 patch Worker result、timestamp 或 hash。
- 不再为一个新问题增加第二个 registry、兼容字段或 legacy fallback。
- 不再用“测试全部通过”替代合同覆盖检查。
- 不再让 Template Worker、SVG Worker和 Parent分别解释同一 required-components 规则。
- 不再把视觉无法使用当作生成后的静默降级。
- 不再把“模板相似度不足”一律转化为更多 required components。
- 不再为了简化而删除所有可选专用模型。
- 不再把旧 HTML、旧 PNG、旧 registry 留在项目中继续参与 hash 或审阅。

## 十、优先级修正

结合历史，上一份报告的优化优先级应调整为：

### P0

1. 冻结最终架构不变量与 supersession 清单。
2. 统一 agent task/result 机器合同，取消手工元数据。
3. 完成模板简化的全消费者迁移：文档、Prompt、脚本、默认模板、测试、当前模板。
4. 固定 Review UX 合同并清除四维残留。
5. 建立冻结版本 fresh acceptance 规则。

### P1

6. 建立视觉能力 preflight 与明确升级/替代路径。
7. 将 readability warning 分级，避免 0 error + 105 warning 被视为完成。
8. 恢复并验证可选专用模型，同时维持最小 SVG task。
9. 清理 review server 陈旧状态和命令碎片。

### P2

10. 再做 task payload 压缩、渲染缓存和自动 dispatch/collect。

先做 P0 才能避免性能优化继续建立在漂移合同上。

## 十一、最终判断

当前 Skill 的核心思想已经接近正确，问题不是需要推倒重写。真正需要的是一次“替代式收敛”而不是又一轮功能增加：

- 保留 Parent/Worker职责边界；
- 保留 batch 并行和全 deck Review；
- 保留视觉优先模板提取；
- 保留 locked hash 与 required identity；
- 保留 `content_base` 和最小 SVG runtime；
- 删除被后续决定取代的 UX、profile binding、占位内容和重复合同；
- 把脆弱元数据从 Agent自由文本降为确定性脚本；
- 用冻结版本 fresh run 验收。

历史真正说明的是：这个系统的问题不是“控制太少”或“控制太多”，而是控制没有按层分配。设计判断应保留自由度；任务 provenance、路径、hash、时间戳和 gate 必须低自由度；模板提取可以重，模板运行时必须轻；人工审阅可以灵活，审批证据必须严格。

这应成为下一轮升级的总原则。

## 十二、历史证据路径

- `/Users/ivan/.codex/sessions/2026/07/10/rollout-2026-07-10T16-31-09-019f4b26-e955-7fb1-97aa-424853f9e1d5.jsonl`
- `/Users/ivan/.codex/sessions/2026/07/10/rollout-2026-07-10T19-52-54-019f4bdf-9f43-7a00-9685-5534fde936ce.jsonl`
- `/Users/ivan/.codex/sessions/2026/07/11/rollout-2026-07-11T14-06-44-019f4fc9-0e97-7cb0-8383-968889c9725e.jsonl`
- `/Users/ivan/.codex/sessions/2026/07/11/rollout-2026-07-11T19-20-30-019f50e8-528c-7e30-ab94-3067d16b1404.jsonl`
- `/Users/ivan/.codex/sessions/2026/07/14/rollout-2026-07-14T17-31-26-019f5ff7-8d0c-78f1-87d6-87891739841f.jsonl`
- `/Users/ivan/.codex/sessions/2026/07/15/rollout-2026-07-15T17-31-30-019f651d-f843-7562-a864-e9cc70af68a3.jsonl`
- `/Users/ivan/.codex/sessions/2026/07/16/rollout-2026-07-16T11-39-20-019f6901-e7f9-7631-a698-cd0526f62a10.jsonl`

说明：历史 rollout 包含用户消息、可见 Agent回复、工具调用、patch 事件和工具输出。本报告只使用可审计记录，不声称读取或导出模型隐藏思维链。
