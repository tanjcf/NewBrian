# 详细设计（Phase 1）

本文从实现角度描述 Phase 1：模块划分、数据模型、关键接口与状态流。

参考：

- `docs/architecture/overview.md`（整体边界）
- `docs/architecture/phase1-live-runtime.md`（Phase 1 runtime 现状）

## 1. 总体架构

```text
apps/desktop (Electron + React)
  - renderer: 会话 UI、diff/patch 预览、审批卡片
  - main: 原生能力、进程管理、IPC 桥接

apps/agentd (Node, Phase 2 迁移 Rust)
  - runtime: workspace 扫描、工具执行、patch 生成与 apply
  - session machine: 管理 snapshot 状态（来自 packages/protocol）

packages/protocol
  - session-machine: snapshot 数据结构与状态机（UI/runtime 共享）
```

## 2. 关键数据结构（来自运行时代码）

以下字段以 `apps/agentd/src/runtime.js` 的实现为准：

- `snapshot.session`：会话元信息与状态（`idle` / `awaiting-approval` / `running` / `failed`）
- `snapshot.workspace`：扫描得到的条目列表（最多 400 条，忽略 `.git`、`node_modules` 等）
- `snapshot.messages`：对话与系统消息（追加式）
- `snapshot.runs`：工具执行记录（保留最近 8 条）
- `snapshot.pendingTool`：等待审批的工具请求（含风险、原因、命令）
- `snapshot.approval`：审批对象（提示文案、是否需要确认）
- `snapshot.patch`：补丁提案（单文件、行级预览）

## 3. Workspace 扫描

实现要点（`scanWorkspaceEntries`）：

- 递归遍历目录，按“目录优先 + 名称排序”
- 忽略：`.git`、`node_modules`、`dist`、`out`、`release`、`tmp`，以及 `tmp-*`
- 输出条目：`{ path, name, kind, depth }`
- 上限：`MAX_TREE_ENTRIES = 400`（避免 UI 与 IPC 压力）

风险与边界：

- 读取型操作但信息量大，因此在产品设计中定义为 medium risk
- 必须保证扫描根路径为绑定的 workspace

## 4. 工具执行与审批流

### 4.1 设计目标

- 所有风险动作必须先形成“待审批请求”，再由用户确认后执行
- 工具执行结果必须进入 run log 与 message timeline

### 4.2 实现形态

运行时维护：

- `pendingApprovalAction`：一个待执行的 async 函数
- `snapshot.pendingTool` / `snapshot.approval`：给 UI 展示的请求信息

关键方法：

- `queueWorkspaceScan()`：生成扫描请求并等待审批
- `queueGitStatus()`：生成 `git status --short --branch` 请求并等待审批
- `queueShellCommand(command)`：生成任意 shell 命令请求并等待审批（high risk）
- `respondToApproval(approved)`：
  - approved=false：清理 pending 状态，写入“Denied”消息
  - approved=true：进入 `running`，执行 pendingApprovalAction，写 run log 与消息；异常则进入 `failed`

### 4.3 风险等级建议

运行时代码中标注：

- scan/git：`risk: "medium"`
- shell：`risk: "high"`

后续扩展：

- 为命令引入结构化参数（避免自由文本）
- 引入策略引擎（policy guard）与更细粒度的审批规则

## 5. Patch 生成与应用

### 5.1 Patch 生成（`generatePatch`）

- 输入：`filePath`、`searchText`、`replaceText`
- 校验：
  - 文件必须在 workspace 内（`withinWorkspace`）
  - 原文必须包含 `searchText`
  - 替换后内容必须发生变化
- 产物：
  - `pendingPatchState`：保存 `absolutePath`、`relativePath`、`nextContent`
  - `snapshot.patch`：包含预览（最多 16 行，`+`/`-` 标记）

限制：

- 当前仅支持单文件、单段替换，属于 Phase 1 的最小闭环能力

### 5.2 Patch 应用（`applyPatch`）

- 将 `pendingPatchState.nextContent` 写回目标文件
- 写入 run log（`Apply patch`）
- 清理 patch 状态并触发一次 workspace 重新扫描

后续扩展：

- 多文件 patch（批量）
- 更真实的 diff/hunk（统一 diff）
- 与 git 集成（自动创建分支、提交等）

## 6. 状态机与可观测性

### 6.1 会话状态（建议约束）

- `idle`：可接收新请求
- `awaiting-approval`：UI 必须先做决定（同一时间只允许一个 pending approval）
- `running`：工具执行或 patch 应用中
- `failed`：失败状态，要求用户观察日志并手动恢复到 `idle`（或提供“重试/清理”按钮）

### 6.2 日志与审计

Phase 1 以 `snapshot.messages` + `snapshot.runs` 为主：

- messages：偏叙述（assistant 解释执行结果）
- runs：偏结构化（命令、状态、退出码）

后续扩展可将其落盘为 event log，支持 replay 与 crash recovery。

