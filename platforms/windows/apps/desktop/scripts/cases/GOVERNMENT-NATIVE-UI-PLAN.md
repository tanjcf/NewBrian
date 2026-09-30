# 政务写作原生键鼠自动化方案（配置驱动，禁止写死场景）

## 目标

用 **Windows UI Automation + user32 真实鼠标键盘** 验证 NewBrain 政务写作闭环。  
本仓库已有底座：`native-ui-scenario.mjs` + `windows-installed-ui-driver.ps1`（SendInput / mouse_event）。

**禁止**：

- 把云南/江苏/庆阳、煤炭年终总结等业务事实写进 harness
- 用 `window.newbrain` / CDP `Runtime.evaluate` / DOM 点击替代被测用户动作
- 未执行断言却报 PASS；mock 语义冒充真实业务验收

**允许**：

- 启动 Electron、挂确定性模型双、播种工作区（setup）
- 案例 JSON 提供当次请求文案、金标路径、可选附件
- 金标对照走 `government-result-oracle`（从文件动态抽特征）

## 架构

```text
case.json (当次评测输入)
    ↓
government-native-ui-runner.mjs  (编排，不含业务场景常量)
    ↓
native-ui-scenario.mjs           (仅允许原生键鼠动作)
    ↓
windows-installed-ui-driver.ps1  (UIA 找控件 + SendInput)
    ↓
产物独立解析 + result-oracle 打分
    ↓
evidence/<caseId>/result.json + screenshots + oracle-score.json
```

换案例 = 只换 `case.json`（及金标文件），不改 runner。

## 案例配置 Schema（version 1）

| 字段 | 含义 |
|---|---|
| `id` | 稳定案例 ID |
| `request` | 作曲区完整用户输入 |
| `attachments[]` | 可选本地附件路径（相对仓库）；本案例为空 |
| `oracle.path` | 结果校验文件（docx/txt）；本案例指向金标 DOCX |
| `oracle.minHitRate` | 金标特征命中率门槛（默认 0.5） |
| `expect.skillVisibleText` | 可见 Skill 披露文案（如「政务写作」） |
| `expect.specificationConfirmName` | 确认按钮可见名（如「确认并开始写作」） |
| `expect.artifact.glob` | 产物匹配（如 `outputs/**/*.pdf`） |
| `expect.artifact.minChars` | 独立解析后最少正文字符 |
| `expect.forbiddenLeakFrom` | 可选：另一场景禁止串入的短语列表路径或内联数组（评测方提供） |

Harness **不得**内置任何地方案例地名或煤炭产量。

## 闭环步骤（用户动作必须键鼠）

1. 启动可见 Electron（含 `force-renderer-accessibility`）+ 契约模型双  
2. Setup：确保存在可写工作区（API 播种，标注 SETUP）  
3. 键鼠：全权限 → 新对话 → 点击作曲区 → 输入 `request`（非 ASCII 走剪贴板粘贴）→ 发送  
4. 运行中断言：用户气泡仍可见；出现「政务写作」披露；出现写作规格面板  
5. 键鼠：点击「确认并开始写作」  
6. 等待产物文件出现 → 独立解析 PDF/DOCX → `scoreGovernmentResultAgainstOracle`  
7. 截图 → 关窗重启 → 重开同线程/工作区 → 历史与产物仍在且无重复生成  
8. 写出 `result.json`：仅 `PASS|FAIL|PARTIAL|BLOCKED|NOT RUN`

## 本案例（GOV-NATIVE-CASE-001）实例化

- `request`：撰写「因地制宜发展新质生产力」典型案例研究文章，采用政务写作技能  
- `attachments`：`[]`（金标不是附件）  
- `oracle.path`：`tmp/gov-case-verify.docx`  
- 模型双：返回可确认的写作规格与正文（契约形状），**不**把金标内容写进生产代码  

## 诚实判定规则

| 状态 | 条件 |
|---|---|
| PASS | 全部用户动作、规格确认、产物解析、金标门槛、重启恢复均执行且通过 |
| FAIL | 任一步断言失败（保留首失败与截图） |
| PARTIAL | 用了 setup API 替代本应键鼠的步骤，或跳过重启 |
| BLOCKED | 无可见窗口、无模型双、驱动缺失等外部环境 |
| NOT RUN | 未执行 |

Mock 模型只证明 **UI/运行时闭环**；不得写成「真实大模型语义合格」。真实模型冒烟另案。

## 后续评测如何换案例

评测方只提交新的 `case.json` + 新金标文件。Runner 不变。若某案例需要附件，在 `attachments` 填路径；若要禁串扰，在 `expect.forbiddenLeakFrom` 提供短语。
