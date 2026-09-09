# 操作手册（Phase 1）

本文面向使用者（Operator），说明如何在本仓库结构下运行与理解 Phase 1 的桌面端与运行时。

> 说明：本仓库当前以“可落地的脚手架”为主，部分脚本/构建依赖需要你在本机安装 Node.js 与 `pnpm` 后才能完整运行。

## 1. 环境要求

- Node.js（建议 LTS 版本）
- 包管理器：`pnpm`
- Git（用于 `git status` 等工具）

## 2. 安装依赖

在 `windows/` 目录执行：

```bash
pnpm install
```

## 3. 启动（开发模式）

### 3.1 启动桌面端（Desktop）

在 `windows/` 目录执行：

```bash
pnpm dev:desktop
```

### 3.2 启动运行时（agentd）

在 `windows/` 目录执行：

```bash
pnpm dev:agentd
```

> 设计意图：桌面端负责交互与审批；agentd 负责 workspace 绑定、工具执行与 patch 生成/应用。

## 3.1 打包（Windows：Installer + Portable）

本项目桌面端使用 `electron-builder` 打包。Windows 下默认产物包括：

- `NewBrain Installer.exe`：NSIS 标准安装向导（可安装/卸载）
- `NewBrain Portable.exe`：便携版单文件（免安装）

### 方式 A：本机直接打包（推荐在“无安全策略拦截”的机器上）

在 `windows/` 目录执行：

```bash
pnpm install
pnpm --filter @codex-forge/desktop build
pnpm --filter @codex-forge/desktop package:win
```

产物位置：

- `windows/apps/desktop/release/NewBrain Installer.exe`
- `windows/apps/desktop/release/NewBrain Portable.exe`

### 方式 B：Windows Sandbox 打包（推荐在宿主机受策略限制时）

当宿主机存在安全策略导致 Node 子进程创建失败（例如 `spawnSync EPERM`），建议用 Windows Sandbox 在干净环境打包。

1. 确保 Windows Sandbox 功能已启用（Windows 10/11 Pro/Enterprise）。
2. 准备输出目录（宿主机可写）：
   - `windows/_sandbox_out/logs`
   - `windows/_sandbox_out/release`
3. 用 WindowsSandbox 运行配置文件：
   - `windows/sandbox/newbrain-build-win.wsb`
4. 打包完成后从宿主机取回：
   - `windows/_sandbox_out/release/NewBrain Installer.exe`

> 备注：若双击 `.wsb` 文件提示“需要新应用打开”，可用命令行启动：
>
> `C:\Windows\System32\WindowsSandbox.exe windows\sandbox\newbrain-build-win.wsb`

### 方式 C：CI 打包（GitHub Actions）

如果宿主机无法启用 Sandbox，也无法放行安全策略，可用 CI 在干净 Windows runner 上打包并下载产物：

- workflow：`.github/workflows/build-windows-installer.yml`

## 4. 基本操作流程

1. **选择/绑定 workspace**（一个本地仓库）
2. **发起请求**：在对话输入区描述你希望做的修改或排查（例如“找出构建失败原因并修复”）
3. **审批工具执行**：
   - 运行时会把待执行工具请求（shell/git/scan）投递给 UI
   - UI 展示原因、风险与命令（如有），用户确认后执行
4. **查看工具输出**：在会话时间线看到 stdout/stderr 摘要与执行状态
5. **预览补丁**：运行时生成 patch proposal 后，UI 展示预览（行级摘要）
6. **应用补丁**：明确点击/确认应用后写入文件
7. **复查**：执行 `git status`、运行测试等（这些也应通过审批流）

## 5. 常见问题（FAQ）

### 5.1 为什么要审批？

因为 shell 命令与写入文件属于高风险动作。Phase 1 通过“审批 + 可预览补丁”的方式，把风险点显式化。

### 5.2 workspace 扫描为什么是 medium 风险？

扫描会读取仓库的目录结构与部分元数据，可能暴露敏感路径或文件名。因此默认也走审批。

### 5.3 patch 生成为什么看起来比较简单？

Phase 1 的 patch 生成策略是“在单文件中用 searchText 替换 replaceText”，目标是先验证端到端闭环（生成—预览—应用—记录），再逐步扩展到更强的变更生成能力。

## 6. 故障排查

- **启动失败**：优先检查 `pnpm install` 是否成功、Node 版本是否兼容。
- **运行时无法执行 git**：确认系统 PATH 中存在 `git`。
- **工具执行失败**：查看 run log 中的 stderr/exitCode，并复查 workspace 路径绑定是否正确。
- **打包时出现 `spawnSync EPERM`**：通常是宿主机安全策略/杀软拦截 Node 子进程创建，优先尝试 Windows Sandbox/CI 打包。
