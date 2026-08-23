# BRAIN Software Runtime v1 — 软件与自动化场景 Tools 子架构

> Status: **approved baseline** for **software 场景 Tools 子架构**  
> Parent: [brain-scene-tools-v1.md](./brain-scene-tools-v1.md)  
> Related: [unified-capability-runtime-v1.md](./unified-capability-runtime-v1.md)

## 0. 在 BRAIN 中的位置

```text
BRAIN 主框架
└─ 七场景 Tools 子架构
   └─ software / flow（软件与自动化, workspaceKey = "software" | "flow"）   ← 本文档
      ├─ 继承：项目 / 对话 / Composer / Rust Core / 能力运行时 / agentd
      ├─ 扩展：Agent 改码 · 授权终端 · 测试/部署脚本 · Flow 审批自动化
      └─ 外部 Engine：**process.run**（shell / 编译器 / 测试 runner / CI）
```

| 层 | 路径 | 说明 |
|----|------|------|
| 主框架 | **Composer + Agent 循环** | 主入口；不是裸 VS Code |
| software UI | `SoftwareWorkspace.tsx` | 脚本任务、终端快照、测试/部署 |
| flow UI | `FlowWorkspace.tsx` | NL/可视化 **自动化 Flow** + 审批 |
| software IPC | `brain:software:*` | 脚本、终端、任务 |
| flow IPC | `brain:flow:*` | 计划、审批、重试 |
| Engine | Rust **`process.run`** + agentd 写文件 | 审批后执行 |

**对标关系（AI 编程 Agent 框架，非传统 IDE）：**

| 主流 AI 软件 Agent / 框架 | 借鉴什么 | BRAIN 不做什么 |
|-----------------------------|----------|----------------|
| **Cursor / Claude Code / Copilot Workspace** | **Repo 上下文 + 多轮改码 + 终端** | 不重造完整 IDE 插件生态 |
| **Devin / OpenHands 类 Agent** | 任务分解 → 编辑 → 跑测试 → 汇报 | 不做无人值守云 VM |
| **Replit Agent / Bolt.new** | NL → 脚手架 → 可运行项目 | 不做浏览器内全栈托管 |
| **n8n AI / Zapier Central** | NL → **Flow 自动化**（flow 工作台） | 不做公有云集成商店为主产品 |
| **GitHub Actions** | test/deploy **脚本化** gate | CI 在本地/用户环境，非 GH 绑定 |

BRAIN software = **BRAIN 自身 Agent 壳 + 授权项目目录 + 审批后 process**；VS Code 仅可选 `launch_external` 打开仓库。

**UX 合一（避免重复）：**

| 层 | 职责 | 不要做 |
|----|------|--------|
| **中栏 Composer** | **唯一**自然语言指令入口（改码 / 跑测 / 建 Flow） | 右栏再放一套 Chat / Ask Cursor |
| **右栏 Diff** | 补丁预览 · Accept / Reject | 再复述一遍对话 |
| **右栏终端** | 项目目录受控命令与测试输出 | 独立「软件工作台」聊天 |
| **右栏 Flow** | 定时 / 条件 / 审批自动化（原「自动化」能力） | 另开第七个并列「自动化」场景 |

产品层仍是一个工作台名「软件与自动化」；`software` 与 `flow` 是**同一壳下的执行面 Tab**，不是两套对话产品。

---

## 1. 参考模型（AI Agent 开发管线抽象）

| 用户动作 | software 子架构 | 谁执行 |
|----------|-----------------|--------|
| 「修这个 bug」 | Agent 读 repo → patch | agentd + 审批 |
| 「跑测试」 | `startSoftwareTask` test 脚本 | process.run |
| 「打开终端执行 npm build」 | `openSoftwareProjectTerminal` | 授权 cwd + 终端 IPC |
| 「每天备份并通知」 | Flow 计划 + 审批 | flow workspace |
| 「部署到 staging」 | deploy 脚本 task | process.run + 审批 |

| 后台概念 | 实现 | 持久化 |
|----------|------|--------|
| Repo 文件树 | brain files + agentd | 项目目录 |
| Script catalog | `listSoftwareScripts` | package.json / 项目配置 |
| Task run | `BrainSoftwareTaskState` | SQLite / 内存 |
| Flow definition | flow IPC | SQLite + manifest |
| Terminal session | terminal IPC | 会话快照 |

---

## 2. 磁盘工程布局

```text
{ProjectRoot}/
├── .brain-software/
│   ├── manifest.json
│   └── pipeline.json
├── （用户代码仓库本身）
└── Docs/
    └── BRAIN/
        ├── run-log.json
        └── flow-export.json
```

---

## 3. Rust / 能力操作（目标态）

| Operation | 审批 | 现状 | 说明 |
|-----------|------|------|------|
| `process.run` | 是 | **已有** | shell / npm / pytest 等 |
| agentd write | 是 | **已有** | Agent 改码 |
| `software.cook` | 是 | 无 | 运行摘要 + flow 导出 |
| flow approve/retry | 是 | **已有** E2E | Flow 工作台 |

---

## 4. 与能力运行时

| 意图 | Provider |
|------|----------|
| 改代码 | agentd workspace 工具 |
| 跑脚本/测试/部署 | process + `SoftwareWorkspace` |
| 终端交互 | terminal IPC（授权目录） |
| 自动化 Flow | flow builtin + 审批 |
| 导出运行报告 | `software.cook`（规划） |

---

## 5. 实施阶段

| Phase | 交付 |
|-------|------|
| P0 ✅ | 本文 + L2 flow/software E2E 基线 |
| P1 | Composer 任务 → Agent 改码 → 一键 test 闭环 |
| P2 | Flow NL 创建（n8n AI 式）+ 失败重试 hardened |
| P3 | `software.cook` 运行摘要 |
| P4 | 可选 `software.launch_external`（VS Code） |

---

**Version:** `brain-software-runtime-v1`
