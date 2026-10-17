# 架构升级执行与验收方案

## 目标合同

升级后必须同时成立：

1. 模板只固定视觉身份与页面边界。
2. Layout Worker 独占内容结构、上屏文案、wireframe、素材角色和 canvas 选择。
3. SVG Worker只执行当前 batch 已批准的 canvas、wireframe 和 `final_on_slide`。
4. 没有精确专用模型匹配时，Layout 必须选择 `content_base`。
5. replace layer 为空；locked layer hash、required components、validator、视觉审阅、人工审批不削弱。
6. SVG task 不携带完整 profile、提取证据、asset registry、`components.svg` 或未选 canvas。
7. 全系统只有一个 template registry、一个通用 `layout_id`、一个 canvas选择字段 `template_layout_id`，不新增 legacy fallback。
8. 人工模板审阅：每 layout Yes/No + 单独反馈框；最后整体反馈框与模板命名。反馈可先提交，批准必须明确且不自动发生。
9. 原 Agent affinity 不变：revision 先恢复原 Agent，只有明确 `not_found` 后创建替代。
10. Worker不再手工猜测确定性 result metadata。

## 变更控制

- 写入范围：仅 staging。
- 正式 Skill：直到最后用户确认前保持不变。
- 每 Phase 先改直接权威源，再同步所有下游合同、脚本、Prompt、默认模板和测试。
- 任何旧机制被新机制替代后，旧文件/字段/JS/测试断言直接删除，不保留备份。
- Domain 三文件受保护，不因流程重构改写。
- 一个新实施 Agent负责 staging 的完整一致性；主线程逐 Phase review 和验证，避免多人交叉写同一合同。

## Phase 1 — 冻结架构与建立守护测试

改动：

- 把 observed architecture 精炼为 staging 内 `references/architecture.md`，并在 `SKILL.md` 仅作为维护入口引用；不加入 Worker task。
- 在 smoke/MECE 中先增加失败测试：
  - SVG task 严禁完整 profile/evidence/asset registry/components/unselected canvas。
  - `content_base` fallback。
  - replace layer 为空。
  - 人工模板审阅页面不存在四维控件/文案/重复 JS。
  - Server 接受“只提交一条反馈、不批准”，批准时要求所有 layout Yes + 模板名；整体反馈不强制阻断普通反馈提交。
  - result 模板与 Collector required fields 一致。

验证：新增测试先能命中当前缺陷，再在本 Phase 后续改动中转绿。不得删除旧测试来获得通过。

## Phase 2 — 收敛文档、Prompt 与运行时合同

改动：

- `SKILL.md`、Parent workflow、Template workflow、SVG workflow、template profile contract、agent task/result contracts 统一到目标合同。
- 从 SVG workflow 删除完整 profile binding、reusable assets、decoration patterns 的施工指令。
- profile 保留视觉方向与提取审计；明确它不是 SVG task 输入，也不覆盖 Layout wireframe。
- 删除四维强反馈文字；保留模板 visual gate 与逐 layout 人工批准。
- 明确专用模型是可选 canvas，只有 Layout精确选择后才进入 task；不能从 taxonomy 自动生成。

验证：

- `rg` legacy term 扫描：SVG runtime 文档不得出现 `binding_fields`、完整 profile 施工、四维强反馈。
- MECE 扫描通过。
- SKILL quick validate 通过。

## Phase 3 — 简化人工模板审阅实现

改动：

- `generate_template_review_html.py` 删除 dimensions 变量、CSS、HTML 和三份覆盖函数，只保留一份提交函数。
- 每 layout 提供清晰的 Yes/No（或等价显式选择）和独立 feedback；整体反馈与模板名保留。
- “提交反馈”允许任意一条反馈，不要求给每个 layout 作结论；“全部通过并发布”要求每个 layout Yes + 模板名，但不由页面直接发布，只写批准证据。
- `review_server.py` 删除四维死验证和旧错误提示；仍验证 expected layout 全覆盖、类型、candidate audit、fidelity visual gate、provenance。
- Parent/Server 对缺失 `00_template_review.html` 保持可诊断失败，不静默 file fallback。

验证：

- HTML 静态断言和无头浏览器交互测试。
- Server POST：反馈-only 200；不完整 approve 400；完整 approve 200；不自动发布。
- `/template`、图片证据 URL、`/health` 返回 200。

## Phase 4 — 统一 task/result 确定性元数据

改动：

- `make_agent_task.py` 生成完整 `agent_result` 模板：包括所有输入文件当前 SHA-256、输出占位、revision feedback hash。
- 输入 hash 的 key 规则在一个实现中定义，Collector 按同一规则验证；不新增第二 contract 文件。
- Worker只填运行时身份、开始/结束、status、summary，并在写完输出后填/生成输出 hash；如可在现有脚本内提供 finalize 子命令，则复用同一权威逻辑。
- Collector 严格度不降低：继续拒绝 stale task、越界输出、hash mismatch、错误 role、旧反馈。

验证：

- 完整 result 一次收集通过。
- 缺/改 input、output、feedback hash 均被拒绝。
- Content、Layout、Template、SVG initial/revision fixture 全覆盖。

## Phase 5 — 模板运行时与模板库清理

改动：

- Builder/validator 明确生产 canvas 的 replace layer 必须为空；删除黑灰内容占位块。
- `content_base` 必须存在、required components 非空且只表达跨页稳定身份。
- task 只列 selected canvases；专用模型未选时不进入 input。
- Test 模板：利用旧项目保留的 10-layout registry、27 个 approved components 和逐 layout canvas visual self-review 恢复 `content_data`、`content_compare`、`content_funnel`、`content_process` 等可选模型。迁移后重建包并生成新的人工审阅页；在用户复核前不自动批准或晋级正式 Skill。
- 默认模板保留现有可选 `two_column_light` 与 `data_light`；只有 Layout精确匹配时选。
- 重建 Test preview manifest 为相对/包内路径，重渲染 preview/contact sheet，更新 manifest hashes。
- 删除 7 个 `.pyc`。
- 逐一检查未引用 media；只有 registry/components/profile/audit package 均无引用时删除，不保留备份。

验证：

- template package validate、manifest hash、visual gate。
- 所有 canvas locked hash/required components 验证。
- replace layer 元素数为 0。
- 包内不得出现旧项目绝对路径。

## Phase 6 — 真实 forward 与失败模式验收

新增两个可重复 fixture：

1. 默认模板应用：初始化真实项目 → 应用 `planner-simple-default` → Layout选择一个核心页与 `content_base` → 生成 SVG task → 校验 payload。
2. 不匹配专用模型的真实 `content_base` forward：输入一页带非标准关系的真实 Markdown；Content/Layout产物完整；Layout明确选择 `content_base`；SVG task 只携带该 canvas；生成 SVG 后 locked hash、required components、wireframe文案、validator 和 PNG均通过。

失败模式：

- 删除 selected canvas → task generation fail。
- 选择未知 layout → fail，不 fallback 到“最近模型”。
- 改 locked layer → validator fail。
- 删除 required component → validator fail。
- 把未选 canvas/components/profile 加入 SVG task → test fail。
- stale feedback/html/png hash → review gate fail。
- revision 旧 Agent存在时 → spawn forbidden；明确 not_found 后才允许 replacement。

## Phase 7 — 全量回归、视觉审阅与晋级包

必须执行：

- `smoke_v2.py`
- `mece_scan_v2.py`
- Skill `quick_validate.py`
- 当前测试模板 visual gate
- 默认模板应用验证
- 真实 `content_base` forward test
- 新模板人工审阅页生成
- review Server `/health` 与关键资源 200
- staging vs baseline 全量 diff
- 文件引用/绝对路径/pycache/legacy term 扫描

人工项：

- 生成新的模板人工审阅入口，但不自动批准。
- 最终只请用户确认：是否在页面完成审阅、是否把通过全量自动验收的 staging 晋级为正式 Skill。

## 验收矩阵

| 能力 | 自动证据 | 人工证据 |
|---|---|---|
| 单一架构与路由 | architecture/MECE/legacy scan | 架构文件可读性 |
| content_base fallback | fixture + task payload + validator | forward PNG是否自然 |
| canvas身份边界 | empty replace + locked hash + required components | 模板身份是否足够 |
| 最小 SVG task | exact input list test | 无 |
| 专用模型可选 | selected/unselected payload tests | 新专用模型发布时模板审阅 |
| result 稳定性 | initial/revision positive/negative tests | 无 |
| 模板反馈 UX | HTML/Server/browser tests | 用户实际体验 |
| 视觉质量 | validator + PNG + visual gate | 模板/全 deck review |
| 审批不可绕过 | provenance/hash/stale tests | 用户显式批准 |
| Agent affinity | flow event tests | 无 |
| 可回滚 | 正式 Skill仍未改 + staging diff | 用户决定晋级 |

## 不做事项

- 不建立 V3 并行 registry。
- 不新增 layout category/type 字段。
- 不保留 old/new 两套 review UI。
- 不增加“如果没有 content_base 就用最近 canvas”的 legacy fallback。
- 不以降低 validator、hash、required components 或人工审批来换速度。
- 不在没有源模板证据与人工审阅时恢复专用模型。
- 不自动批准模板。
