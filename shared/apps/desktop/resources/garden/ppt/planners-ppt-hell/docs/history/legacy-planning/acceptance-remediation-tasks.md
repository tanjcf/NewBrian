# Planner's PPT Hell v2 Acceptance Remediation Tasks

## 背景

本文件基于 2026-07-09 的一轮实际验收结果生成，用于交给执行 agent 做下一轮修复。

当前结论：

- v2 架构骨架已存在。
- parent/status/task/template/retrospective 的基础脚本可运行。
- 但不能判定“全部通过”，因为仍有路由缺失、per-page task 上下文未真正裁剪、layout review preflight 缺失等问题。

执行 agent 必须先读：

```text
planning/upgrade-plan-v2.md
planning/upgrade-implementation-log.md
planning/failure-mode-scan-v2.md
planning/acceptance-remediation-tasks.md
```

不要修改：

```text
backups/planners-ppt-hell-original-2026-07-09/
```

## 总体验收目标

修复后必须达到：

```text
□ SKILL.md、ppt_parent.py、make_agent_task.py 的 reference 路由一致，且所有路由目标真实存在
□ page_content_contract / layout_plan_contract 有 v2 路由兼容层
□ references/domain/ 下的 style/svg/layout 文件真实存在，或所有 v2 路由统一回旧路径
□ per-page SVG task 不再要求子 Agent 读取整份 deck JSON
□ parent 能执行 layout review preflight，明确区分 HTML 缺失、server 未启动、server 不健康
□ generate_layout_html.py 失败时有结构化错误文件可读
□ review_server.py 启动后写出 server metadata，parent 可探活
□ 验收命令全部通过，并更新 implementation log
```

## Task 1: 修复 v2 reference 路由缺失

### 问题

验收发现这些路由目标不存在：

```text
planners-ppt-hell/references/domain/layout_taxonomy.md
planners-ppt-hell/references/domain/style_system.md
planners-ppt-hell/references/domain/svg_rules.md
planners-ppt-hell/references/contracts/page_content_contract.md
planners-ppt-hell/references/contracts/layout_plan_contract.md
```

但 `SKILL.md` 和 `ppt_parent.py` 指向了这些路径。

实际旧文件存在于：

```text
planners-ppt-hell/references/05_layout_taxonomy.md
planners-ppt-hell/references/03_style_system.md
planners-ppt-hell/references/04_svg_rules.md
planners-ppt-hell/references/page_content_contract.md
planners-ppt-hell/references/layout_plan_contract.md
```

### 修复目标

选择方案 A，除非有明确理由改为方案 B。

方案 A：创建兼容层文件。

```text
references/domain/layout_taxonomy.md
references/domain/style_system.md
references/domain/svg_rules.md
references/contracts/page_content_contract.md
references/contracts/layout_plan_contract.md
```

兼容层可以先复制旧文件内容，不要只写“见旧文件”的空壳，因为子 Agent 需要直接读取完整内容。

方案 B：统一回旧路径。

如果选择方案 B，必须同步修改：

```text
SKILL.md
scripts/orchestrate/ppt_parent.py
scripts/orchestrate/make_agent_task.py
scripts/template/analyze_pptx_template.py 的 usage_policy.must_not_override
references/workflow/*.md 中所有 references/domain 路径
```

### 验收命令

```bash
test -f planners-ppt-hell/references/domain/layout_taxonomy.md
test -f planners-ppt-hell/references/domain/style_system.md
test -f planners-ppt-hell/references/domain/svg_rules.md
test -f planners-ppt-hell/references/contracts/page_content_contract.md
test -f planners-ppt-hell/references/contracts/layout_plan_contract.md
```

并运行：

```bash
rg -n "references/domain|references/contracts/page_content_contract|references/contracts/layout_plan_contract" planners-ppt-hell/SKILL.md planners-ppt-hell/scripts/orchestrate planners-ppt-hell/references/workflow
```

所有输出中的文件路径必须存在。

### 完成标准

- 不再出现 v2 路由指向不存在文件。
- `planning/upgrade-implementation-log.md` 记录采用方案 A 或 B。

## Task 2: 修复 per-page SVG task 上下文未裁剪

### 问题

当前命令：

```bash
python planners-ppt-hell/scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step svg --batch batch_01 --split-pages
```

能生成：

```text
svg_page_01_task.json
svg_page_02_task.json
svg_page_03_task.json
```

但每页 task 的 input_files 仍包含整份：

```text
_internal/01_content/page_content.json
_internal/01_layout_plan/layout_plan.json
```

这没有真正降低子 Agent 上下文负担。

### 修复目标

`--split-pages` 时必须为每页生成裁剪后的输入包：

```text
_internal/00_project/tasks/inputs/svg_page_01_content.json
_internal/00_project/tasks/inputs/svg_page_01_layout.json
_internal/00_project/tasks/inputs/svg_page_02_content.json
_internal/00_project/tasks/inputs/svg_page_02_layout.json
...
```

每个裁剪文件只包含当前页对象和必要 top-level metadata。

建议结构：

```json
{
  "project": "project name",
  "source": "_internal/01_content/page_content.json",
  "page_key": "page_01",
  "page": {}
}
```

layout 裁剪文件同理。

然后每个 `svg_page_XX_task.json` 的 `input_files` 改为：

```json
[
  "_internal/00_project/tasks/inputs/svg_page_01_content.json",
  "_internal/00_project/tasks/inputs/svg_page_01_layout.json",
  "references/domain/style_system.md",
  "references/domain/svg_rules.md"
]
```

### 验收命令

```bash
python planners-ppt-hell/scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step svg --batch batch_01 --split-pages
find examples/minimal_deck_work/_internal/00_project/tasks/inputs -maxdepth 1 -type f | sort
sed -n '1,160p' examples/minimal_deck_work/_internal/00_project/tasks/svg_page_01_task.json
```

### 行为验收

- `svg_page_01_task.json` 不再直接要求读取整份 `page_content.json` / `layout_plan.json`。
- 裁剪后的 content JSON 只包含 `page_01`。
- 裁剪后的 layout JSON 只包含 `page_01`。
- `validate_agent_result.py ... --schema agent_task` 仍通过。

## Task 3: 增加 layout review preflight

### 问题

WorkBuddy 中出现审阅页面打不开，已定位两个常见原因：

1. `generate_layout_html.py` 严格模式失败，导致 `01_layout_direction.html` 根本没生成。
2. `review_server.py` 进程已死，端口无监听。

当前 v2 parent 只提示“启动 review_server.py”，没有硬性检查 HTML 文件和 server 健康状态。

### 修复目标

在 `scripts/orchestrate/ppt_parent.py` 增加一个 layout review preflight 能力。

最低实现方式：

```bash
python scripts/orchestrate/ppt_parent.py <project_dir> preflight-layout-review --json
```

输出 JSON 必须包含：

```json
{
  "ok": false,
  "checks": {
    "layout_html_exists": false,
    "layout_html_path": "01_layout_direction.html",
    "layout_errors_path": "_internal/01_layout_plan/layout_html_errors.json",
    "review_server_metadata_exists": false,
    "review_server_health_ok": false
  },
  "next_action": "..."
}
```

如果不想新增 command，也可以让 `next --json` 在 `PLAN_REVIEW` 状态内带上 `preflight` 字段，但必须可被脚本验收。

### 验收命令

```bash
python planners-ppt-hell/scripts/orchestrate/ppt_parent.py examples/minimal_deck_work preflight-layout-review --json
```

### 完成标准

- HTML 缺失时，preflight 返回 `ok=false`，且 next_action 指向 `generate_layout_html.py`。
- HTML 存在但 server 未启动时，preflight 返回 `ok=false`，且 next_action 指向 `review_server.py`。
- server 启动且 `/health` 可访问时，preflight 返回 `ok=true`。

## Task 4: generate_layout_html.py 失败时写结构化错误

### 问题

当前 `generate_layout_html.py` 严格模式失败时只打印 stderr，不写结构化文件。Agent 或 parent 很难稳定读取缺失字段。

### 修复目标

当 `global_errors` 存在时，写入：

```text
_internal/01_layout_plan/layout_html_errors.json
```

建议结构：

```json
{
  "generated_at": "ISO timestamp",
  "strict_mode": true,
  "allow_degraded": false,
  "errors": [
    "page_01: 缺少文案处理方案（copy_handling）"
  ],
  "html_written": false,
  "next_action": "Fix layout_plan.json/page_content.json, then rerun generate_layout_html.py."
}
```

如果使用 `--allow-degraded` 且写出 HTML，也要写：

```json
{
  "allow_degraded": true,
  "html_written": true,
  "degraded": true
}
```

### 验收方式

构造一个临时项目，删除 `layout_plan.json` 中某页 `copy_handling` 或 `wireframe`，然后运行：

```bash
python planners-ppt-hell/scripts/generate_layout_html.py /tmp/bad-layout-project
test -f /tmp/bad-layout-project/_internal/01_layout_plan/layout_html_errors.json
```

再运行：

```bash
python planners-ppt-hell/scripts/generate_layout_html.py /tmp/bad-layout-project --allow-degraded
```

确认 `layout_html_errors.json` 标记 `allow_degraded=true`、`html_written=true`。

## Task 5: review_server.py 写 server metadata

### 问题

`review_server.py` 启动时只在 stdout 打印 URL 和口令，没有写结构化 metadata。WorkBuddy 里后台进程结束或崩溃后，parent 无法判断旧 URL 是否还有效。

### 修复目标

server 启动后写：

```text
_internal/00_project/review_server.json
```

建议结构：

```json
{
  "pid": 12345,
  "port": 8765,
  "session_id": "...",
  "layout_url": "http://127.0.0.1:8765/",
  "visual_review_url": "http://127.0.0.1:8765/review",
  "health_url": "http://127.0.0.1:8765/health",
  "approval_key_required": true,
  "started_at": "ISO timestamp",
  "project_dir": "..."
}
```

不要写明文 approval key 到 JSON。

### 验收命令

启动 server：

```bash
python planners-ppt-hell/scripts/review_server.py examples/minimal_deck_work
```

另一个 shell 验收：

```bash
test -f examples/minimal_deck_work/_internal/00_project/review_server.json
python -c "import json,urllib.request; d=json.load(open('examples/minimal_deck_work/_internal/00_project/review_server.json')); print(urllib.request.urlopen(d['health_url'], timeout=3).read().decode())"
```

完成后停止 server。

### 完成标准

- JSON 存在。
- `health_url` 可访问。
- JSON 不包含明文 approval key。

## Task 6: 修复 template_profile usage policy 路由

### 问题

`scripts/template/analyze_pptx_template.py` 输出的 `usage_policy.must_not_override` 当前包含：

```text
references/domain/style_system.md
references/domain/svg_rules.md
```

如果 Task 1 选择方案 A，这没问题；如果选择方案 B，就必须同步改。

### 验收命令

```bash
python planners-ppt-hell/scripts/template/analyze_pptx_template.py /tmp/planner-template-test.pptx --project /tmp/planner-template-project
python planners-ppt-hell/scripts/validate/validate_template_profile.py /tmp/planner-template-project/_internal/00_project/template_profile.json
```

检查 `must_not_override` 中的路径必须存在，或明确是 Skill 内的有效路由。

## Task 7: 更新 implementation log 和 failure scan

### 修复目标

修完以上任务后，更新：

```text
planning/upgrade-implementation-log.md
planning/failure-mode-scan-v2.md
```

必须记录：

- 本轮修复日期
- 每个 task 修改的文件
- 每个 task 运行的验收命令
- 通过 / 未通过 / 延后风险
- 是否还存在路由不一致
- 是否还存在 WorkBuddy 审阅页不可诊断风险

## 最终回归验收命令

从仓库根目录：

```bash
python planners-ppt-hell/scripts/orchestrate/ppt_parent.py examples/minimal_deck_work status --json
python planners-ppt-hell/scripts/orchestrate/ppt_parent.py examples/minimal_deck_work next --json
python planners-ppt-hell/scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step layout --output /tmp/planner-layout-task-check.json
python planners-ppt-hell/scripts/orchestrate/validate_agent_result.py /tmp/planner-layout-task-check.json --schema agent_task
python planners-ppt-hell/scripts/validate_project_contracts.py examples/minimal_deck_work --stage content
python planners-ppt-hell/scripts/pipeline_gate.py examples/minimal_deck_work layout-ready
python planners-ppt-hell/scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step svg --batch batch_01 --split-pages
python planners-ppt-hell/scripts/orchestrate/validate_agent_result.py examples/minimal_deck_work/_internal/00_project/tasks/svg_page_01_task.json --schema agent_task
python planners-ppt-hell/scripts/retrospective/analyze_run.py examples/minimal_deck_work --output /tmp/planner-retro-check
```

再检查路由：

```bash
for f in \
  planners-ppt-hell/references/domain/layout_taxonomy.md \
  planners-ppt-hell/references/domain/style_system.md \
  planners-ppt-hell/references/domain/svg_rules.md \
  planners-ppt-hell/references/contracts/page_content_contract.md \
  planners-ppt-hell/references/contracts/layout_plan_contract.md
do
  test -f "$f" || echo "MISSING $f"
done
```

如果输出任何 `MISSING`，验收不通过。

## 最终交付口径

修复完成后不要只说“已完成”。必须汇报：

- 修复了哪些阻断项
- 哪些验收命令通过
- 哪些命令仍失败及原因
- WorkBuddy 审阅页打不开的问题现在如何被 parent 诊断
- 是否仍存在需要下一轮处理的风险

