# Planner's PPT Hell v2 Architecture Simplification Workflow

## 目的

本文件用于指导另一个 agent 对 Planner's PPT Hell v2 做一轮“测试、简化、固定架构”的渐进式重构。

目标不是继续加功能，而是把当前已经能跑的 v2 系统整理成更简洁、优美、可长期维护的架构：

- 先用测试锁住关键行为。
- 再清理重复路径和沉积文件。
- 再统一 parent / worker / contract 的权责。
- 每一步结束后，执行 agent 必须确认流程、结构、文件是否仍然必要。
- 只有测试通过，才允许进入下一步。

## 当前判断

v2 当前方向正确，但存在三类结构问题：

1. **重复**：旧 `references/*.md` 与新 `references/domain/`、`references/contracts/` 有字节级复制。
2. **沉积**：旧脚本和旧 reference 被保留为 compatibility hold，但还没有明确删除时机。
3. **职责重叠**：`ppt_parent.py` 和 `make_agent_task.py` 都含有 task 生成逻辑，容易分叉。

本轮重构的原则：

```text
保留架构，不保留重复。
保留 gate，不保留口头纪律。
保留兼容证据，不保留永久兼容包袱。
每次删除前必须有测试覆盖。
```

## 不可破坏的行为

以下行为必须被测试保护：

```text
□ SKILL.md frontmatter 有效
□ ppt_parent.py status --json 可输出机器可读状态
□ ppt_parent.py next --json 可输出下一步、required_inputs、allowed_writers、forbidden_writes
□ preflight-layout-review --json 能区分 HTML 缺失、server 未启动、server 不健康、server 正常
□ generate_layout_html.py 严格失败时写 layout_html_errors.json
□ generate_layout_html.py --allow-degraded 写 degraded 状态
□ review_server.py 启动后写 review_server.json，且不写明文 approval key
□ make_agent_task.py --step svg --split-pages 生成单页裁剪输入
□ validate_agent_result.py 能验证 task schema
□ collect_agent_results.py 能拒绝缺 output / 缺 agent_result 的完成声明
□ pipeline_gate.py 仍阻止 future batch artifacts
□ retrospective 只生成候选，不自动写回
□ export 仍只能通过 pptflow.py export
```

## 总流程

执行 agent 必须按以下阶段推进。

每个阶段都包含：

1. Baseline test：证明当前行为。
2. Structure review：判断哪些文件/逻辑必要。
3. Change：只做本阶段允许的修改。
4. Regression test：跑回归测试。
5. Architecture note：记录保留、合并、删除理由。

## 权限与交接边界

本轮简化采用“两段式权限”：

```text
测试 Agent：负责测试、诊断、小范围一致性修复、提出删除/移动/合并建议。
架构 Owner（Codex/用户确认后的执行者）：负责最终删除、移动 legacy、合并脚本职责、固定发布结构。
```

测试 Agent **可以做**：

```text
□ 新增 smoke tests
□ 跑回归测试
□ 标记重复文件、沉积文件、无路由文件
□ 修正明显的路径不一致和文档错链
□ 生成 architecture-simplification-report.md
□ 提交 remove/move/merge candidates
□ 对每个文件写 keep / move / remove / legacy_hold 建议
```

测试 Agent **不可以直接做**：

```text
□ 删除旧 references
□ 删除旧 scripts
□ 删除 backups/
□ 删除 examples/minimal_deck_work/
□ 移动文件到 legacy/
□ 合并或删除 ppt_parent.py / make_agent_task.py 的核心逻辑
□ 改变 export gate
□ 改变 review_server approval 机制
□ 取消人工 checkpoint
□ 自动写回 retrospective 默认设置
```

如果测试 Agent 认为必须删除或移动某文件，只能写入候选清单：

```markdown
| file | suggested_action | reason | risk | required_tests_before_action |
```

然后停止并交接给架构 Owner 审核。

### 删除 / 移动 / 合并的最终授权

以下动作必须经过二次确认：

```text
□ 删除任何文件
□ 移动 active reference 到 legacy
□ 删除 compatibility_hold 文件
□ 合并 parent/task 生成逻辑
□ 改变 SKILL.md active route table
□ 改变最终发布包包含/排除规则
```

建议流程：

1. 测试 Agent 完成 Phase 0-2。
2. 测试 Agent 输出候选清单和测试结果。
3. Codex 做 architecture review。
4. 用户确认删除/移动/合并范围。
5. 再由 Codex 或明确授权的执行 Agent 做最终结构改动。

这条边界优先级高于后续 Phase 中所有“清理”“删除”“移动”的表述。

## Phase 0: 建立测试基线

### 目标

把当前可运行行为固定成一组 smoke tests。后续任何简化都必须先跑这些测试。

### 新增文件

建议新增：

```text
planners-ppt-hell/scripts/test/smoke_v2.py
```

也可以用 shell 脚本，但 Python 更容易跨平台。

### 测试内容

`smoke_v2.py` 至少测试：

```text
1. 路由文件存在
2. parent status/next/preflight JSON 输出字段完整
3. content/layout contract gate 通过
4. svg split-pages 生成 6 个裁剪输入 + 3 个 task
5. svg_page_01_task.json schema valid
6. layout_html_errors.json 严格/降级模式行为
7. review_server metadata 不含明文 key，并可通过 health URL 探活
8. retrospective 输出三件套，requires_user_confirmation=true
```

### 验收命令

```bash
python planners-ppt-hell/scripts/test/smoke_v2.py
```

### 完成标准

- smoke test 一条命令能跑。
- 测试失败时输出明确失败项。
- 不依赖外部网络。
- 临时文件写入 `/tmp` 或项目测试目录。
- 测试结束后不留下运行中的 review server。

### 阶段复盘问题

执行 agent 必须回答：

```text
□ 当前测试是否覆盖所有不可破坏行为？
□ 哪些测试只是验证文件存在，哪些测试验证真实行为？
□ 有没有测试本身依赖旧路径沉积？
```

## Phase 1: 固定单一路由权威

### 目标

消除“新路径 / 旧路径”混用，让系统有一个明确路由权威。

### 推荐决策

以 v2 新路径为权威：

```text
references/domain/layout_taxonomy.md
references/domain/style_system.md
references/domain/svg_rules.md
references/contracts/page_content_contract.md
references/contracts/layout_plan_contract.md
```

旧路径暂时不删，先移动到 legacy 或标记为 compatibility。

### 允许修改

```text
SKILL.md
scripts/orchestrate/ppt_parent.py
scripts/orchestrate/make_agent_task.py
scripts/template/analyze_pptx_template.py
references/workflow/*.md
README.md
planning/failure-mode-scan-v2.md
planning/upgrade-implementation-log.md
```

### 必须修正的已知混用

`make_agent_task.py` 中仍有旧路径：

```text
references/page_content_contract.md
references/layout_plan_contract.md
references/05_layout_taxonomy.md
references/03_style_system.md
references/04_svg_rules.md
```

workflow 文档中仍有错误路径：

```text
references/domain/05_layout_taxonomy.md
references/domain/04_svg_rules.md
references/domain/03_style_system.md
```

必须统一为：

```text
references/domain/layout_taxonomy.md
references/domain/svg_rules.md
references/domain/style_system.md
```

### 验收命令

```bash
python planners-ppt-hell/scripts/test/smoke_v2.py
rg -n "references/(03_style_system|04_svg_rules|05_layout_taxonomy|page_content_contract|layout_plan_contract)" planners-ppt-hell/SKILL.md planners-ppt-hell/scripts/orchestrate planners-ppt-hell/references/workflow planners-ppt-hell/references/contracts
rg -n "references/domain/(03_style_system|04_svg_rules|05_layout_taxonomy)" planners-ppt-hell
```

### 完成标准

- active route 中不再出现旧路径。
- active route 中不再出现 `references/domain/05_layout_taxonomy.md` 这类错误路径。
- smoke test 通过。

### 阶段复盘问题

```text
□ 现在是否只有一个 active route？
□ 旧路径是否只存在于 legacy/compatibility 文档中？
□ 子 Agent task 是否全部指向新路径？
```

## Phase 2: 合并 task 生成权力

### 目标

避免 `ppt_parent.py` 和 `make_agent_task.py` 同时维护 task schema。

### 推荐架构

```text
ppt_parent.py
  - derive/status/next/preflight
  - 调用或委托 make_agent_task.py
  - 不内置 task schema

make_agent_task.py
  - task schema 的唯一生成者
  - content/layout/svg/template/validate/repair/retrospective 全部由它生成

validate_agent_result.py
  - schema 验证唯一入口

collect_agent_results.py
  - output/result 收集唯一入口
```

### 允许修改

```text
scripts/orchestrate/ppt_parent.py
scripts/orchestrate/make_agent_task.py
scripts/orchestrate/collect_agent_results.py
scripts/orchestrate/validate_agent_result.py
references/workflow/00_parent_orchestrator.md
```

### 具体做法

1. 删除或停用 `ppt_parent.py` 内部的 `cmd_make_task` 具体 schema 逻辑。
2. `ppt_parent.py make-task` 可以：
   - import `make_agent_task.make_task`；或
   - 用 subprocess 调用 `make_agent_task.py`。
3. 保证 `ppt_parent.py make-task` 和直接运行 `make_agent_task.py` 产物一致。

### 验收命令

```bash
python planners-ppt-hell/scripts/orchestrate/ppt_parent.py examples/minimal_deck_work make-task --step svg --batch batch_01 --split-pages
python planners-ppt-hell/scripts/orchestrate/make_agent_task.py examples/minimal_deck_work --step svg --batch batch_01 --split-pages --output /tmp/task-direct
python planners-ppt-hell/scripts/test/smoke_v2.py
```

### 完成标准

- parent 生成的 task 和 direct script 生成的 task 关键字段一致：
  - `contract`
  - `input_files`
  - `output_files`
  - `constraints`
- task schema 不再在两个文件维护。
- smoke test 通过。

### 阶段复盘问题

```text
□ task schema 的唯一权威在哪里？
□ parent 是否仍然承担了过多 worker 细节？
□ task 文件是否仍足以限制子 Agent 视野？
```

## Phase 3: 清理重复 reference

### 目标

消除字节级重复，避免未来维护分叉。

### 权限提醒

本 Phase 对测试 Agent 来说是 **候选清理阶段**，不是最终删除阶段。

测试 Agent 只能：

```text
□ 证明哪些文件是字节级重复
□ 证明 active route 不依赖旧路径
□ 写出建议删除/移动/legacy_hold 清单
```

测试 Agent 不能直接删除旧副本。最终删除必须交给架构 Owner。

### 当前重复文件

以下文件当前是字节级重复：

```text
references/03_style_system.md == references/domain/style_system.md
references/04_svg_rules.md == references/domain/svg_rules.md
references/05_layout_taxonomy.md == references/domain/layout_taxonomy.md
references/page_content_contract.md == references/contracts/page_content_contract.md
references/layout_plan_contract.md == references/contracts/layout_plan_contract.md
```

### 推荐做法

不要直接删除旧文件。测试 Agent 先建议移动到：

```text
references/legacy/
```

或在 cleanup 表里标注删除计划。

如果最终 Skill 发布包不需要旧路径，由架构 Owner 在用户确认后删除旧副本。

### 验收命令

```bash
python planners-ppt-hell/scripts/test/smoke_v2.py
find planners-ppt-hell/references -maxdepth 1 -type f | sort
rg -n "references/(03_style_system|04_svg_rules|05_layout_taxonomy|page_content_contract|layout_plan_contract)" planners-ppt-hell/SKILL.md planners-ppt-hell/scripts planners-ppt-hell/references/workflow planners-ppt-hell/references/contracts
```

### 完成标准

- active code / active workflow 不引用旧路径。
- 测试 Agent 已输出旧副本的 `remove / move / legacy_hold` 建议。
- 若旧副本已被删除或移入 legacy，必须有用户/架构 Owner 明确确认记录。
- README 和 implementation log 说明兼容策略。
- smoke test 通过。

### 阶段复盘问题

```text
□ 删除旧文件会不会破坏用户已有项目？
□ 如果保留 legacy，谁会读取它？
□ 是否需要一个 migration note？
```

## Phase 4: 压缩 worker reference

### 目标

减少单个 worker 加载的上下文，把大例子和长解释移出活跃路径。

### 当前偏重文件

```text
references/workflow/02_content_worker.md       702 lines
references/workflow/03_layout_worker.md        892 lines
references/contracts/agent_result_contract.md  653 lines
references/contracts/template_profile_contract.md 673 lines
references/contracts/batch_learning_contract.md 594 lines
```

### 推荐结构

活跃 workflow 只保留：

```text
目的
输入
只读文件
可写文件
步骤
completion criteria
禁止事项
失败时怎么停止
```

大例子移到：

```text
references/examples/content_examples.md
references/examples/layout_examples.md
references/examples/agent_result_examples.md
```

contracts 只保留：

```text
schema
required fields
validation rules
minimal valid example
```

### 验收命令

```bash
wc -l planners-ppt-hell/references/workflow/*.md planners-ppt-hell/references/contracts/*.md
python planners-ppt-hell/scripts/test/smoke_v2.py
```

### 目标指标

建议目标，不是硬性指标：

```text
02_content_worker.md <= 300 lines
03_layout_worker.md <= 350 lines
agent_result_contract.md <= 350 lines
template_profile_contract.md <= 400 lines
batch_learning_contract.md <= 350 lines
```

### 阶段复盘问题

```text
□ 被移走的例子是否仍能按需找到？
□ active workflow 是否仍足以让子 Agent 正确执行？
□ 有没有把重要规则误删成 no-op？
```

## Phase 5: 清理发布包沉积

### 目标

去掉不应发布的缓存和临时产物。

### 权限提醒

本 Phase 中，测试 Agent 只能提出发布包排除建议。  
实际删除缓存、测试 workdir、移动备份目录，必须由架构 Owner 执行。

### 候选清理项

```text
scripts/__pycache__/
examples/minimal_deck_work/
planning/ 中临时验收产物是否需要进入发布包
backups/ 是否只保留在仓库根，不放入 Skill bundle
```

### 注意

不要删除用户要求保留的原版备份。  
但备份目录不应进入最终 Skill bundle 发布包。

### 验收命令

```bash
find planners-ppt-hell -name "__pycache__" -type d
find planners-ppt-hell -name "*.pyc" -type f
git status --short
python planners-ppt-hell/scripts/test/smoke_v2.py
```

### 完成标准

- 测试 Agent 已列出 `__pycache__`、`.pyc`、测试 workdir、备份目录的处理建议。
- 若这些文件已被删除或移出发布包，必须有用户/架构 Owner 明确确认记录。
- 最终 Skill bundle 内不应包含 `__pycache__`、`.pyc` 和测试 workdir。
- smoke test 通过。

## Phase 6: 最终架构确认

### 目标

确认系统已经进入“简洁、固定、可解释”的状态。

### 必须输出

新增或更新：

```text
planning/architecture-simplification-report.md
```

报告结构：

```markdown
# Architecture Simplification Report

## Final Architecture
- parent responsibilities
- worker responsibilities
- script responsibilities
- contract responsibilities

## Removed / Moved
| file | action | reason |

## Active Route Table
| step | references | scripts | outputs |

## Failure Mode Scan
- Premature Completion
- Duplication
- Sediment
- Sprawl
- No-op

## Test Results
```

### 最终验收命令

```bash
python planners-ppt-hell/scripts/test/smoke_v2.py
python planners-ppt-hell/scripts/orchestrate/ppt_parent.py examples/minimal_deck_work status --json
python planners-ppt-hell/scripts/orchestrate/ppt_parent.py examples/minimal_deck_work next --json
python planners-ppt-hell/scripts/orchestrate/ppt_parent.py examples/minimal_deck_work preflight-layout-review --json
git status --short
```

### 最终完成标准

```text
□ route 单一
□ task schema 单一
□ workflow references 可按需读取
□ 单个 worker reference 不再过长
□ 无字节级重复 active reference
□ 无缓存文件进入 Skill bundle
□ WorkBuddy 审阅页问题可被 parent 诊断
□ retrospective 不自动写回
□ export gate 不被削弱
□ 五种失败模式降到可接受水平
```

## 执行纪律

执行 agent 每完成一个 Phase，必须停下来写一段阶段确认：

```text
Phase N 完成确认：
- 测试是否通过：
- 删除/移动了什么：
- 保留了什么：
- 仍然复杂的地方：
- 是否建议继续下一 Phase：
```

如果任一 smoke test 失败，不得继续下一 Phase。

### 交接格式

测试 Agent 每个 Phase 结束后必须追加一段交接记录：

```markdown
## Phase N Handoff

### Tests Run
- [command] -> pass/fail

### Findings
- [finding]

### Safe Changes Made
- [file] -> [change]

### Candidates Requiring Owner Approval
| file | suggested_action | reason | risk | tests_before_action |
|---|---|---|---|---|

### Stop / Continue Recommendation
[continue / stop for owner review]
```

若 `Candidates Requiring Owner Approval` 非空，默认应该停下来让架构 Owner review，而不是继续做破坏性清理。

## 不建议做的事

- 不要为了减少文件数，把所有规则塞回 `SKILL.md`。
- 不要删除 review gate。
- 不要让子 Agent 写 flow_state、approval 或 export_allowed。
- 不要把 retrospective 自动写回默认设置。
- 不要为了统一路径而破坏已有脚本验收。
- 不要在没有测试保护的情况下删除 legacy 文件。
