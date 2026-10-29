# Planner PPT Skill 全流程运行分析与优化报告

> 历史补充：本报告原先聚焦当前 fresh run 的直接问题。结合此前 7 个升级与测试任务后，完整的演化因果链、被替代机制和收敛优先级见 `SKILL_EVOLUTION_CAUSAL_AUDIT.md`。历史审计结论优先于本文中任何局部补丁式建议。

日期：2026-07-17  
审计对象：`planners-ppt-output-fresh-20260716` 全新全流程运行，以及当前 `planners-ppt-hell` Skill 合同、脚本、Prompt、测试和运行产物。  
方法：只读核查 flow events、Parent/Worker task 与 result、运行日志、模板 registry、Layout Plan、SVG task、验证摘要、测试代码和交接文档；未自动批准人工审阅。

## 一、结论摘要

本次运行慢，不是一个单一性能问题，而是三类时间叠加：

1. **必要成本**：模板、Layout、最终 SVG 的人工门禁，以及源页、canvas、SVG 的多轮渲染和视觉检查。
2. **需求演进成本**：模板反馈页面在实际使用中连续调整；每次 HTML 改动都会令旧审批 hash 失效。这一安全机制是正确的，但界面合同没有先稳定，导致重复审批。
3. **可避免的系统返工**：任务生成器提供的结果模板与 Collector 强合同不一致，时间戳规则也未被脚本统一生成，直接造成大量收集失败和子 Agent 元数据返修。这是本次最明确、最应优先修复的结构性问题。

日志记录窗口从 `2026-07-16 11:05:35 UTC` 到 `15:24:42 UTC`，历时约 **4 小时 19 分**。Parent 发起 81 次命令：61 次成功、20 次失败。失败中 17 次是 `collect-results`、2 次是 `collect-all`、1 次是 `publish-template`。由此可见，主要浪费不在命令本身的执行时长，而在失败后的人机/Agent 往返、重新写结果、重新收集和重新审阅。

当前核心重构方向大体成立：`content_base` 已建立，真实 6 页 Layout 全部回退到 `content_base`；两个 SVG batch 只携带当前使用的 `content_base.svg` 和最小合同文件，没有携带完整 profile、asset registry、`components.svg` 或未选 canvas；locked layer hash、required components 和 validator 仍保留。

但不能判定“完成定义全部满足”：最终人工视觉反馈文件仍不存在；当前自动验证虽为 0 error，却有 **105 warning、31 info**；当前测试模板也没有保留漏斗、流程、数据、对比等可选专用模型。因此，本次运行属于“核心架构改造有效、自动测试通过、最终质量与部分交接要求未闭环”。

## 二、为什么运行时间这么慢

### 2.1 日志中的直接证据

- flow event 共 173 条，其中 Parent command started 81 条、completed 61 条、failed 20 条。
- `next` 调用 19 次、`start-review` 12 次、`make-task` 8 次、`collect-results` 成功 7 次，另有大量失败收集。
- 失败集中在结果收集阶段，说明 Parent 与 Worker 的交付合同没有做到“一次生成、一次验收”。
- 两个 SVG batch 的业务输入分别为 35,027 bytes 和 38,351 bytes；每个 Worker 还必须读取约 32,301 bytes 的 workflow/style/SVG/contract 文档。单 batch 的有效上下文超过 67–70KB，且其中存在陈旧或互相矛盾的规则。
- 当前测试模板仅有 `cover / contents / chapter / content_base / closing`。6 个内容页都使用开放基础 canvas，意味着结构设计几乎完全由 SVG Worker现场完成，未能通过可选专用模型降低复杂页面的设计成本。

### 2.2 最大的可避免返工：结果模板和 Collector 合同冲突

`make_agent_task.py` 生成的 `output_template.agent_result.json` 没有 `input_hashes`。返修任务也没有把 Collector 要求的顶层 `feedback_sha256` 放入模板。与此同时：

- `agent_result_contract.md` 声称 Worker“使用 output template，只需填充 status 和 summary”；
- Collector 将 `input_hashes` 视为必填非空对象；
- 有 revision feedback hash 时，Collector 还强制比较顶层 `feedback_sha256`；
- Collector 严格要求 `started_at >= task generated_at` 且 `completed_at >= started_at`。

这构成了确定性失败路径：Worker忠实照模板写，也无法第一次通过 Collector。运行中实际出现了缺失 `input_hashes`、`feedback_sha256` 放错层级、开始时间早于任务生成时间、完成时间早于开始时间等连续返修。

结论：**子 Agent 的反复首先是生成器/合同缺陷，其次才是 Agent 执行稳定性问题。**

### 2.3 Prompt 与实现陈旧，增加理解和决策负担

当前 Skill 文档仍存在以下矛盾：

- `SKILL.md` 仍要求模板审阅提交“四个全局维度”，但本次产品决策已移除这四项。
- `smoke_v2.py` 仍构造旧 `dimensions` 数据，测试没有覆盖新的反馈体验合同。
- SVG Worker 文档仍要求替换 replace layer 内的“中性占位内容”，但新架构要求生产 replace layer 为空。
- SVG Worker 文档仍引用完整 `template_profile.json.usage_policy.mode=binding`，而实际最小 SVG task 已不传完整 profile。

Agent面对“任务实际输入”和“文档规则”冲突时，只能额外判断哪个才是当前真相，导致速度下降、行为不稳定，也增加错误修复概率。

### 2.4 正常但应被管理的门禁成本

- 模板审阅、Layout 审阅、最终视觉审阅都必须由人完成，不能自动批准。
- 页面 2–6 图片未加载、模板审阅 404、反馈表单过重、Layout 文案渲染丑陋等问题都发生在真实使用后；修复 HTML 会改变审批对象 hash，因此重新审批是正确行为。
- SVG 生成后发现 page 6 footer/title 问题并返修，属于必要视觉质量成本；问题是许多可预判的排版风险没有在 Layout 或 SVG preflight 阶段提前阻断。

### 2.5 运行操作层面的额外摩擦

- review server 曾出现“记录显示复用、实际 curl 为 000”的陈旧进程状态。
- 发生过错误脚本路径、参数顺序、`stop-review --stage` 用法等操作错误。
- 屏幕权限申请属于可避免的工具路径选择：本地 review HTML、PNG 和截图可优先通过本地 Server、文件读取和专用图像查看完成；只有确需控制系统 GUI 时才应申请屏幕权限。本次没有证据表明该权限是修复核心问题的必要条件。

## 三、对话中提出的问题是否被正确解决

| 问题 | 判定 | 证据与剩余问题 |
|---|---|---|
| 页面 2–6 图片未加载 | 已解决 | review 资源路径修复，页面资源可返回 HTTP 200。 |
| 四个反馈栏目无必要、阻断通过 | 运行时已解决，合同未同步 | 实际页面改为简化交互；但 `SKILL.md` 和 smoke fixture 仍保留旧 dimensions，未来可能回归。 |
| 每个 Layout 保留框选和单独反馈框 | 已解决 | 当前模板审阅支持逐 Layout 选择与反馈。 |
| 最后保留整体反馈框 | 已解决 | 当前页面保留 overall feedback。 |
| 模板命名保留 | 已解决 | 当前模板反馈页保留 template name。 |
| `00_template_review.html` File not found | 已解决 | 审阅页已重新生成，Server 恢复；但 Server 陈旧状态仍需脚本级治理。 |
| Layout 页面文案丑陋、表格逐行裸排、内容重复 | 根因已修，最终质量仍需人工确认 | renderer 已支持结构化 table/list，并去除重复 core message；修改后审批 hash 正确失效。 |
| 修复后继续生成 SVG | 已执行 | 6 页 SVG 已生成并通过 0-error validator；仍有 105 warnings。 |
| `content_base` 默认回退 | 已解决 | 6 页使用不同 Layout taxonomy，但 `template_layout_id` 全为 `content_base`。 |
| SVG task 只传实际 canvas 与最小信息 | 已解决 | 两个 task 都只传 `content_base.svg`，未传完整 profile、asset registry、components 或未选 canvas。 |
| replace layer 为空、标题正文由 wireframe 决定 | 自动测试层面已解决 | smoke 覆盖 empty replace；真实页面按 Layout Plan 执行。仍需最终人工视觉确认。 |
| locked hash、required components、validator 和人工门禁不能削弱 | 已保持 | visual gate 与 smoke 通过；最终人工 visual feedback 尚未提交。 |
| 漏斗、流程、数据表、三卡对比仅作可选专用模型 | **未完整解决** | 它们没有误入 SVG task，但当前测试模板 registry 中这些可选模型被整体删除，而交接要求是保留为可选模型。 |
| 最终视觉质量 | **未闭环** | validation status 为 warning：0 errors、105 warnings、31 infos；最终 `_internal/05_review/feedback.json` 不存在。 |
| 全流程完成定义 | **未满足** | 自动测试通过不等于人工视觉批准与全部 Phase 要求完成。 |

### 当前质量警告的实际含义

105 个 warning 中，主要包括：65 个 `FONT_TOO_SMALL`、15 个 `TEXT_CONTAINER_TIGHT`、7 个 `TEXT_OVERLAP_SLIGHT`、6 个 `FONT_SIZE_TIERS`、4 个 `LOW_MODULE_UTILIZATION`、4 个 `HIGH_TEXT_DENSITY`、3 个 `FONT_FAMILY_DRIFT`、1 个 `LARGE_EMPTY_REGION`。其中 page 3 的高密度表格是主要来源。

因此“0 errors”只能说明没有触发当前 hard validator，不应表述为“可读性和视觉质量已经通过”。当前门禁对文本可读性的容忍度过高，且最终人工批准缺失。

## 四、子 Agent 为什么反复

### 根因排序

1. **P0：机器生成的结果模板不满足机器收集合同。** 这是最直接、可复现的系统缺陷。
2. **P0：时间戳和 hash 由自然语言指导 Agent 手工填写。** 高精度元数据不应交给生成模型自由书写。
3. **P0：同一规则在生成器、合同、Collector、Prompt、测试中重复定义且不同步。** 修改一处后容易出现漂移。
4. **P1：文档有旧 UX、旧 replace layer 和旧 profile 规则。** Agent需自行消解冲突。
5. **P1：质量问题发现太晚。** Layout 允许高密度内容进入 SVG；SVG Worker完成后才由总体验证暴露问题。
6. **P1：上下文过大。** Worker读取大量通用规则和完整页面内容，真正当前 batch 必需的信息占比偏低。
7. **P2：Parent 是命令往返式编排。** make/bind/spawn/wait/collect/revise 多步需人工或主 Agent反复推进，缺少一次性 preflight 和自动收敛。

需要强调：子 Agent 仍有可改进之处，例如应在提交前本地运行合同自检、不得手写不确定时间戳、视觉 warning 较多时不应仅凭 0 error 宣告完成。但这些行为应由工具强制，而不是依赖每个 Agent 记住所有细节。

## 五、具体优化方案

### P0：先消灭确定性返工（建议一个短迭代完成）

#### 1. 建立唯一的结果生成器，不再让 Worker手写元数据

新增一个确定性脚本，例如 `scripts/orchestrate/finalize_agent_result.py`，输入 task path、status、summary 和实际输出文件，由脚本自动生成：

- `task_sha256`
- 全部 `input_hashes`
- 全部 output file hashes
- UTC `started_at / completed_at`
- revision 顶层 `feedback_sha256`
- `worker_run_id / executor_role / batch_id`

Worker只负责业务输出、状态和摘要。Collector 与结果生成器调用同一份 schema/helper，禁止再复制两套字段定义。

验收：每种 step 的新 task 生成后，其 output template 可由 helper 一次补全并一次通过 Collector；revision task 必测；元数据返修次数为 0。

#### 2. 修正 `make_agent_task.py` 与合同

- output template 必须至少包含 Collector 全部必填字段。
- 有 revision hash 时必须包含顶层 `feedback_sha256`。
- 合同删除“只需填 status 和 summary”这种与实际不符的描述，改为“业务字段由 Worker提供，元数据由 helper 生成”。
- task 生成后立即执行 `validate_task_contract`，验证 task、output template 和 Collector schema 一致，再允许 spawn。

#### 3. 同步所有陈旧文档与测试

- `SKILL.md`、Parent workflow、review schema、smoke fixture 统一为当前反馈交互：逐 Layout 选择、逐 Layout 反馈、模板名、整体反馈；不再要求四个 dimensions。
- SVG Worker 文档改为“replace layer 初始为空；内容由已批准 wireframe 生成”。
- 删除对 SVG task 中完整 profile binding 的要求，改为仅使用实际 task 提供的 `template_style` 和选中 canvas。
- 加回归测试，确保旧字段不会再次成为必填或阻断全部通过。

#### 4. 修复 review server 生命周期

`start-review` 不应仅相信 pid/state 文件，必须同时检查进程和 `/health`；陈旧状态自动清理并重启。`stop-review` 的参数和错误提示应与 CLI 实际接口一致。

### P1：把质量问题前移，缩短 SVG 返修

#### 5. Layout 审批前增加容量 preflight

对 wireframe 估算文本容量和最小字号。建议阻断条件：

- 正文预计字号低于 20px（脚注可单独定义例外，如不低于 18px）；
- 标题、正文、页脚边界可能相交；
- 单页密度超阈值且没有拆页、摘要或表格压缩策略；
- structured table 被降级成逐行文本。

允许人工显式 override，但不能静默放行。page 3 这类 67 个 warning 的页面应在 Layout 阶段就被要求拆分、摘要化或重新分配信息层级。

#### 6. SVG Worker提交前执行同一套 preflight

Worker生成 SVG 后先渲染和 lint。若出现 blocking warning，必须在同一 Worker轮次内修复，再生成 result；Parent只接收通过 preflight 的结果。区分：

- hard errors：locked hash、required component、越界、无效 SVG；
- blocking warnings：字体过小、标题/页脚侵入、明显重叠；
- advisory warnings：轻微空白、层级建议。

不要再用“0 errors”替代“视觉可读性通过”。

#### 7. 补齐关键测试缺口

- 测试 output template 与 Collector schema 一致。
- 测试 revision 的 `feedback_sha256` 和 UTC 时间顺序。
- 测试新模板反馈 UX，不再构造旧 dimensions。
- 测试 Layout review 对 table/list 的语义渲染与 core message 去重。
- 增加默认模板的真实不匹配内容页 forward test，明确断言选择 `content_base`，而不是只检查 registry 名称。
- 测试当前模板保留可选 funnel/process/data/compare 且未选择时不进入 SVG task。
- 增加 warning budget 测试，避免 0-error/100+ warning 仍被自动描述为完成。

#### 8. 减少 SVG task 上下文

Layout 批准后生成紧凑的 `on_slide_content`：只保留最终上屏文案、wireframe、asset role、template layout、必要设计理由。不要把原始长文本、重复摘要、提取证据和不再参与决策的字段继续传给 SVG Worker。

将 32KB 通用文档拆成“始终必读核心合同”和“按条件加载的规则片段”；task 明确声明需要哪些片段。目标是单 batch 输入与规则文本总量减少至少 40%，同时不删除 validator 与视觉门禁。

#### 9. 恢复可选专用模型，但保持精确匹配

当前测试模板应恢复 funnel、process、data table、three-card comparison 等可选 canvas；它们不能含黑灰占位块，replace layer 为空，只有 Layout Worker精确选择时才进入 SVG task。这样既满足交接要求，也能降低复杂页面全部从 `content_base` 现场设计的成本。

### P2：改造编排和持续度量

#### 10. 合并机械往返

提供受控的 `dispatch-and-collect`：task preflight 通过后并行派发；Worker完成后自动运行 result helper、Collector、render 和 batch preflight。只有业务失败、视觉失败或需要人工批准时才回到 Parent。

这不取消门禁，只消除 `make → bind → wait → collect → 修元数据 → collect` 的机械循环。

#### 11. 按 hash 缓存不变产物

源 SVG、canvas、页面 SVG 未变化时复用 PNG 渲染和非视觉验证；审批 hash 仍绑定真实输入。这样 UI 文案小改不会无条件重跑所有无关页面。

#### 12. 建立运行指标

每次运行自动输出：

- 首次 Collector 通过率；目标 ≥95%。
- 元数据返修次数；目标 0。
- Parent failed command；目标 0（业务主动阻断单独计数）。
- 每个 batch 的输入字节和规则字节；目标较当前下降 ≥40%。
- 每页 errors、blocking warnings、advisory warnings。
- 每个 Worker实际业务返修次数与纯元数据返修次数，禁止混为一谈。
- review server 健康失败次数；目标 0。

端到端时长应区分“机器活动时间”和“等待用户审批时间”。不建议把人工审阅等待计入 Agent 性能；建议先以同机 6 页任务的机器活动时间下降 40% 作为阶段目标，再积累 5–10 次运行基线后确定绝对 SLA。

## 六、推荐实施顺序

1. 先修 result helper、output template、Collector 共用 schema 和 revision hash；这是收益最高且风险最小的一组。
2. 同步 Skill/Parent/SVG Worker 文档和 smoke fixture，清除旧 dimensions、旧 replace、旧 profile 规则。
3. 加 task preflight、Layout capacity gate、SVG blocking-warning gate。
4. 补真实 default `content_base` forward test 和可选专用模型测试。
5. 压缩 batch payload 和按条件加载规则。
6. 最后再做自动 dispatch、hash cache 和指标面板。

## 七、完成标准建议

下一轮完整运行只有同时满足以下条件，才应报告为完成：

- smoke、MECE、quick validate、当前模板 visual gate 全部通过；
- 当前模板与默认模板都通过真实 `content_base` forward test；
- 可选专用模型存在，未选择时绝不进入 task；
- 每个 Worker结果首次通过 Collector，无元数据返修；
- validator 0 error，blocking warning 为 0，advisory warning 在约定预算内；
- 新模板人工审阅页和 Server 健康；
- 最终视觉 review 对当前 hash 有明确人工反馈；
- 文档、生成器、Collector、Prompt、默认模板和测试使用同一合同；
- 未自动批准任何人工门禁。

## 八、证据与日志索引

- `RUN_LOG.md`：运行阶段摘要。
- `WORK_LOG_DETAILED.md`：主流程、修复、失败与决策的详细工作日志。
- `LOG_INDEX.md`：日志和证据入口。
- `_internal/00_project/flow_events.jsonl`：Parent 命令、反馈和 Worker affinity 的结构化事件日志。
- `_internal/00_project/review_server.log`：本地审阅 Server 日志。
- `_internal/00_project/tasks/*_task.json`：各 Worker收到的任务合同。
- `_internal/00_project/tasks/*agent_result.json`：各 Worker交回的结果和元数据。
- `_internal/04_validation/validation_summary.json`：最终机器验证摘要。

说明：这些文件可记录 Agent 的任务、输入、输出、时间、错误、重试和结果，但不应声称包含模型不可导出的隐藏思维链。可审计目标应是完整的行动日志、合同差异、工具输出、失败原因和修复记录。
