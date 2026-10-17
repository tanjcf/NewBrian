# Planner's PPT Hell v2 Upgrade Plan

## 目标

把现有 Skill 从“强 prompt 管控的长流程”升级为“脚本编排 parent Agent + contract 驱动子 Agent”的 PPT 生产系统。

核心目标不是在旧 `SKILL.md` 上继续加规则，而是重构控制权：

- 脚本是流程权威。
- Parent Agent 是项目经理，只管理状态、任务分发、gate、审阅和导出。
- 子 Agent 是工位，只拿当前任务需要的 contract、输入文件和 reference。
- 人工确认仍然是高价值 gate，但只保留在真正改变下游方向的位置。

## 原版保存

原版已保存到：

```text
backups/planners-ppt-hell-original-2026-07-09/
```

后续重构不得直接修改该备份目录。若 v2 失败，可从该目录恢复旧 Skill。

## 设计判断

### 旧版问题

旧版的强流程是正确方向，但实现方式过重：

- `SKILL.md` 承担了太多细节，导致每次触发都加载大量上下文。
- 同一批规则在主体、reference、脚本注释中重复，维护成本高。
- Agent 需要靠长文本纪律抵抗抢跑，实际控制权仍偏软。
- SVG 生成和修复依赖单 Agent 的长上下文，容易疲劳和局部打磨过度。
- 模板能力只是辅助脚本，没有成为正式 workflow branch。
- 运行结束后的经验没有结构化沉淀和用户确认机制。

### v2 原则

- `SKILL.md` 缩短为 router、权限边界和 next-action 协议。
- 每个阶段只读当前 reference。
- 每个子 Agent 任务都由 `agent_task.json` 描述，由 `agent_result.json` 交回。
- 所有阶段交接靠 contract，不靠对话记忆。
- 能脚本判断的，不写成 prompt 纪律。
- 能并行的，在第一个人工确认后并行。
- 高风险 gate 不下放给子 Agent。
- 运行后总结只生成候选默认设置，必须用户确认后才写回。

## 执行约束

给执行升级的 agent：

- 先读本文件，再读现有 `planners-ppt-hell/SKILL.md` 和被改脚本。
- 不要修改 `backups/planners-ppt-hell-original-2026-07-09/`。
- 不要删除旧 reference 或旧脚本，直到 Milestone 7 cleanup。
- 每个 milestone 完成后必须运行对应验收命令，并在 `planning/upgrade-implementation-log.md` 记录修改文件、运行命令、验收结果和延后风险。
- 不允许用“计划已完成”“结构已搭好”替代文件级验收。
- 不允许把 parent orchestrator 做成新的长 prompt；它必须以文件、JSON、gate 和脚本状态为中心。
- 不允许让子 Agent 写入可信控制文件。

### 不可由子 Agent 写入的文件

这些文件仍然只能由 parent/controller/review server/gate 脚本写入：

```text
_internal/00_project/flow_state.json
_internal/00_project/flow_events.jsonl
_internal/00_project/page_manifest.json 中的流程状态字段
_internal/01_layout_plan/layout_feedback.json
_internal/05_review/feedback.json
_internal/05_review/batches/*.json
```

### 子 Agent 可写入范围

子 Agent 只能写自己任务 contract 指定的 candidate/output 文件：

```text
_internal/01_content/page_content.json
_internal/01_layout_plan/layout_plan.json
_internal/02_svg_source/page_XX.svg
_internal/04_validation/integrated_review.json
_internal/04_validation/self_review.json
_internal/05_review/revision_notes.json
_internal/07_retrospective/*.json
_internal/07_retrospective/*.md
```

如果某步需要更新 manifest、flow state、batch status、export permission，必须交给 parent/controller 脚本。

## 验收总则

每个 milestone 都要同时满足三类验收：

- 文件验收：计划中列出的文件存在，且内容不是空壳。
- 脚本验收：至少有一个命令能证明新结构可运行或可校验。
- 行为验收：能证明新结构改变了旧行为，例如上下文路由变短、task/result 文件存在、gate 阻止越权推进。

最终交付前必须满足：

```text
□ 原版备份存在且未改动
□ 新 SKILL.md frontmatter 有效
□ parent status/next 可输出机器可读 JSON
□ template intake 可在无 PPTX 时跳过，在有 PPTX 时输出 template_profile.json
□ content/layout 至少能用 minimal deck 跑到 layout review
□ layout approval 前不会生成正式 SVG
□ layout approval 后当前 batch 可拆分成 page-level SVG tasks
□ future batch 正式产物仍被 gate 阻止
□ repair loop 有 attempt 上限
□ visual review 仍依赖 review server provenance
□ export 仍只能通过 pptflow.py export
□ retrospective 只生成候选，不自动写回默认设置
□ 五种失败模式扫描已更新
```

## 新工作流

### Step 0: Project Init

- 管控级别：L6
- 负责人：parent + script
- 输入：
  - source Markdown
  - 可选 PPTX 模板
  - 可选项目名称、输出目录、batch size
- 输出：
  - `_internal/00_project/project_config.json`
  - `_internal/00_project/flow_state.json`
  - `_internal/00_project/flow_events.jsonl`
  - `_internal/00_project/source_inventory.json`
- 脚本：
  - 保留并扩展 `scripts/init_svg_project.py`
  - 新增或扩展 `scripts/orchestrate/ppt_parent.py`
- 完成标准：
  - 项目结构存在
  - source 文件已登记
  - parent 可通过 `status` 和 `next` 得到机器可读下一步

### Step 1: Template Intake

- 管控级别：L3 + L5
- 负责人：template worker + script
- 触发条件：用户提供 PPTX
- 输入：
  - PPTX 文件
  - `references/contracts/template_profile_contract.md`
- 输出：
  - `_internal/00_project/template_profile.json`
  - `_internal/00_project/template_assets/`
  - 可选 `00_template_profile.html`
- 脚本：
  - 从 `scripts/template_analyzer.py` 升级为 `scripts/template/analyze_pptx_template.py`
  - 新增 `scripts/validate/validate_template_profile.py`
- 提取范围：
  - slide size
  - theme colors
  - theme fonts
  - master/layout placeholders
  - repeated page chrome
  - visible color tendencies from rendered slide thumbnails if available
- 边界：
  - 第一版只支持 PPTX。
  - 只提取风格倾向参考，不强复刻。
  - 不直接改写全局 `03_style_system.md`。
- 人工介入：
  - 如果模板 profile 置信度低，parent 展示 3-5 行摘要让用户确认。
- 完成标准：
  - `template_profile.json` 通过验证
  - profile 标明哪些字段是确定解析，哪些是推断

### Step 2: Content Worker

- 管控级别：L4 + L5
- 负责人：content child Agent
- 输入：
  - source Markdown
  - `references/contracts/page_content_contract.md`
  - `agent_task.json`
- 输出：
  - `_internal/01_content/page_content.json`
  - content worker `agent_result.json`
  - `_internal/00_project/page_manifest.json` 草案
- 脚本：
  - `scripts/validate_project_contracts.py --stage content`
  - `scripts/orchestrate/make_agent_task.py`
  - `scripts/orchestrate/collect_agent_results.py`
- 子 Agent 视野：
  - 不读取 layout taxonomy
  - 不读取 SVG rules
  - 不读取 export 规则
- 完成标准：
  - 页面顺序完整
  - 原文意义保全
  - 所有页面有 `page_key`、`action_title`、`core_message`、`body_blocks`
  - contract validation 通过

### Step 3: Layout Worker

- 管控级别：L4 + L5 + 人工 checkpoint
- 负责人：layout child Agent + parent
- 输入：
  - `page_content.json`
  - `template_profile.json` 摘要
  - `references/domain/layout_taxonomy.md`
  - `references/contracts/layout_plan_contract.md`
- 输出：
  - `_internal/01_layout_plan/layout_plan.json`
  - `_internal/01_layout_plan/layout_capacity_report.json`
  - `01_layout_direction.html`
- 脚本：
  - `scripts/estimate_layout_capacity.py`
  - `scripts/generate_layout_html.py`
  - `scripts/pipeline_gate.py layout-ready`
- 子 Agent 视野：
  - 不读取 SVG rules
  - 不生成 SVG
  - 不决定最终视觉细节
- 人工介入：
  - 这是第一个强确认点。
  - 用户必须通过 review server 确认版式方向。
- 完成标准：
  - layout plan 通过 contract validation
  - capacity 报告无未处理 overfull
  - review server 记录可信审批

### Step 4: Parallel Draft Workers

- 管控级别：L4 + L5
- 负责人：多个 SVG child Agents + parent
- 触发条件：
  - layout 已被用户确认
- 输入：
  - 当前 batch 的 page content
  - 当前 batch 的 layout plan
  - `template_profile.json` 摘要
  - `references/domain/style_system.md`
  - `references/domain/svg_rules.md`
  - `references/contracts/worker_svg_contract.md`
- 输出：
  - `_internal/02_svg_source/page_XX.svg`
  - 每页 worker result
- 并行策略：
  - 第一个人工确认前不并行生成正式 SVG。
  - 第一个确认后，当前 batch 内页面可并行生成。
  - 后续 batch 可并行做轻量准备分析，但不能生成正式 SVG/PNG/validation/self-review。
- 完成标准：
  - 当前 batch 所有 SVG 存在
  - 每个 SVG worker result 声明使用的输入 hash
  - parent 跑 `batch-svg-ready`

### Step 5: Render, Validate, Integrated Review

- 管控级别：L3 + L5
- 负责人：parent + review worker
- 输入：
  - 当前 batch SVG
  - manifest
  - validator report
  - PNG preview
- 输出：
  - `_internal/03_png_preview/page_XX.png`
  - `_internal/04_validation/validation_summary.json`
  - `_internal/04_validation/integrated_review.json`
  - `_internal/04_validation/self_review.json`
- 脚本：
  - `scripts/render_svg_png.py`
  - `scripts/validate_svg_layout.py`
  - `scripts/validate_self_review.py`
- 完成标准：
  - review worker 必须看 PNG
  - blocker-class issue 不进入用户审阅
  - non-blocking warning 必须被接受或转为修复建议

### Step 6: Draft Repair Loop

- 管控级别：L6 + L4 + L5
- 负责人：parent + revision workers
- 输入：
  - `integrated_review.json`
  - `validation_summary.json`
  - PNG preview
  - 当前 batch SVG
- 输出：
  - 修订后的 SVG
  - `_internal/05_review/revision_notes.json`
  - archived old versions
- Loop 规则：
  - 最多 2 轮自动修复。
  - error 和 blocker warning 必修。
  - 同类问题连续两轮失败，停止自动修复。
  - 若需要删文案、改版式、拆页，必须回 Layout checkpoint。
- 完成标准：
  - `preview-ready` gate 通过
  - 或 parent 明确要求回 PLAN / 用户确认

### Step 7: Visual Review

- 管控级别：L3 + 人工 checkpoint
- 负责人：parent + review server
- 输入：
  - 当前 batch PNG
  - self review
  - revision notes
- 输出：
  - `02_visual_review.html`
  - `_internal/05_review/feedback.json`
  - `_internal/05_review/batches/<batch_id>.json`
- 脚本：
  - `scripts/generate_review_html.py`
  - `scripts/review_server.py`
  - `scripts/pipeline_gate.py visual-approved --batch <batch_id>`
- 人工介入：
  - 用户通过 review server 审批。
  - parent 可以转告 URL 和一次性口令。
  - parent/child Agent 不得代用户提交。
- 完成标准：
  - 当前 batch manifest 更新为 visual approved
  - 当前 batch export allowed

### Step 8: Later Batch Learning

- 管控级别：L4 + L5
- 负责人：parent + later draft workers
- 输入：
  - 前一批 visual feedback
  - revision notes
  - accepted risks
  - current style/template profile
- 输出：
  - `_internal/00_project/batch_learning_notes.json`
  - 下一批 SVG task constraints
- 规则：
  - 第二批开始吸收第一轮教训。
  - 可并行生成当前开放 batch。
  - 仍不得提前生成未来 batch 的正式产物。
- 完成标准：
  - 下一批任务里明确带上前批经验
  - 经验是约束，不是任意重写整体风格

### Step 9: Export

- 管控级别：L6
- 负责人：parent + controller script
- 输入：
  - 全部 approved SVG/PNG
  - manifest
  - validation summaries
  - review provenance
- 输出：
  - `final_deck.pptx`
  - `_internal/06_ppt_output/conversion_report.json`
- 脚本：
  - `scripts/pptflow.py export`
  - 底层仍可调用 `native_svg_to_ppt.py`，但不能由 Agent 直接调用
- 完成标准：
  - `export-ready` gate 通过
  - final PPTX 存在

### Step 10: Retrospective and Defaults Audit

- 管控级别：L3 + 人工确认
- 负责人：retrospective worker + parent
- 输入：
  - flow events
  - layout feedback
  - visual feedback
  - validation warnings
  - repair loop history
  - template profile
- 输出：
  - `_internal/07_retrospective/run_summary.json`
  - `_internal/07_retrospective/default_suggestions.md`
  - `_internal/07_retrospective/memory_candidates.json`
- 脚本：
  - 新增 `scripts/retrospective/analyze_run.py`
- 分析内容：
  - 用户常批准/拒绝的版式方向
  - 常见 SVG warning
  - 常见修复成本
  - 模板偏好
  - batch size 是否合适
  - 哪些规则应升级，哪些旧规则应移除
- 人工介入：
  - 必须用户确认后，才允许写回默认设置、project memory 或 Skill 本体。
- 完成标准：
  - 输出候选，不自动污染 Skill 默认行为

## 新增文件计划

### references/workflow/

```text
00_parent_orchestrator.md
01_template_intake.md
02_content_worker.md
03_layout_worker.md
04_svg_worker.md
05_integrated_review_worker.md
06_repair_loop.md
07_visual_review.md
08_retrospective.md
```

### references/contracts/

```text
agent_task_contract.md
agent_result_contract.md
template_profile_contract.md
worker_svg_contract.md
repair_loop_contract.md
batch_learning_contract.md
retrospective_contract.md
```

### references/domain/

把现有长 reference 迁入 domain，并保留兼容路径或在 `SKILL.md` 中更新路由：

```text
style_system.md
svg_rules.md
layout_taxonomy.md
quality_checklist.md
```

### scripts/orchestrate/

```text
ppt_parent.py
make_agent_task.py
collect_agent_results.py
validate_agent_result.py
```

### scripts/template/

```text
analyze_pptx_template.py
```

### scripts/retrospective/

```text
analyze_run.py
```

## 需要重写的文件

### `SKILL.md`

重写为短版：

- Skill 目的
- 权限边界
- parent-first 工作方式
- `ppt_parent.py status/next` 是唯一入口
- 当前 step reference 路由
- 子 Agent 不得碰的文件
- 人工审批规则
- 运行后 retrospective 规则

旧版详细纪律不再堆在主体里。

### `pptflow.py` / `pipeline_gate.py`

保留核心 gate，但补强：

- 输出 JSON next action
- 识别 agent task/result
- 增加 template profile 状态
- 增加 repair loop attempt 计数
- 增加 retrospective-ready 状态

### `template_analyzer.py`

升级为正式 template intake：

- 支持 PPTX
- 输出固定 contract
- 区分确定字段和推断字段
- 支持供 SVG worker 读取的 compact summary

## 文件迁移策略

第一阶段不删除旧 reference，先做兼容：

- 新增 `references/workflow/`、`references/contracts/`、`references/domain/`
- 旧 contract 文件先保留
- 新 `SKILL.md` 指向新路径
- 脚本暂时兼容旧路径

第二阶段做 sediment cleanup：

- 删除无路由旧 reference
- 合并重复 contract
- 删除不再调用的辅助脚本
- 更新 README

## 实施里程碑

### Milestone 1: v2 skeleton

- 保存原版
- 写新 `SKILL.md` 短版
- 新增 workflow references
- 新增 agent task/result contracts
- 新增 parent orchestrator skeleton
- 验证：`ppt_parent.py status/next` 可运行

### Milestone 2: content/layout workerization

- Content step 改为 agent task/result
- Layout step 改为 agent task/result
- 保留 layout human checkpoint
- 验证：minimal deck 能跑到 layout review

### Milestone 3: PPTX template intake

- 升级 PPTX template analyzer
- 新增 template profile contract
- Layout/SVG worker 可读取 compact template profile
- 验证：带 PPTX 模板的 minimal deck 生成 template profile

### Milestone 4: parallel draft + repair loop

- 当前 batch 单页任务拆分
- parent 收集 SVG worker result
- 增加 repair loop attempt
- 验证：同 batch 多页可独立生成并统一 validate

### Milestone 5: visual review + later batch learning

- 保持 review server 审批
- 前批反馈生成 batch learning notes
- 后续 batch task 自动携带 learning notes
- 验证：第一批反馈能进入第二批任务约束

### Milestone 6: retrospective

- 新增 run summary 和 default suggestions
- 用户确认后才写回
- 验证：导出后生成可审阅总结，不自动修改默认设置

### Milestone 7: cleanup

- 五种失败模式扫描
- 删除沉积文件
- 更新 README
- 跑 eval prompts

## Milestone 验收清单

### Milestone 1 Done Definition: v2 skeleton

必须新增或更新：

```text
planners-ppt-hell/SKILL.md
planners-ppt-hell/references/workflow/00_parent_orchestrator.md
planners-ppt-hell/references/contracts/agent_task_contract.md
planners-ppt-hell/references/contracts/agent_result_contract.md
planners-ppt-hell/scripts/orchestrate/ppt_parent.py
planners-ppt-hell/scripts/orchestrate/make_agent_task.py
planners-ppt-hell/scripts/orchestrate/collect_agent_results.py
planners-ppt-hell/scripts/orchestrate/validate_agent_result.py
```

验收命令：

```bash
python scripts/orchestrate/ppt_parent.py --help
python scripts/orchestrate/ppt_parent.py examples/minimal_deck_work status --json
python scripts/orchestrate/ppt_parent.py examples/minimal_deck_work next --json
```

可接受的第一版行为：

- 如果项目目录不存在，`status --json` 可以明确返回 `project_missing`，但不能 traceback。
- `next --json` 必须包含 `state`、`next_action`、`required_inputs`、`allowed_writers`、`forbidden_writes`。
- `SKILL.md` 主体必须比旧版明显短，只做 router，不复制完整旧流程纪律。

### Milestone 2 Done Definition: content/layout workerization

必须新增或更新：

```text
planners-ppt-hell/references/workflow/02_content_worker.md
planners-ppt-hell/references/workflow/03_layout_worker.md
planners-ppt-hell/references/contracts/page_content_contract.md 或兼容旧路径
planners-ppt-hell/references/contracts/layout_plan_contract.md 或兼容旧路径
```

验收命令：

```bash
python scripts/init_svg_project.py examples/minimal_deck_work examples/minimal_deck/source.md
python scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step content --output examples/minimal_deck_work/_internal/00_project/tasks/content_task.json
python scripts/orchestrate/validate_agent_result.py examples/minimal_deck_work/_internal/00_project/tasks/content_task.json --schema agent_task
python scripts/validate_project_contracts.py examples/minimal_deck_work --stage content
python scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step layout --output examples/minimal_deck_work/_internal/00_project/tasks/layout_task.json
python scripts/estimate_layout_capacity.py examples/minimal_deck_work
python scripts/generate_layout_html.py examples/minimal_deck_work
python scripts/pipeline_gate.py examples/minimal_deck_work layout-ready
```

行为验收：

- `content_task.json` 不包含 SVG、style、export 指令。
- `layout_task.json` 不包含 SVG 生成指令。
- `01_layout_direction.html` 存在。
- layout approval 前 `_internal/02_svg_source/` 不应出现正式 page SVG。

### Milestone 3 Done Definition: PPTX template intake

必须新增或更新：

```text
planners-ppt-hell/references/workflow/01_template_intake.md
planners-ppt-hell/references/contracts/template_profile_contract.md
planners-ppt-hell/scripts/template/analyze_pptx_template.py
planners-ppt-hell/scripts/validate/validate_template_profile.py
```

验收命令：

```bash
python scripts/template/analyze_pptx_template.py --help
python scripts/validate/validate_template_profile.py --help
```

如果仓库里没有可用 PPTX 测试文件，执行 agent 必须创建一个极小测试 PPTX 或在实现日志中说明暂缓原因。可用 PPTX 时验收：

```bash
python scripts/template/analyze_pptx_template.py path/to/template.pptx --project examples/minimal_deck_work
python scripts/validate/validate_template_profile.py examples/minimal_deck_work/_internal/00_project/template_profile.json
```

行为验收：

- `template_profile.json` 必须包含 `source_file`、`slide_size`、`colors`、`fonts`、`layouts`、`style_tendencies`、`confidence`、`usage_policy`。
- `usage_policy.mode` 必须是 `reference_only`。
- 不得修改全局 `style_system.md`。
- 无 PPTX 时 parent 必须跳过本 step，而不是报错。

### Milestone 4 Done Definition: parallel draft + repair loop

必须新增或更新：

```text
planners-ppt-hell/references/workflow/04_svg_worker.md
planners-ppt-hell/references/workflow/05_integrated_review_worker.md
planners-ppt-hell/references/workflow/06_repair_loop.md
planners-ppt-hell/references/contracts/worker_svg_contract.md
planners-ppt-hell/references/contracts/repair_loop_contract.md
```

验收命令：

```bash
python scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step svg --batch batch_01 --split-pages --output-dir examples/minimal_deck_work/_internal/00_project/tasks
python scripts/orchestrate/collect_agent_results.py examples/minimal_deck_work --step svg --batch batch_01
python scripts/pipeline_gate.py examples/minimal_deck_work batch-svg-ready --batch batch_01
python scripts/render_svg_png.py examples/minimal_deck_work/_internal/02_svg_source --manifest examples/minimal_deck_work/_internal/00_project/page_manifest.json --batch batch_01
python scripts/validate_svg_layout.py examples/minimal_deck_work/_internal/02_svg_source --manifest examples/minimal_deck_work/_internal/00_project/page_manifest.json --batch batch_01 --output examples/minimal_deck_work/_internal/04_validation/validation_summary.json
python scripts/pipeline_gate.py examples/minimal_deck_work preview-ready --batch batch_01
```

行为验收：

- 每页任务只包含该页 content/layout，不包含全 deck 正文。
- `collect_agent_results.py` 必须拒绝缺少 input hash 或 output file 的 result。
- 如果 future batch 出现 SVG/PNG/validation/self-review，gate 必须失败。
- repair loop attempt 记录必须保存在结构化文件中，且最多 2 轮。
- 连续失败必须输出 `return_to_plan` 或 `human_confirmation_required`。

### Milestone 5 Done Definition: visual review + later batch learning

必须新增或更新：

```text
planners-ppt-hell/references/workflow/07_visual_review.md
planners-ppt-hell/references/contracts/batch_learning_contract.md
```

验收命令：

```bash
python scripts/generate_review_html.py examples/minimal_deck_work --batch batch_01
python scripts/pipeline_gate.py examples/minimal_deck_work visual-approved --batch batch_01
python scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step svg --batch batch_02 --split-pages --output-dir examples/minimal_deck_work/_internal/00_project/tasks
```

行为验收：

- 如果没有 review server provenance，`visual-approved` 必须失败。
- 如果 batch_01 有可信反馈，batch_02 task 必须包含 `batch_learning_notes` 或明确说明无可继承经验。
- batch learning 只能作为约束，不得改写已批准的 layout plan。

### Milestone 6 Done Definition: retrospective

必须新增或更新：

```text
planners-ppt-hell/references/workflow/08_retrospective.md
planners-ppt-hell/references/contracts/retrospective_contract.md
planners-ppt-hell/scripts/retrospective/analyze_run.py
```

验收命令：

```bash
python scripts/retrospective/analyze_run.py --help
python scripts/retrospective/analyze_run.py examples/minimal_deck_work
```

行为验收：

- 输出 `_internal/07_retrospective/run_summary.json`。
- 输出 `_internal/07_retrospective/default_suggestions.md`。
- 输出 `_internal/07_retrospective/memory_candidates.json`。
- `memory_candidates.json` 必须包含 `requires_user_confirmation: true`。
- 脚本不得自动修改 `SKILL.md`、references 或用户 memory。

### Milestone 7 Done Definition: cleanup

必须新增或更新：

```text
planning/upgrade-implementation-log.md
planning/failure-mode-scan-v2.md
README.md
```

验收命令：

```bash
python scripts/orchestrate/ppt_parent.py --help
python scripts/validate/validate_template_profile.py --help
python scripts/retrospective/analyze_run.py --help
git status --short
```

行为验收：

- 所有 active workflow reference 都能从 `SKILL.md` 或 parent router 被路由到。
- 无路由旧文件必须列入 cleanup 表：`keep`、`remove`、`compatibility_hold` 三选一。
- README 说明 v2 parent/worker 架构。
- `failure-mode-scan-v2.md` 必须逐项说明五种失败模式如何被修复或仍有哪些残余风险。

## 验证计划

### Eval 1: 无模板基础流程

Prompt:

```text
Use planners-ppt-hell to turn examples/minimal_deck/source.md into an editable PPT.
```

期望：

- parent 先 init
- content/layout 分工
- layout review 前不生成 SVG
- layout approval 后才进入 draft

### Eval 2: PPTX 模板参考

Prompt:

```text
Use planners-ppt-hell with this PPTX as style reference, but do not copy it exactly.
```

期望：

- 触发 template intake
- 输出 template profile
- layout/SVG 使用风格倾向
- 用户可确认模板偏好

### Eval 3: 当前 batch 并行 SVG

Prompt:

```text
After layout approval, generate the first batch as fast as possible.
```

期望：

- 当前 batch 页面可拆分 worker
- 不生成未来 batch 正式产物
- parent 统一 render/validate

### Eval 4: SVG overrun repair loop

Prompt:

```text
Fix the pages with validator warnings before visual review.
```

期望：

- 自动修复最多 2 轮
- blocker 必修
- 连续失败回 PLAN 或用户确认

### Eval 5: Retrospective defaults

Prompt:

```text
After export, summarize what should become defaults next time.
```

期望：

- 输出候选设置
- 不自动写回 Skill
- 请求用户确认

## 五种失败模式扫描

### Premature Completion

风险：子 Agent 可能声称完成但缺文件。

修复：

- 每个 worker 必须输出 `agent_result.json`
- parent 只认脚本 validation
- 子 Agent 不得推进 flow state

### Duplication

风险：旧 contract 和新 contract 并存造成冲突。

修复：

- 第一阶段兼容，第二阶段清理
- 每个字段只保留一个权威 contract
- `SKILL.md` 不重复 schema 细节

### Sediment

风险：旧强流程规则沉积在活跃路径里。

修复：

- 新增 active route 表
- 未被路由引用的 reference 标为 cleanup candidate
- retrospective 包含删除候选

### Sprawl

风险：v2 新增文件太多，变成另一种蔓延。

修复：

- `SKILL.md` 只保留总控
- workflow reference 按阶段读
- domain reference 按 worker 读
- eval 后删除无用分支

### No-op

风险：继续写“认真”“不要偷懒”式规则。

修复：

- 弱指令必须转为 contract 字段、脚本检查或 gate
- 删除无法改变行为的描述
- 用户确认点必须保存到结构化文件

## 默认决策

这些问题不再阻塞执行，除非用户明确推翻：

1. 允许彻底重写 `SKILL.md`，只保留来源识别、权限边界、parent router、reference 路由和运行后 retrospective 规则。
2. 旧 reference 第一阶段保持路径兼容，不急着迁移；Milestone 7 再做 active route cleanup。
3. Parent orchestrator 第一版先做 task 文件生成、状态检查、gate 指引和 result 收集；不强求真正自动调用外部子 Agent。
4. PPTX 模板第一版只解析主题、字体、尺寸、母版和占位符；缩略图视觉推断作为可选增强，不阻塞 Milestone 3。
5. Retrospective 第一版用 Markdown/JSON 候选 + 聊天确认；HTML review artifact 作为后续增强。

## 交接给执行 Agent 的责任边界

执行 agent 对实现负责，但必须按本计划接受验收。若发现本计划与现有代码冲突，执行 agent 不能静默改方向，必须：

1. 在 `planning/upgrade-implementation-log.md` 记录冲突。
2. 说明冲突属于 workflow、contract、script、reference、review gate 还是 export。
3. 给出最小修正方案。
4. 保持原版备份不动。
5. 不降低人工审批、export gate 和不可写文件边界。

我对整体升级方案负责的验收口径是：

- 不是看新增文件数量，而是看 parent/worker/control boundary 是否真正生效。
- 不是看 prompt 是否更长，而是看 active context 是否减少。
- 不是看能否一口气生成更多页，而是看第一个人工确认后当前开放工作能否并行。
- 不是看模板是否被复刻，而是看模板倾向能否以 contract 进入 layout/SVG worker。
- 不是看 retrospective 是否写得漂亮，而是看默认设置候选是否可确认、可拒绝、可追溯。
