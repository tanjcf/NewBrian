# NewBrain Agent Platform V2

## 目标

NewBrain V2 将 Cursor 的项目内编辑体验、Trae CN 的独立 Tool Host、WorkBuddy 式任务协作体验，以及 TRAC（Traceability、Recovery、Autonomy、Control）原则组合成一个本地优先、可恢复、可审计的 Agent 平台。

平台不展示模型私有思维链，只保存并展示安全的推理摘要、工具证据、任务状态和质量门结果。

## 已实现架构

| 能力 | 实现 | 可验证证据 |
|---|---|---|
| 自动判断 | 模型获得 `agent.delegate/list/wait/send/interrupt`，可按任务复杂度自行决定是否分工 | `agent-collaboration.ts`、runtime 工具描述与测试 |
| 动态分工 | 子 Agent 拥有独立模型—工具循环、角色、上下文胶囊、依赖图和并发上限 | `agent-loop.js`、`task-graph.js`、`multi-agent-orchestrator.js` |
| 可恢复执行 | Agent loop checkpoint 保存消息、步骤、待审批工具和剩余调用；启动时恢复 | Desktop thread rollout、`restoreAgentLoop` 测试 |
| 隔离编辑 | editor 子 Agent 使用独立 Git worktree 和 `codex/agent-*` 分支 | `worktree-manager.js` 真实 Git 测试 |
| 工具隔离 | 内置工具经独立 JSONL Tool Host 进程执行；超时、取消和异常退出被隔离 | `tool-host-client.js`、`tool-host-worker.js` |
| 混合工具 | 本地内置工具走 Tool Host；MCP、协作和桌面适配器在受控进程内执行 | `LocalAgentRuntime.invokeTool` |
| 人工控制 | 父任务可查看并逐个批准或拒绝子 Agent 的待执行工具 | Desktop 协作卡片、审批 IPC、审批 E2E |
| 推理摘要 | 推理摘要与最终正文分离保存和展示，不泄露私有思维链 | OpenAI wire tests、Agent event envelope |
| 结构化回收 | 子 Agent 返回 findings、evidence、artifacts、changedFiles、tests、questions 和 qualityGates | `agent-result.js` |
| Artifact | code/document/spreadsheet/presentation/web 统一创建、编辑、验证和预览 | `artifact-service.js` 与 OOXML 测试 |
| 写作体验 | Goal/Plan、阶段式提纲确认、正文生成、长度校验、引用与导出保留在同一工作区 | government/research writing tests 与 Electron UI E2E |

## 调度与恢复

1. 父 Agent 根据任务边界调用 `agent.delegate`。
2. 每个子任务写入 SQLite，包含角色、指令、父子线程、状态及 `dependsOn`。
3. 无依赖任务并行运行；有依赖任务等待所有前置任务完成。
4. editor 角色进入影子 worktree，researcher/verifier 可共享只读项目上下文。
5. 工具审批和每个关键 loop 事件都会写 checkpoint。
6. 应用重启后 running 状态回到 queued，并按持久化依赖顺序恢复。
7. 父 Agent 通过 `agent.wait` 收集结构化结果，质量门失败不会被静默吞掉。

## 相对参考产品的差异化

本机参考安装显示 Cursor 3.11.19 采用 VS Code/Electron 工作台；Trae CN 1.107.1 附带独立 `modules/ai-agent/bin/agent-tool-host.exe`。NewBrain 保留两者的优势，同时把以下能力作为公开、可测试的产品协议，而不是仅作为内部实现：

- 子 Agent 任务、依赖、审批和恢复状态统一持久化。
- 编辑任务默认 worktree 隔离，研究/验证任务不承担无意义的分支成本。
- Tool Host 与 Agent loop 之间使用有界 JSONL 协议，并提供取消传播和 Windows 进程树回收。
- Artifact 质量门直接进入子 Agent 结构化结果与父任务协作界面。
- 推理摘要、证据引用和私有思维链之间有明确的数据边界。
- 写作工作流与编码工作流共享 Goal、Plan、审批、Artifact 和多 Agent 基础设施。

## 发布门

- Agent runtime、策略、Tool Host、Artifact、worktree、任务图测试必须全部通过。
- Desktop storage/protocol TypeScript 检查必须通过。
- Electron 生产构建必须包含 `tool-host-worker.js`。
- 文件预览和 Shell 审批 Electron E2E 必须通过。
- `git diff --check` 必须无空白错误；新增源文件必须是 UTF-8 无 BOM。
