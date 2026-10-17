# Planner's PPT Hell 当前架构（Observed Architecture）

> 本文只描述 2026-07-17 正式 Skill 的真实实现，不把计划中的修复伪装成现状。未来设计见 `03_UPGRADE_EXECUTION_AND_ACCEPTANCE.md`。

## 1. 系统目标与边界

该 Skill 把 Markdown 与可选模板转换为经过三道人机门禁的可编辑 PPTX：

```text
输入/模板选择
  → Content（完整内容事实）
  → Layout（结构、wireframe、精确上屏文案）
  → SVG batches（已批准结构的视觉执行）
  → 全 deck 视觉审阅
  → Parent 受控导出 PPTX
```

核心边界：

- Parent 是控制平面，不应做页面设计判断。
- Worker 是生产平面，只能读 task 明列输入、写 task 明列输出。
- Server 是人工证据写入面，所有批准与反馈绑定 HTML/PNG hash。
- Validator 是确定性技术门禁，不替代视觉判断。
- Template canvas 固定视觉身份和页面边界；Layout Plan 决定内容结构；SVG Worker只执行已批准 canvas、wireframe 和文案。

## 2. 分层架构

| 层 | 权威文件/模块 | 唯一职责 |
|---|---|---|
| Skill 路由 | `SKILL.md`, `agents/openai.yaml` | 激活条件、不可变规则、按角色路由最小参考 |
| 控制平面 | `scripts/orchestrate/ppt_parent.py` | 派生状态、生成下一动作、绑定 Agent、收集结果、启动审阅、发布模板、导出 |
| 工单平面 | `make_agent_task.py`, `agent_task_contract.md` | 生成最小输入/输出/权限/命令工单 |
| 回执平面 | `collect_agent_results.py`, `agent_result_contract.md` | 验证任务身份、时间、输入/输出 hash、写入范围和阶段性视觉闭环 |
| Content | `02_content_worker.md`, `page_content_contract.md` | 把源 Markdown 转成完整可追溯页面内容；不做版式取舍 |
| Layout | `03_layout_worker.md`, `layout_taxonomy.md`, `layout_plan_contract.md` | 决定内容关系、上屏文案、wireframe、素材角色、模板 canvas 选择与容量 |
| SVG | `04_svg_worker.md`, `style_system.md`, `svg_rules.md`, `worker_svg_contract.md` | 从已选 canvas 出发，在 approved wireframe 内执行视觉与文案 |
| 模板提取 | `prepare_visual_references.py`, `extract_template_assets.py`, `build_fidelity_template.py` | 准备视觉证据、提取候选、由 Worker批准并构建 fidelity 包 |
| 模板运行时 | `layout_canvas.py`, `template_registry.json`, `layout_canvases/*.svg` | 用单一 registry 选择实际 canvas；locked layer hash 保持模板身份 |
| 模板库 | `template_library.py`, `apply_fidelity_template.py`, `assets/template_library/*` | 发布/校验/应用人工批准的模板包；默认模板始终可用 |
| 技术验证 | `validate_contracts.py`, `validate_svg_layout.py`, `estimate_layout_capacity.py` | Schema/跨文件、SVG/PPT 兼容、hash、容量和诊断 |
| 视觉证据 | `render_svg_png.py`, `template_visual_gate.py` | 渲染当前 SVG/canvas，验证视觉自检证据与 hash |
| 人工审阅 | `generate_template_review_html.py`, `generate_layout_html.py`, `generate_review_html.py`, `review_server.py` | 生成并通过健康本地 Server 提交模板/Layout/Visual 决策 |
| 导出 | `native_svg_to_ppt.py` | 仅在 Parent 设置批准环境变量后，把当前 SVG 转换为 PPTX |
| 复盘 | `analyze_run.py`, retrospective contract/workflow | 生成候选改进，不自动改 Skill 或 memory |
| 测试 | `smoke_v2.py`, `mece_scan_v2.py`, Skill `quick_validate.py` | 回归状态机、合同、模板、门禁与结构完整性 |

## 3. 运行状态机

`ppt_parent.py::derive()` 是当前唯一状态派生器。它不保存第二套状态机，而是从 manifest、产物、result、feedback provenance 和 hashes 推导：

```text
PROJECT_MISSING
  → TEMPLATE_INTAKE
  → TEMPLATE_RENDER_REQUIRED（PPTX 且无逐页图时）
  → PREPARE / TEMPLATE（模板与内容可并行）
  → TEMPLATE_REVIEW
  → TEMPLATE_REVISION（退回原 Agent）
  → TEMPLATE_PUBLISH
  → CONTENT
  → LAYOUT
  → LAYOUT_REVIEW
  → SVG_BATCH_BUILD
  → VISUAL_REVIEW
  → EXPORT
  → COMPLETE
```

状态事实来源：

- 稳定索引：`_internal/00_project/page_manifest.json`
- 追加事件：`_internal/00_project/flow_events.jsonl`
- Agent affinity：只从 `worker_agent_affinity` 事件读取，不另建 registry。
- 审批：只从 Server 写入的 feedback + provenance + 当前 HTML/PNG hashes 派生。
- Worker完成：task + `agent_result.json` + 实际输出 hash + 阶段门禁共同决定。

## 4. 项目产物目录与所有权

```text
project/
├── 00_template_review.html          Server 提供，人工模板审阅
├── 01_layout_direction.html         Server 提供，人工 Layout 审阅
├── 02_visual_review.html            Server 提供，全 deck 视觉审阅
├── final_deck.pptx                  Parent 导出
└── _internal/
    ├── 00_project/
    │   ├── page_manifest.json       Parent/controller
    │   ├── flow_events.jsonl        Parent/Server 追加
    │   ├── tasks/                    controller 生成 task；Worker写 result
    │   ├── template_visuals/         视觉证据准备脚本
    │   ├── template_profile.json     Template Worker + 候选提取合并
    │   ├── template_asset_registry.json Template Worker
    │   ├── template_worker_result.json  Template Worker fidelity 决策
    │   ├── template_canvas_self_review.json Template Worker视觉闭环
    │   ├── template_feedback.json    review server
    │   └── fidelity_template/
    │       ├── template_registry.json Builder，唯一模板 registry
    │       ├── components.svg        Builder审计/构建产物，不应进入 SVG task
    │       ├── layout_canvases/*.svg Builder，SVG生产起点
    │       └── canvas_previews/      模板视觉门禁证据
    ├── 01_content/page_content.json Content Worker
    ├── 01_layout_plan/
    │   ├── layout_plan.json          Layout Worker
    │   ├── layout_capacity_report.json Parent脚本
    │   └── layout_feedback.json      review server
    ├── 02_svg_source/*.svg           对应 batch Worker
    ├── 03_png_preview/                Parent正式渲染
    ├── 04_validation/
    │   ├── batches/*                 对应 batch Worker运行给定命令
    │   ├── validation_summary.json   Parent无损合并
    │   └── integrated_review.json    Parent无损合并 Worker判断
    ├── 05_review/feedback.json       review server
    ├── 06_ppt_output/                Parent导出报告
    └── 07_retrospective/             retrospective worker/script
```

## 5. 内容、结构与视觉的三份单一事实源

| 问题 | 唯一权威 |
|---|---|
| 这一页有哪些原始事实与完整内容？ | `page_content.json` |
| 哪些文案上屏、如何组织、区域在哪里？ | 已批准 `layout_plan.json`，尤其 `copy_handling.final_on_slide` 与 `wireframe` |
| 模板固定什么视觉身份、页面从哪里开始？ | 已批准 `template_registry.json` 指向的当前 `layout_canvases/*.svg` |

禁止产生第二套 layout 分类字段。`layout_id` 只表示通用组织逻辑，`template_layout_id` 只选择一个实际 canvas；二者职责不同，不应互相替代。

## 6. 模板生命周期

### 6.1 新模板提取

1. 用户明确选择新模板与 fidelity/reference 模式。
2. 宿主把 PPTX/PDF/图片转换为有序逐页视觉证据。
3. `extract_template_assets.py` 仅提取 structural candidates；不能凭 XML 宣告视觉结论。
4. Template Worker查看 contact sheet 与所有源页，写 profile、asset registry；fidelity 模式还写 Worker决策。
5. Builder 生成一个 registry、`components.svg` 和逐 layout canvas。
6. Worker渲染 canvas，与源页逐页视觉对照，写 self-review；visual gate 校验覆盖、must-fix 和 hashes。
7. 人工逐 layout Yes/No + 单独反馈，最后整体反馈和模板命名；不自动批准。
8. 只有人工批准后 Parent 才发布到 Skill 本地模板库。

### 6.2 模板运行时

- Layout Worker读取 `template_profile.design_direction` 与 registry，选择 `template_layout_id`。
- 精确语义匹配时可选择专用 canvas；没有精确匹配时必须选择 `content_base`。
- SVG task 只携带当前 batch 用到的 canvas、registry、最小 `template_style` 与已批准内容/计划。
- `components.svg`、完整 profile、提取证据、asset registry、未选 canvas 不进入 SVG task。
- SVG Worker从 canvas 开始，locked layer 必须通过 hash 校验，replace layer 初始为空；标题和正文坐标来自 wireframe。

### 6.3 当前模板库实况

- `planner-simple-default`：默认 fidelity 模板；7 个 canvas，含 `content_base`。
- `Test-023ffae3`：用户测试模板；5 个 canvas，含 `content_base`。
- 两套 `content_base` 的 replace layer 当前均为空。
- 测试模板当前发布包未包含漏斗/流程/数据表/三卡对比专用模型，但源模板 P5-P8 与旧项目的 10-layout registry、27 个 approved components、逐 layout canvas self-review 证明这些模型曾完成视觉提取。它们是在后续“运行时简化”中被错误地从发布包删除，而不是缺少源证据。升级应恢复为可选模型，仍需生成新的人工审阅页复核；未选时不得进入 SVG task。

## 7. Task 与 Agent result 合同

### Task

- controller 原子写 JSON。
- task 明列 `reference_root`、合同、输入、输出、角色、禁止写路径、validator/render argv。
- SVG 必须一 batch 一 task，不得 per-page。
- revision 把人工 feedback 复制成 task snapshot，并记录其 SHA-256。

### Result

- Collector 当前硬性校验 task id、step、role、task hash、时间、非空 summary、非空 `input_hashes`、输出路径与 SHA-256。
- revision 还要求顶层 `feedback_sha256` 精确匹配 task。
- 当前缺陷：task 的 `output_template.agent_result.json` 没有 `input_hashes` 和 revision `feedback_sha256`；Worker必须猜测并手工补齐，造成重复返修。

## 8. 人工门禁与证据

三道审阅都必须通过 `ppt_parent.py start-review` 启动的健康 Server：

| 门禁 | 页面 | 写入 | 当前证据绑定 |
|---|---|---|---|
| Template | `00_template_review.html` | `template_feedback.json` | HTML hash + 模板源 PNG hashes；fidelity 另有 canvas visual gate |
| Layout | `01_layout_direction.html` | `layout_feedback.json` | HTML hash |
| Visual | `02_visual_review.html` | `feedback.json` | HTML hash + 当前每页 PNG hashes |

人工批准永远不能由 Worker/Parent自动写入。退回时使用原 Template/Layout/SVG Agent；只有恢复明确 `not_found` 后才能绑定替代 Agent。

## 9. 验证与导出门禁

- Contract：内容、layout、manifest 跨文件一致。
- Capacity：overfull 在进入 SVG 前回到 Layout。
- SVG validator：禁止特性、metadata、尺寸、文本、边距、重叠、模板 layout/canvas locked hash、required components。
- Batch visual self-review：必须有 Worker vision 或有来源的外部视觉反馈；must-fix 为空。
- Parent 合并：不新增设计判断，只合并 validation 和 self-review。
- Visual review：全 deck 一次审阅；拒绝页映射回受影响 batch。
- Export：只有 `derive()` 返回 EXPORT，Parent 才设置 `SMART_SVG_EXPORT_APPROVED_BY_PARENT=1` 调 converter。

## 10. 性能模型

正常耗时来源按预期应为：模板宿主渲染 > Template视觉对照 > 多 batch SVG/渲染 > 人工等待 > PPTX 导出。当前额外浪费来自：

- result 元数据依赖 Worker手工生成，Collector 反复拒绝；
- 同一合同在 SKILL/workflow/contract/script/test 多处复制，修一处后继续触发旧逻辑；
- review HTML 中旧 UI 与多份 JS 覆盖共存；
- 预览与绝对路径随项目复制，产生陈旧证据和打不开图片；
- warning 没有稳定地映射为 blocker/non-blocker + 视觉结论，容易触发碎片化微调；
- Parent、Worker、宿主渲染、Server 启停的责任边界虽存在，但错误恢复依赖文字提示而非统一可执行协议。

## 11. 当前架构矛盾清单

| ID | 现状冲突 | 直接后果 |
|---|---|---|
| A-01 | SVG contract 最小上下文 vs workflow 完整 profile binding | Worker读不到 workflow 声称必读的数据；容易自行扩张输入或误判 |
| A-02 | `content_base`/wireframe 新模型 vs template profile 旧 binding 施工模型 | 模板可能重新控制内容结构，破坏 Layout 权威 |
| A-03 | 简化人工反馈需求 vs SKILL/workflow/HTML/Server/smoke 的四维残留 | UI 压力、提交被误认为阻断、补丁覆盖 |
| A-04 | Agent result contract vs task output template | hash/时间/feedback 元数据反复返工 |
| A-05 | 发布模板包 vs preview manifest 绝对项目路径 | 模板库不可移植、图片加载失败 |
| A-06 | smoke 全绿 vs stale behavior 被测试固化 | 测试保护历史债务，而非目标合同 |
| A-07 | 源文件与 `.pyc` 混装 | 审计噪音、发布包不干净 |
| A-08 | 可选专用模型原则 vs 测试模板实际只有核心五页 | 机制是否存在、模板是否有证据被混为一谈 |

## 12. 架构维护规则

- 本文件未来应成为 `SKILL.md` 的维护者入口，但不能成为 Worker运行时输入。
- 任何变更必须先更新“单一事实源与所有者”表，再同步其直接上下游、测试和默认模板。
- 替代旧机制时必须列出 retire/delete 清单；不得保留 legacy fallback、第二 registry、第二 layout 分类或备份目录。
- 模板库中的运行时包不得保存项目绝对路径、原始模板或未批准 canvas。
- Domain 三文件 `layout_taxonomy.md`、`style_system.md`、`svg_rules.md` 继续作为受保护设计权威；流程重构不顺手重写设计原则。
