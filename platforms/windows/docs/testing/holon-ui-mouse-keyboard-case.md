# Holon UI-001: 远程任务确认与审批界面

## 目的

验证用户可以仅通过可见的 Electron 界面进入 Holon、领取远程任务、确认执行，并在模型请求本地工具审批时看到审批弹窗。该案例不把 IPC 调用、DOM `click()` 或模型服务响应当作用户操作。

## 前置条件

1. 启动独立的可见 NewBrain Electron 实例，使用独立用户数据目录和调试端口。
2. 测试模型服务准备一个确定的 WorkItem：`wi_ui_001`，目标是触发一次需要本地审批的工具调用。
3. 仅允许测试夹具通过 `window.newbrain.createBlankWorkspace` 和 `window.newbrain.addWorkspaceThread` 创建空项目；创建完成后重新加载页面。
4. 记录屏幕分辨率、Electron 版本、测试端口、测试模型服务地址和工作区路径。

## 鼠标键盘操作步骤

| 步骤 | 用户可见操作 | 自动化事件 | 必须观察到 |
|---|---|---|---|
| 1 | 等待主窗口出现 | 等待窗口标题 `NewBrain`；截图 | 主窗口可见，未出现启动错误 |
| 2 | 点击左侧 `Holon` | `Input.dispatchMouseEvent(mouseMoved)` 后发送 `mousePressed`、`mouseReleased`，坐标来自按钮中心 | 出现 `Holon` 工作台和五个标签 |
| 3 | 点击 `远程任务` 标签 | 同上 | 远程任务视图可见 |
| 4 | 点击 `刷新并领取` | 同上 | 页面出现 `wi_ui_001`，状态为待确认；不得自动执行 |
| 5 | 点击 `准备执行` | 同上 | 出现执行确认区域；仍未调用本地工具 |
| 6 | 点击 `确认执行` | 同上 | 任务进入运行状态；页面显示运行中的任务状态 |
| 7 | 等待审批请求 | 不发送键盘或鼠标事件；轮询页面截图和可见文本 | 出现 `data-testid="approval-dialog"`，同时显示批准和拒绝按钮 |
| 8 | 点击 `批准并继续` | 鼠标移动、按下、释放 | 审批弹窗进入处理中状态并消失；任务继续运行 |
| 9 | 使用键盘切换标签 | `Input.dispatchKeyEvent` 发送 `Tab`，必要时发送 `Enter` | 焦点可见地移动到同步/反馈标签，不跳出应用 |
| 10 | 点击 `同步与反馈`，使用键盘填写技能标识和版本 ID | 点击输入框；发送 `Input.dispatchKeyEvent(char)` 或 `insertText`；按 `Tab` | 输入值在页面可见，提交按钮可用 |
| 11 | 点击 `提交反馈` | 鼠标移动、按下、释放 | 页面显示提交结果；不得重复提交 |
| 12 | 截图并保存证据 | 截图、页面文本、事件日志、任务状态 | 保存步骤 2、4、7、8、11 的截图和最终状态 |

## 失败判定

- 任何步骤使用 `element.click()`、直接调用业务 IPC、修改 SQLite 或调用服务接口代替用户操作：`PARTIAL`。
- 任务在用户确认前自动执行：`FAIL`。
- 收到审批请求但 30 秒内没有可见 `approval-dialog`：`FAIL`。
- 审批弹窗出现但按钮不能通过鼠标点击：`FAIL`。
- 任务完成但页面没有显示完成状态或反馈重复提交：`FAIL`。
- 缺少截图、键盘事件记录或最终任务状态：`NOT RUN`。

## 证据格式

保存到 `windows/integration-artifacts/holon-ui-ui-001/<timestamp>/`：

- `step-02-holon.png`
- `step-04-claimed.png`
- `step-07-approval-visible.png`
- `step-08-approved.png`
- `step-11-feedback-submitted.png`
- `input-events.jsonl`
- `ui-state.json`
- `result.json`

只有 `result.json` 同时记录所有步骤为 `PASS`，且审批弹窗截图确实存在时，案例才可判定为 `PASS`。
