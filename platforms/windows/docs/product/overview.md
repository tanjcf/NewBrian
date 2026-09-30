# 产品设计：NewBrain / Codex Forge（Phase 1）

## 1. 产品定位

`NewBrain / Codex Forge` 是一个 **local-first 的编码智能体工作台**：通过桌面端（Desktop UI）+ 本地运行时（agentd），在**明确的人工审批**与**可预览补丁**机制下，帮助用户对本地仓库完成“阅读—决策—执行—回放”的闭环。

Phase 1 的目标不是克隆某个商业产品，而是搭建同等边界的可生产化替代品骨架：

- desktop operator console（桌面操作台）
- local agent runtime（本地代理运行时）
- tool execution and approval pipeline（工具执行与审批）
- session timeline / logs（会话时间线与日志）
- patch proposal + apply（补丁提案与应用）

（与现有架构文档对应：`docs/architecture/overview.md`、`docs/architecture/phase1-live-runtime.md`）

## 2. 目标用户与角色（Personas）

### 2.1 个人开发者 / 独立维护者

诉求：

- 在不牺牲安全性的前提下，提高“修改-验证-提交”的速度
- 清晰可控的工具调用（shell/git/文件写入）
- 变更可预览、可回滚、可审计（至少可追溯）

### 2.2 小团队技术负责人

诉求：

- 能向团队推广统一的“审批与补丁”协作模式
- 对运行时边界、日志、风险动作有可解释性
- 未来可扩展到多任务、worktree、自动化

## 3. 核心使用场景（Phase 1）

1. **打开本地仓库并浏览结构**：运行时扫描 workspace，桌面端呈现树形结构与会话状态。
2. **提出需求/问题**：用户在对话区描述修改目标或排查问题。
3. **运行工具（需审批）**：
   - 只读扫描、`git status` 等中风险工具
   - 任意 shell 命令（高风险）必须审批
4. **生成补丁提案**：运行时基于“搜索文本 -> 替换文本”的简单策略生成 patch（Phase 1 形态）。
5. **预览并应用补丁（需明确动作）**：桌面端展示 patch 预览；用户确认后写入 workspace。
6. **查看日志与回放**：在会话时间线中查看消息、工具运行记录与 patch 应用结果。

## 4. 价值主张（Why it wins）

- **本地优先**：文件访问、shell、git、测试等均在本机执行，贴近真实开发环境。
- **明确审批**：在“看得见的风险点”上卡口，而不是全放开或全禁止。
- **补丁优先**：尽量以补丁提案形式呈现变更，支持审阅与可解释性。
- **可扩展边界**：协议与快照结构预留 `delegatedTasks` / `modelRoutes` / `memories` / `automations` 等扩展字段（见 `docs/architecture/phase1-live-runtime.md`）。

## 5. 用户旅程与关键流程

### 5.1 会话生命周期（理想化）

1. attach workspace
2. session idle
3. user asks
4. runtime queues tool -> desktop asks approval
5. approve -> tool run -> event/log
6. propose patch -> preview -> apply
7. session returns idle

### 5.2 风险分级（Phase 1 建议）

| 动作 | 风险 | 原因 | 处理 |
|---|---:|---|---|
| workspace scan | medium | 读取全仓库信息 | 必须审批（当前实现如此） |
| git status | medium | 读取仓库状态 | 必须审批 |
| shell command | high | 可能执行任意命令 | 必须审批 + 明确显示命令 |
| apply patch | high | 写入文件 | 必须在 UI 中明确“应用”动作 |

> 后续阶段可引入“安全命令白名单/模板化工具”降低审批摩擦。

## 6. Phase 1 范围（In / Out）

### In（应支持）

- 单 workspace 绑定
- 单会话（single-session）
- 单 pending approval / patch（串行化，降低复杂度）
- workspace 树扫描与刷新
- `git status` 读取
- shell 命令执行（审批后）
- patch 提案与应用（单文件、文本替换策略）

### Out（明确不做）

- 多 agent swarm、后台编排
- 多租户 / 云端 API 网关
- 自动路由到不同模型
- marketplace 级插件治理
- 复杂的补丁算法（多文件、语义级重构）

## 7. 需求清单（MVP）

### Must have

- Desktop UI：会话、workspace 树、对话、审批卡片、patch 预览、run 日志
- agentd：workspace 扫描、工具队列与审批状态机、shell/git 执行、patch 生成与 apply
- protocol：共享 session snapshot / tool request / approval / patch / run 模型

### Should have（Phase 1 后半）

- 更稳定的事件流（从一组 IPC handler 走向 event stream）
- 更完整的错误展示（stderr、exitCode、失败原因）
- 运行记录持久化（至少本地文件/SQLite）

### Could have（Phase 2+）

- worktree 任务隔离、检查点、测试摘要
- 可配置的模型路由与技能系统
- memory 与 automation

## 8. 术语表

- **workspace**：用户选择并绑定的本地仓库路径
- **runtime / agentd**：本地代理运行时进程，负责扫描、执行工具、生成与应用补丁
- **approval**：对风险动作的人工确认
- **patch proposal**：运行时生成的变更提案，供 UI 预览与应用
- **run log**：每次工具执行的记录（命令、状态、退出码、输出）

