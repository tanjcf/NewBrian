# Holon Windows 桌面小游戏自动化测试方案

## CASE-ID: HOLON-GAME-001 通过 Holon 开发并验收 Windows 桌面贪吃蛇

- Requirement: 用户在 Windows 桌面版 NewBrain 的 Holon 页面领取任务，经显式确认和工具审批后，生成可独立运行的桌面贪吃蛇游戏；自动化程序用真实鼠标、键盘事件验证玩法、持久化和重启恢复。
- Source paths: `shared/apps/desktop/src/renderer/app/HolonWorkspace.tsx`、`shared/apps/desktop/src/main/holon-work-item-service.ts`、`platforms/windows/apps/desktop/src/main/index.ts`、`platforms/windows/apps/desktop/scripts/`。
- Risk: 审批绕过、模型假完成、只生成网页、程序不可启动、键盘无响应、重复执行、工作区逃逸、重启后状态丢失。
- Execution tier: 可见 Electron E2E + 真实 Windows 子进程 + 确定性模型契约测试；发布前追加 MSI 安装版和真实模型 smoke。

### Preconditions

1. Windows 11 测试机，屏幕分辨率至少 1366x768，缩放 100% 或记录实际缩放值。
2. 安装或构建 Windows 桌面版 NewBrain；应用必须以普通用户权限运行。
3. 使用独立用户数据目录、独立工作区和唯一测试运行 ID，禁止复用生产账号数据。
4. 工作区初始为空，线程标题为 `HOLON-GAME-001`，权限模式为“请求批准”。
5. 测试机具备项目选定的桌面游戏运行时。优先使用仓库现有、免费、维护中的桌面技术栈；不得把 HTML 页面包装成验收目标。
6. 测试期间录屏，并开启 Electron renderer/main 日志、Holon 事件日志和进程树采集。

### Fixtures

Holon WorkItem：

```text
请在当前工作区开发一个 Windows 桌面贪吃蛇小游戏。
要求：最终成果必须作为独立桌面窗口运行，不允许以网页或浏览器打开；支持方向键和 WASD；吃到食物分数增加 10；支持空格暂停/继续；撞墙后显示“游戏结束”；按 R 可重新开始；窗口标题为“Holon Snake”；输出到 outputs/holon-snake/，并提供启动程序和 README.txt。
```

必须存在的验收事实：

- 独立顶层窗口标题为 `Holon Snake`。
- 方向键与 WASD 均可控制移动。
- 初始分数为 0，吃到一个食物后为 10。
- 空格切换暂停和继续。
- 撞墙后出现 `游戏结束`。
- `R` 恢复到初始局面，分数归零。
- README 包含启动方法和控制说明。

禁止事实：

- `.html` 是唯一入口。
- 启动时打开默认浏览器。
- 输出写到工作区之外。
- 模型只回复“已完成”但没有可运行程序。

### User actions

所有业务动作必须通过系统级鼠标/键盘事件执行。CDP 仅可读取可见控件矩形和页面状态；禁止调用 `element.click()` 代替点击。

1. 启动可见 NewBrain 桌面窗口并截图。
2. 鼠标点击左侧 `Holon`。
3. 鼠标点击 `远程任务`，再点击 `刷新并领取`。
4. 验证任务正文完整显示；鼠标点击 `准备执行`。
5. 验证确认区域出现；鼠标点击 `确认执行`。
6. 等待运行状态，验证任务正文在执行期间仍可查看。
7. 每次出现审批弹窗时截图，记录工具名、命令、工作区路径和风险提示。
8. 对工作区内构建命令点击 `批准并继续`；对于越界命令必须点击 `拒绝` 并判案例失败。
9. 等待 Holon 显示完成；点击生成物链接或“在系统中打开”。
10. 等待独立 `Holon Snake` 窗口出现并获得前台焦点。
11. 发送方向键和 WASD，验证蛇头位置发生符合方向的变化。
12. 发送空格，等待一秒，验证位置不变；再次发送空格，验证移动恢复。
13. 使用测试模式或确定性种子让食物位于蛇前方；发送方向键吃到食物，验证分数由 0 变为 10。
14. 连续发送方向键使蛇撞墙，验证显示 `游戏结束`。
15. 发送 `R`，验证游戏重新开始且分数归零。
16. 使用 `Alt+F4` 关闭游戏，验证 NewBrain 仍正常运行。
17. 关闭并重新启动 NewBrain；重新打开同一项目、线程和 Holon 页面。
18. 验证任务仍为完成状态，生成物链接仍可用；再次启动游戏并完成一次方向键移动。

### Running-state assertions

- NewBrain 窗口始终可见、响应鼠标，不出现白屏或 renderer 崩溃。
- 任务执行前必须出现明确确认，不能领取后自动运行。
- 审批请求必须在 30 秒内形成可见 `approval-dialog`。
- 执行中显示运行状态、取消控制、推理摘要或工具步骤；不能长时间显示假完成。
- 游戏启动后必须出现独立 Windows 顶层窗口，不得使用浏览器标签页。
- 键盘事件发送到游戏窗口，不得错误输入到 NewBrain 编辑框。

### Runtime assertions

- 事件顺序至少为：`work_item.claimed -> work_item.started -> approval.requested -> approval.resolved -> work_item.completed`。
- 每个审批 call ID 唯一，批准一次只能恢复一次。
- Holon 终态只能在构建成功、程序存在且验证工具返回成功后写为 completed。
- 超时按消息静默判断；有推理、工具事件或心跳时任务保持运行。
- 重启不得重复执行构建命令或重复发送完成事件。

### Side-effect assertions

- 所有新文件位于 `outputs/holon-snake/`。
- 记录生成目录清单、SHA-256、签名状态、文件大小和修改时间。
- 启动游戏后进程路径必须位于该输出目录或其受控运行时目录。
- 不得修改工作区外文件，不得新增计划任务、服务、注册表启动项或防火墙规则。
- 完整运行只产生一个游戏进程树；关闭后不得残留后台进程。

### Artifact assertions

- Windows 可执行入口存在，PE 文件头为 `MZ`；若技术栈使用解释器，必须提供无需浏览器的桌面启动器并记录运行时依赖。
- README 可读取，包含方向键、WASD、空格、R 和退出方式。
- 使用 Windows UI Automation 读取窗口标题、分数、暂停和游戏结束文本；不能只靠截图人工判断。
- 用像素或 UIA 边界比较验证蛇头位置变化；布局变化阈值必须大于抗锯齿噪声。
- 最终截图必须清楚显示独立游戏窗口、分数 10、暂停、游戏结束和重新开始状态。

### Recovery assertions

- 强制关闭 NewBrain 后重启，线程消息、审批记录、Holon 终态和生成物链接仍存在。
- 再次启动游戏不会重新构建或生成第二份输出。
- 游戏进程在 NewBrain 重启前若仍运行，NewBrain 不得把它误判为新的 Holon 执行。
- 恢复后事件数量和构建产物哈希不变。

### Failure variants

- `HOLON-GAME-002`: 用户拒绝第一次构建审批，验证无可执行文件、任务不显示完成。
- `HOLON-GAME-003`: 执行中点击取消，验证进程树终止、无假完成、可明确重试。
- `HOLON-GAME-004`: 模型流完全静默超过阈值，验证任务失败；持续推理时不得超时。
- `HOLON-GAME-005`: 构建工具缺失，验证页面显示可操作错误，不声称已生成游戏。
- `HOLON-GAME-006`: 游戏启动后立即崩溃，验证 Holon 验收失败并保留崩溃日志。
- `HOLON-GAME-007`: 请求写出工作区，必须拒绝并记录安全事件。
- `HOLON-GAME-008`: 批准后杀死 NewBrain，重启不得重复执行已确认副作用。
- `HOLON-GAME-009`: MSI 安装版执行主案例，验证资源、运行时和进程名称与开发版一致。

### Evidence

保存到 `windows/integration-artifacts/holon-desktop-game/<run-id>/`：

```text
environment.json
input-events.jsonl
process-tree-before.json
process-tree-running.json
process-tree-after.json
01-newbrain-start.png
02-holon-task.png
03-execution-confirm.png
04-approval.png
05-holon-completed.png
06-game-window.png
07-score-10.png
08-paused.png
09-game-over.png
10-restarted.png
11-after-newbrain-restart.png
renderer.log
main.log
holon-events.json
artifacts.json
outputs/holon-snake/README.txt
result.json
screen-recording.mp4
```

### Pass criteria

只有以下条件全部满足才是 `PASS`：

1. 18 个用户操作步骤全部通过真实鼠标键盘事件完成。
2. 审批弹窗可见且批准后只恢复一次。
3. 独立桌面游戏窗口启动，不打开浏览器。
4. 移动、暂停、得分、撞墙、重启五项玩法断言全部通过。
5. 产物路径、安全边界、进程清理和哈希断言全部通过。
6. 重启 NewBrain 后任务、线程和产物可恢复且无重复副作用。
7. 所有规定证据存在，`result.json` 没有缺失步骤。

任一关键项缺失时使用 `FAIL`、`PARTIAL`、`BLOCKED` 或 `NOT RUN`，禁止输出 `PASS`。

### Release blocker

- 主案例、拒绝、取消、崩溃恢复任一失败：阻止 PR 和 nightly。
- MSI 案例失败或未运行：阻止 MSI 发布。
- 审批绕过、工作区逃逸、假完成或重复副作用：阻止所有发布。

## 自动化实现建议

1. NewBrain Electron 操作使用 CDP `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent` 和 `Input.insertText`。
2. Windows 游戏窗口发现、前台激活和控件读取使用免费开源的 Windows UI Automation 实现；优先复用已维护库，不手写 Win32 辅助功能协议。
3. 每次动作记录时间、目标窗口、控件矩形、坐标、按键和动作后截图。
4. 测试失败时先截图，再保存 DOM/UIA 状态、进程树和日志，最后关闭隔离进程。
5. 测试脚本退出码：`PASS=0`，其他状态均非零；禁止截断输出被误判为成功。
