# Planner's PPT Hell vNext 一次性升级包

## 结论

本升级不再修补 Parent 与常驻子 Agent 的通信，而是退休整条对话式编排链。目标系统由三部分组成：

1. 一个确定性 Pipeline Controller，负责状态、任务快照、hash、时间、验证、日志、审阅与导出。
2. 一个主执行 Agent，串行完成 Template、Content、Layout；它只写语义产物，不写机器元数据。
3. SVG 默认由主 Agent 按 batch 串行执行；只有 batch 相互独立且宿主确实支持并发时，才允许启动一次性 batch Worker。Worker 完成后退出，不恢复、不保持 affinity、不与 Controller 对话。

这次升级保留并加强：locked layer hash、required components、contract/schema、capacity、SVG validator、模板视觉自检、全 deck 视觉审阅、三道人审和严格导出。

## 基线与目标

- 实施基线：`PPT-Skill-around/releases/2026-07-17-rc1/planners-ppt-hell`
- 正式 Skill：`02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell`
- 新候选目录建议：`PPT-Skill-around/releases/2026-07-17-vnext-candidate/planners-ppt-hell`
- 正式 Skill 在最终人工确认前保持不变。
- RC1 当前有 109 个文件，并仍包含 `__pycache__/*.pyc`、额外 `Test2-a132122a` 模板包和 136 处 Agent/affinity/result/parallel 相关引用；这些是升级审计对象，不直接复制为新权威。

## 文件导航

- `01_TARGET_ARCHITECTURE.md`：vNext 单一架构与 ownership。
- `02_PROBLEM_TO_CHANGE_MAP.md`：历史问题、根因和持久修复层。
- `03_IMPLEMENTATION_PLAN.md`：一次性实施 Phase 0–8、逐文件改动和退休清单。
- `04_ACCEPTANCE_PLAN.md`：自动、视觉、弱模型、性能和全流程验收。
- `05_RELEASE_AND_ROLLBACK.md`：候选创建、晋级、失败停止和回滚。
- `06_EXECUTION_PROMPT.md`：新实现任务可直接使用的 Prompt。
- `07_PREPARATION_LOG.md`：本次准备工作的证据、失败和边界。
- `evals/evals.json`：五个真实 forward eval。
- `PACKAGE_MANIFEST.json`：升级包机器索引。

## 不可重新讨论的边界

- 不建立第二套 registry、layout 分类、legacy fallback 或审批通道。
- 不再保留 Parent Agent、agent affinity、resume/send/wait 协议。
- 模型不写 timestamp、input hash、output hash、task hash、feedback hash、运行状态或文件清单。
- Template、Content、Layout 不并行；先保证正确交接，再优化纯脚本步骤。
- 未精确匹配专用 canvas 时必须使用 `content_base`。
- SVG task 只携带当前 batch 实际选中的 canvas 和最小运行时。
- 不自动批准任何人工门禁。
- 不通过延长 Prompt、增加 JSON 字段或增加 validator 数量解决执行不稳定。

## 实施完成定义

只有 `04_ACCEPTANCE_PLAN.md` 的 P0/P1/P2/P3 全部通过，且新模板审阅、Layout 审阅和 Visual 审阅均由用户显式提交后，才允许替换正式 Skill。
