# 工作日志

## 2026-07-17：冻结与基线

- 读取并执行 `planning-before-create-skill` 的完整 `SKILL.md` 及其直接要求的 workflow map、控制级别、人机检查点、验证迭代、持续迭代和失败模式参考。
- 确认正式 Skill 所在 workspace 不是 Git repository。失败命令：`git rev-parse --show-toplevel`。影响：不能使用 branch/worktree 作为回滚边界；改用正式目录只读 + 隔离 staging。
- 复制正式 Skill 到 `PPT-Skill-around/planners-ppt-hell-architecture-upgrade-staging-20260717`，随后 `diff -qr` 验证完全一致。
- 确认 Python 解释器为 `/Users/ivan/.venvs/skills-py312/bin/python`（3.12.13）。
- 基线执行：smoke 36/36、MECE、quick validate 均通过。

## 2026-07-17：文档与合同审计

- 完整读取 `SKILL.md`、7 份 workflow、8 份 contract、4 份 domain 文件。
- 发现 SVG 最小运行时合同与旧 profile binding workflow 直接冲突。
- 发现人工模板审阅“四维强反馈”在 SKILL/workflow/contract、HTML 生成器、Server 和 smoke 中存在不同状态。
- 发现 `content_base` 已存在于两个发布模板，replace layer 均为空；locked layer 与 required components 机制仍在。

## 2026-07-17：代码与资产审计

- 遍历 91 个文件并计算 SHA-256。
- 对所有 Python 文件提取类、函数、CLI 与参数入口；对模板 JSON 提取顶层键、layout/component 数；对 SVG 提取 layout id、locked/content/component 标记。
- `generate_template_review_html.py` 存在三份同名 JS 提交函数，后定义覆盖前定义；四维 HTML 已生成但未插入页面，相关 CSS/JS/Server 验证仍残留。
- `review_server.py` 计算 `valid_dimensions` 但不用于最终判定；这是已失效的门禁残骸。
- `make_agent_task.py` 输出模板未提供 `input_hashes`；Collector 却硬性要求非空。
- 测试模板预览 manifest 含旧项目绝对路径。
- 正式 Skill 包含 7 个 `.pyc`，计划只从 staging 删除。

## 2026-07-17：专用模型历史证据校正

- 主线程查看当前 Test canvas contact sheet 与九页源模板 contact sheet，确认源 P5-P8 分别包含数据表、三卡对比、漏斗、流程。
- 在旧项目 `PPT-Skill-around/V2PPTTest2/planners-ppt-output/_internal/00_project/` 找到 10-layout fidelity package、27 个 approved components 和全部 layout 通过的 canvas visual self-review；旧 canvas replace layer 均为空。
- 结论：当前五-layout包不是“没有证据”，而是后续简化错误删除了可选专用模型。已中断并校正新实施 Agent 的 Phase 5 指令：恢复为可选模型、重建包、重新生成最终人工审阅页；仍不得自动批准，未选模型不得进入 SVG task。

## 子 Agent 记录

### 上一轮已完成 Agent（本轮开始时关闭）

- `019f6a9c-d27f-7412-806f-e5684823eda5`：只修正 Content result 的 UTC 时间戳。
- `019f6a9c-d30a-7971-9768-ce909e7057d2`：只同步 registry 输出 hash。
- `019f6b26-a84e-7d20-9add-76b100eed08b`：只补 Layout result 顶层 `feedback_sha256`。
- `019f6b6c-7c39-7912-a0ab-c842cad42fe4`：只修 SVG result 时间戳。
- `019f6b6c-7cc3-7922-b81b-b2ffb104cd3f`：核对 page_06/validation/self-review hash，无进一步优化。

这些记录显示大量工作时间花在 Worker 手工补齐确定性元数据，而不是内容/版式/SVG 质量；升级方案将把它视为系统性合同缺陷处理。

### 本轮只读审计 Agent

- `019f6bf2-d988-7d22-9c09-0eaa0c6f7970`（Russell）：脚本调用链、重复实现、死代码、性能与测试缺口。
- `019f6bf2-da1d-7032-ae28-6c3a79af9a2f`（Hegel）：模板库资产、hash/路径、canvas、预览和测试覆盖。

两者均被明确禁止修改文件。其完整返回结果将在完成后追加到本日志，并作为架构审阅证据，不直接成为实现权限。

### 只读审计完成

- Russell 完整报告归档：`05_SUBAGENT_SCRIPT_AUDIT.md`。新增确认 Collector `partial/failed`、output集合、capacity门禁、模板批准未绑定 canvas、strict missing images、notes、Server路径与 Retrospective漂移。
- Hegel 完整报告归档：`06_SUBAGENT_TEMPLATE_AUDIT.md`。新增确认 registry/preview绝对路径、components媒体层级错误、rejected媒体发布、package hash、默认模板 alias 与 preview缺失。
- 两名 Agent均沿用旧“四维强反馈”作为安全要求；主线程依据用户明确需求拒绝该建议，用 machine visual gate + 当前 canvas hash + 逐 layout Yes/No + 整体反馈 + 显式人工批准替代。

## 失败、浪费与根因记录

- 一次大批量文档读取被工具输出截断；随后改为逐组、逐文件分段读取。浪费来源：试图一次把 1,000+ 行混合文档放入单个输出。
- 一次大范围 `rg` 输出被截断；随后改为按“函数入口”“旧合同关键词”“资产 JSON/SVG”分组。浪费来源：搜索维度没有先分层。
- 过去流程的重复 Agent 修补集中在 timestamp、hash、feedback hash，说明 result contract 依赖生成式 Worker 完成确定性工作，导致反复和低稳定性。
- 模板反馈 UI 通过连续覆盖同名 JS 函数实现临时兼容，表面能提交但保留无效 UI/文案/Server 逻辑；这类补丁是“看到什么改什么”的典型历史债务。

## 2026-07-17：主线独立验收与二次修正

- 不直接采信实施 Agent 的测试自报；主线独立重跑 smoke 40/40、MECE、Skill quick validate、Test visual gate 和真实 `content_base` forward。
- 主线发现新的漏洞：用于 forward/default 验证的 `apply_fidelity_template.py` 仍硬编码标题/正文坐标。因此旧 forward 只证明选中 `content_base`，没有真正证明 SVG 按 Layout Plan wireframe 施工。
- 已在 staging 修复：适配器强制读取当前页 wireframe，校验 layout id，拒绝空 wireframe/缺失 title-body 区域；smoke 和 forward 直接断言 SVG 文字坐标。
- 修复后真实 forward：只传 `content_base.svg`；title `(140,100)`、body `(140,270)` 与 wireframe 一致；validator 0 error；PNG 成功。
- 重建外部人工审阅项目：`Test-023ffae3-human-review`；Server `http://127.0.0.1:8772/template` 健康。源图 2–6 和 canvas 依赖媒体均返回 HTTP 200。
- 真实内置浏览器检查：10 个 Layout、10 组 Yes/No、10 个单独反馈框、1 个整体反馈框、1 个模板命名输入；无破图，无 console error/warn，未提交任何批准。
- 额外失败/浪费：一次 shell 命令在 JS 工具包装中引号解析失败，改为小命令；sandbox 与 escalated Server 的网络上下文隔离导致 HTTP 000，改为同一授权上下文验证；首个内置浏览器 tab 立即 stale，按标准恢复流程创建新 tab 后成功。
- 正式 Skill 仍未写入。当前唯一必须的人工节点是新模板审阅；不得用历史证据自动批准。

## 2026-07-17：第一轮新模板人工反馈

- 反馈文件来自当前 review Server Session，并绑定当前 HTML、源 PNG、registry、10 个 canvas SVG 和预览 PNG；provenance 完整。
- 用户命名模板为 `Test`，保留 `cover_red`、`contents_light`、`chapter_light`、`content_base`、`closing_red`。
- 用户明确拒绝 `content_hero`、`content_data`、`content_compare`、`content_funnel`、`content_process`；它们不再是该 Test 模板的可选产品能力。
- 本次提交为 `approved:false`，所以不能发布或提升；必须先根据 No 返修并为新包重新生成审批凭证。
- 按历史 Agent 优先规则，成功恢复原 Template Agent `019f6a9c-d30a-7971-9768-ce909e7057d2`；未创建替代 Agent。
- 测试语义调整原则：Test 包必须严格只有用户保留的 5 个 Layout；“只携带已选专用 canvas”仍通过独立 fixture 验证，不因单个模板的人工取舍而弱化通用合同。
