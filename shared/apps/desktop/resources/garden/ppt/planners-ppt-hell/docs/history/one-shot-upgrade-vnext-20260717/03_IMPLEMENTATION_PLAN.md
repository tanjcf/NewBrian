# 一次性实施方案

## 总体策略

从RC1复制到全新candidate，仅在candidate修改。按Phase顺序完成；每个Phase测试转绿后再进入下一阶段。禁止同时维护旧/新两条生产路径。

## Phase 0 — 冻结基线与候选

1. 机器记录RC1全部文件、SHA-256、大小和模板包清单。
2. 运行当前 smoke、MECE、quick_validate、visual gate、content_base forward。
3. 创建candidate并证明初始diff为0。
4. 标记RC1中的`__pycache__/*.pyc`、`Test2-a132122a`和Agent通信引用为待审计项，不盲目继承。

验收：基线报告完整；正式Skill未修改；candidate可一条命令丢弃回滚。

## Phase 1 — 先建立新失败测试

新增或改写测试，先证明RC1会失败：

- SKILL/Workflow/Controller中不得要求Parent Agent、affinity、resume/send/wait。
- 模型输出模板不得包含timestamp/input hash/output hash/task hash/feedback hash。
- Controller `next` 只返回一个当前动作，不返回dispatch策略。
- Template/Content/Layout固定串行。
- SVG无并发能力时可直接串行，不要求用户批准“降级”。
- finalize一次返回全部问题；失败不写stage_completed。
- review整体决策为Approve/Revise/Discard，per-layout仍为Yes/No。
- 自动日志非空且包含失败命令与duration。

验收：测试能命中RC1旧机制；不得删除现有质量门禁断言。

## Phase 2 — 重写Skill入口和架构文档

修改：

- `SKILL.md`
- `references/architecture.md`
- `references/workflow/00_parent_orchestrator.md`：改名为`00_pipeline_controller.md`
- `agents/openai.yaml`

内容变化：

- Parent启动协议改为Pipeline启动协议；
- 唯一主Agent默认串行；
- 删除Agent affinity和并发降级问答；
- 保留模板选择、三个Review、视觉原则和严格导出；
- `SKILL.md`只保留核心workflow与reference路由，不重复各合同细节。

删除旧文件：`00_parent_orchestrator.md`在所有引用迁移后直接删除，不保留同义副本。

## Phase 3 — 退休Agent task/result通信合同

修改或替换：

- `references/contracts/agent_task_contract.md` → `stage_task_contract.md`
- 删除 `references/contracts/agent_result_contract.md`
- `scripts/orchestrate/make_agent_task.py` → `make_stage_task.py`
- 删除 `scripts/orchestrate/collect_agent_results.py`
- `scripts/orchestrate/ppt_parent.py`改为确定性Controller；文件可在本次升级中重命名为`ppt_pipeline.py`，所有引用一次迁移。

新机制：

- task仍为机器生成不可变输入快照；
- Agent只写task列出的语义输出；
- `finalize-stage`计算hash、时间、输出集合、feedback freshness并运行阶段preflight；
- 成功追加`stage_completed`事件；失败追加`stage_failed`和完整issue列表；
- revision task由当前人工feedback生成冻结snapshot，无Agent identity。

删除字段与命令：

- `agent_result_path`、`output_template.agent_result.json`；
- `worker_run_id`、`agent_id`、`worker_agent_affinity`；
- `execution.mode` parallel/serial；
- `confirm-execution`、`bind-agent`；
- dispatch/on_not_found/on_dispatch_unavailable。

迁移原则：不存在legacy reader。旧项目如需继续，提供一次性离线migration脚本把有效语义产物转成新事件，不在生产Controller中保留fallback。

## Phase 4 — 按阶段收敛Prompt和语义骨架

修改：

- `references/workflow/01_template_intake.md`
- `references/workflow/02_content_worker.md`
- `references/workflow/03_layout_worker.md`
- `references/workflow/04_svg_worker.md`
- 相关contracts
- task builder中的固定instruction

要求：

- 每阶段只有一个固定短Prompt；
- task只列真实文件；
- 机器预建需要的JSON骨架与合法枚举；
- 模型只填语义内容和视觉判断；
- 阶段结束统一调用`finalize-stage`；
- 修复预算默认一次集中返修；仍失败则停在当前阶段并给出全部问题。

## Phase 5 — 集中Preflight与日志

修改：

- `validate_contracts.py`
- `estimate_layout_capacity.py`
- `validate_svg_layout.py`
- `template_visual_gate.py`
- Controller
- `scripts/retrospective/analyze_run.py`

要求：

- 每阶段一次preflight聚合现有hard checks；
- issue有`code/severity/path/message/remediation`；
- hard error阻断，warning进入review但不触发自动返修；
- 命令、耗时、exit code、错误和修复轮次自动写flow events；
- report生成器输出有效工作时间、人审等待时间、失败命令、重复调用、SVG并发收益和视觉返修次数。

不做大范围validator算法重写；O(T²)性能优化单独以profile证据决定。

## Phase 6 — Review UX与明确路由

修改：

- `generate_template_review_html.py`
- `generate_layout_html.py`
- `generate_review_html.py`
- `review_server.py`

Template：每Layout Yes/No + 单独反馈，整体Approve/Revise/Discard + 整体反馈 + 模板名。

Layout/Visual：保留每页框选/反馈和整体反馈；页面文案按语义结构渲染，禁止把嵌套JSON逐字段平铺成超长列表。

Server：

- decision明确映射状态；
- Revise要求反馈，Discard不强迫详细解释，Approve要求完整硬条件；
- 所有反馈绑定当前HTML/PNG/SVG/registry hashes；
- 路径containment、body size、page-set和资源200检查保留；
- 不存在的review文件返回可诊断状态，不做file fallback。

## Phase 7 — SVG执行模式

默认：主Agent顺序执行所有batch。

可选并发启用条件：

- 至少2个batch；
- task写入范围完全不相交；
- 所有输入已经由Layout批准并冻结；
- 宿主明确支持并发；
- Controller只等待每个一次性任务结束，不发送中途消息。

并发失败时同一task可由主Agent串行重跑，不需要用户确认，不恢复旧Agent。任何batch都不得读取其他batch产物。

## Phase 8 — 清理、全回归与候选封版

删除：

- 旧Agent contracts/scripts/commands/tests；
- affinity事件和文档；
- parallel/serial配置；
- `.pyc`/`__pycache__`；
- 无引用模板包、旧canvas、陈旧preview和绝对路径；
- 为兼容旧流程而存在的Prompt、JS和字段。

运行`04_ACCEPTANCE_PLAN.md`全部门禁。生成candidate manifest和diff，最后只把人工审阅入口与是否晋级正式Skill留给用户。

## 逐文件影响矩阵

| 文件组 | 处置 |
|---|---|
| `SKILL.md`, `agents/openai.yaml` | 重写触发与单Agent流水线描述 |
| `references/architecture.md` | 替换为本文目标架构 |
| `references/workflow/00_*` | Parent→Controller，旧文件删除 |
| Template/Content/Layout/SVG workflows | 删除agent result和通信说明，加入finalize |
| agent task/result contracts | task改stage task；result合同删除 |
| page/template/layout/svg contracts | 保留语义权威，删除机器元数据要求 |
| `ppt_parent.py` | 重构/重命名为Controller，删除dispatch/affinity |
| `make_agent_task.py` | 改stage task builder |
| `collect_agent_results.py` | 功能并入finalize后删除 |
| review generators/server | 明确三态整体决策和语义化呈现 |
| validators/gates | 聚合调用，不削弱hard断言 |
| `analyze_run.py` | 自动生成真实运行与浪费报告 |
| smoke/MECE/forward | 重写旧Agent假设，新增弱模型和性能断言 |
| template library | 只清理无引用/缓存/陈旧包，不改变已批准视觉身份 |
