# Planner's PPT Hell 架构升级基线与回滚说明

## 冻结对象

- 正式 Skill：`02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell`
- 隔离 staging：`PPT-Skill-around/planners-ppt-hell-architecture-upgrade-staging-20260717`
- 审计日期：2026-07-17（Asia/Shanghai）
- 正式目录 Git 状态：所在 workspace 不是 Git repository，因此不能依赖 commit、branch 或 worktree 回滚。
- 回滚策略：正式 Skill 在人工确认前保持只读；所有修改仅进入非 Skill 发现路径下的 staging。未晋级时直接继续使用正式目录；晋级时先逐文件 diff、复跑验收，再做单次目录级替换。

## 基线盘点

- 文件总数：91（其中 84 个源文件/资产，7 个 `__pycache__/*.pyc` 运行缓存）
- 总体积：约 2.2 MB
- 文本总行数：约 16,960 行
- staging 初始校验：`diff -qr` 无差异
- Python：`/Users/ivan/.venvs/skills-py312/bin/python`，Python 3.12.13

## 基线验证

| 验证 | 结果 | 说明 |
|---|---|---|
| `scripts/test/smoke_v2.py` | PASS | 36/36 场景通过 |
| `scripts/test/mece_scan_v2.py` | PASS | 当前 MECE 扫描通过 |
| Skill `quick_validate.py` | PASS | Skill 基础结构通过 |

基线通过只证明当前测试集没有回归，不代表架构一致。审计已确认测试和生产代码共同保留了旧合同，因此存在“测试绿、运行时仍矛盾”的情况。

## 已确认的基线缺陷

1. `references/contracts/worker_svg_contract.md` 要求 SVG task 不读取完整 profile、asset registry 或 `components.svg`；`references/workflow/04_svg_worker.md` 仍要求执行完整 profile 的 `usage_policy.binding_fields`、位图资产和装饰模式。两个权威输入直接冲突。
2. `make_agent_task.py` 的 SVG task 实际只传最小 `template_style`、registry 和已选 canvas，说明代码已迁移而 workflow 未退休旧规则。
3. `generate_template_review_html.py` 同时保留四维反馈 UI 变量、三份互相覆盖的 `submitFeedback` 实现，最终依赖最后一份覆盖前两份；这是补丁叠加而不是单一合同。
4. `review_server.py` 仍计算四维反馈合法性，但实际提交门禁不再使用该结果；死逻辑与错误提示继续制造认知噪音。
5. `SKILL.md`、Parent workflow 和模板合同仍把四维反馈描述为强制，而真实 UI/Server 已部分简化。
6. `make_agent_task.py` 的 `agent_result` 模板缺少 Collector 强制要求的 `input_hashes`；revision 还要求 Worker自行补写顶层 `feedback_sha256`。这是此前多个 Agent 只修 hash、时间戳和反馈 hash 的直接原因。
7. `Test-023ffae3/fidelity_template/canvas_previews/png_manifest.json` 保存了旧项目的绝对路径，模板库包不可移植。
8. 正式 Skill 内含 7 个 `.pyc` 缓存，属于无引用运行垃圾。
9. 测试模板当前只有 `cover/contents/chapter/content_base/closing` 五个 canvas；默认模板有七个，但没有明确的漏斗、流程、数据表、三卡对比可选模型。需要区分“当前真实模板没有证据”与“专用模型机制被删除”，不能凭 taxonomy 伪造。

## 晋级前硬门禁

- 正式目录与冻结基线可比较，staging 变更清单完整。
- 所有删除项先证明无引用。
- smoke、MECE、quick validate、模板 visual gate、默认模板应用、真实 `content_base` forward、review Server 健康检查全部通过。
- 不自动提交任何模板或页面人工批准。
- 最后只把“是否晋级 staging”与“人工审阅入口”留给用户确认。
