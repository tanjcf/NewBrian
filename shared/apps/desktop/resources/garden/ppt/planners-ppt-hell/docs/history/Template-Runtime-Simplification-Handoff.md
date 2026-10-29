# Planner's PPT Hell：模板运行时简化重构交接

## 0. 交接目的

本文档供新对话直接执行。目标是在现有 `planners-ppt-hell` 架构上做最小、整体一致的升级，解决以下问题：

1. 模板 canvas 中的黑色、灰色占位块没有语义，容易误导 SVG Worker。
2. 源 PPT 中的漏斗、流程、表格、对比等业务模型被锁进 fidelity canvas，可能把后续内容框死。
3. SVG task 当前携带完整模板 profile、候选 registry、components 和全部 canvas，运行时上下文过重。
4. 模板最重要的 `content_base` 基础内容页没有成为确定性的默认回退。

一句话目标：

> 模板只固定视觉身份和页面边界；Layout 决定内容结构；SVG Worker 只把批准的内容画进已选 canvas。

## 1. 当前状态与边界

### 1.1 Skill 路径

`/Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell`

### 1.2 当前验证项目

`/Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/PPT-Skill-around/V2PPTTest2/planners-ppt-output`

源模板：

`/Users/ivan/Library/CloudStorage/OneDrive-个人/文档/CodexProject/PPT-Skill-around/V2PPTTest2/测试模板.pptx`

### 1.3 已确认的问题证据

- `scripts/template/layout_canvas.py` 的 `abstract_content()` 根据 layout 名称自动生成黑灰占位块，并写入生产 canvas 的 `data-template-content-layer="replace"`。
- `layout_plan_contract.md` 要求 fidelity 页面必须选择一个 `template_layout_id`。
- `04_svg_worker.md` 与 `worker_svg_contract.md` 要求 SVG Worker 从该 canvas 开始，并保留所有 `data-template-lock` 层。
- 当前 `content_funnel`、`content_process`、`content_data`、`content_compare` 把业务模型组件放进 required/locked 层。
- 当前 SVG task 会传入 `template_profile.json`、`template_asset_registry.json`、`components.svg` 和 fidelity 目录下全部 canvas，而非仅传当前 batch 使用的 canvas。

### 1.4 本轮尚未实施的内容

本交接只制定开发与验证计划。不要假设下面的代码修改已经完成。开始实现前先跑 baseline。

## 2. 已确认的产品抽象

### 2.1 不可或缺

1. `content_base` 基础内容页：固定背景、重复身份元素、标题入口、页脚和安全边界；内容区完全开放。
2. 核心功能页：源模板确实存在时保留 cover、contents、section、closing。
3. 最小视觉规则：颜色角色、字体与字号层级、边距、圆角/描边/阴影、标志性元素。
4. lock/replace 边界：模板身份在 lock 层；页面内容全部进入 replace 层。
5. 明确 fallback：没有精确语义匹配时必须使用 `content_base`。

### 2.2 Better to have

- 卡片、胶囊、数字指标、结论条、引用框、图表容器、图片框。
- 两栏、三栏等常用组织方式。
- 不同信息密度的建议。

这些可以被 Layout 选择，但不能成为所有页面的必选约束。

### 2.3 可有可无

- 漏斗、流程、矩阵、时间线、数据表、三卡对比等业务模型。
- 只在内容关系精确匹配且 Layout 明确选择时使用。
- 未选择时不得进入 SVG Worker 的 task inputs。

### 2.4 只属于提取/审阅阶段

- 源页 contact sheet 和逐页 PNG。
- 结构候选、source ID、批准/拒绝记录。
- Template Worker 自审、视觉证据 hash、提取置信度。

这些文件继续用于 Template gate 和人工审阅，但不再作为 SVG Worker 的运行时输入。

## 3. 不得改变的架构决策

为避免继续增加复杂度，本次禁止扩张：

1. 不新增第二套 template runtime 文件或 registry。
2. 不新增 `layout_kind`、`model_type`、`fallback_type` 等分类字段。
3. 继续使用现有 `template_registry.json`、`required_components`、`optional_components`、`template_layout_id`、`layout_reason`。
4. 继续使用 `data-template-lock` hash 校验；不得削弱 fidelity validator。
5. 不让 SVG Worker重新选择模板 canvas；选择责任仍属于 Layout Worker。
6. 不删除 Template 视觉审阅、人工强反馈或原 Agent 返修机制。
7. 不引入备份目录、v3 副本、legacy fallback 或并行双轨实现。

唯一新增强约定：

> 每个 fidelity 模板必须存在 `content_base`，且其 required components 只能表达跨页稳定的模板身份，不得包含业务模型。

## 4. 目标运行时

### 4.1 模板库运行时包

```text
template_registry.json
layout_canvases/
  content_base.svg
  cover*.svg          # 源模板存在时
  contents*.svg       # 源模板存在时
  section*.svg        # 源模板存在时
  closing*.svg        # 源模板存在时
  content_*.svg       # 可选业务模型
template_media/
```

提取证据仍可保存在批准包中供审计，但不得自动进入 SVG task。

### 4.2 Canvas 规则

生产 canvas 只包含：

```xml
<g data-template-lock="background">...</g>
<g data-template-content-layer="replace"></g>
<g data-template-lock="foreground">...</g>
```

要求：

- Builder 生成的 replace 层必须为空，不包含黑灰色、白色或透明的假内容框。
- 标题和正文的位置由 Layout Plan 的 `wireframe` 决定，不再由 canvas 占位块暗示。
- `content_base` 的 locked 层只保留背景、章节/标题标记、页脚等身份元素。
- 业务模型 canvas 可以锁定其模型几何，但仅在 Layout 明确认为语义匹配时选择。

### 4.3 SVG Worker 最小调用

SVG Worker 应只读取：

1. 当前 batch input（已含 content、layout 和精简模板风格摘要）。
2. `04_svg_worker.md`。
3. `style_system.md`。
4. `svg_rules.md`。
5. `worker_svg_contract.md`。
6. `template_registry.json`。
7. 当前 batch 实际选中的 canvas 文件。
8. revision 时的 feedback snapshot 和原 SVG。

不得再传入：

- `template_asset_registry.json`
- `components.svg`（canvas 已内联组件）
- 未被当前 batch 选中的 canvas
- 完整 `template_profile.json`

从 `template_profile.design_direction` 中真正影响 SVG 的最小信息，由 Parent 在生成 batch input 时压缩为 `template_style`：

- `color_roles`
- `type_hierarchy`
- `title_entry`
- `component_language`

不创建新的独立文件。

### 4.4 SVG Worker 执行算法

```text
读取 layout_plan 已批准的 template_layout_id
→ 从 registry 解析该 canvas
→ 保留全部 lock 层
→ 清空 replace 层
→ 严格按 wireframe + final_on_slide 生成内容
→ validator
→ 渲染并视觉查看
→ 发现问题则修改内容层，再 validator + render
```

SVG Worker 不负责：

- 判断漏斗/流程是否适合内容。
- 在模板 layouts 中重新选择。
- 读取源 PPT 或候选提取证据。
- 推断黑灰块含义。

## 5. 目标 Workflow Map

### Step 1：Template Worker 提取

- 输入：源页视觉证据、结构候选。
- 输出：profile、候选审计、registry 决策、canvas、自审。
- 必须先建立 `content_base`，再建立核心功能页，最后才考虑业务模型页。
- 完成标准：`content_base` 存在；replace 层为空；所有 canvas 通过源页视觉对照。

### Step 2：模板人工审阅

- 展示实际生产 canvas 与源页证据。
- 审阅页明确标识 `content_base` 为默认基础页，业务模型为“仅精确匹配时使用”。
- 不再声称 replace 层中的黑灰块是实际起始内容。
- 完成标准：用户逐 layout 给出批准或强反馈；四个全局维度完整。

### Step 3：Layout Worker

- 先按内容关系选择 taxonomy layout 和 wireframe。
- 再选择模板 canvas。
- cover/contents/section/closing 只在页面功能匹配时选。
- 业务模型只在内容语义精确匹配时选。
- 其他所有情况选择 `content_base`。
- 完成标准：每页 `template_layout_id` 有效；没有为了使用模板而硬套模型。

### Step 4：SVG task 构建

- Parent 从 batch pages 收集实际 `template_layout_id`。
- 只把这些 canvas 放入 `input_files`。
- 将最小模板风格摘要写入现有 batch input。
- 完成标准：task 不含模板提取证据和未选 canvas。

### Step 5：SVG Worker

- 无模板选择职责，只执行已批准 canvas、wireframe 和 copy。
- 完成标准：锁定层 hash 通过；内容完整；视觉自审闭环完成。

## 6. 开发任务与逐文件修改

### Phase 0：建立 baseline

先运行：

```bash
'/Users/ivan/.venvs/skills-py312/bin/python' \
  '02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell/scripts/test/smoke_v2.py'

'/Users/ivan/.venvs/skills-py312/bin/python' \
  '02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell/scripts/test/mece_scan_v2.py'
```

记录通过数量。baseline 失败时先判断是否为现有失败，不要把无关问题带入本次重构。

### Phase 1：清空生产 canvas 的占位内容

修改：

- `scripts/template/layout_canvas.py`

任务：

1. 删除 `abstract_content()`。
2. `build_layout_canvas()` 始终生成空的 replace layer。
3. 保持 background/foreground 组件生成和 locked hash 算法不变。
4. 删除因 `abstract_content()` 移除而产生的无用变量和 import；不重构其他代码。

验证：

- Builder 生成 canvas 后，replace group 子节点数为 0。
- locked hash 仍能捕获锁定层改动。
- `apply_fidelity_template.py` 能向空 replace 层写内容。

### Phase 2：建立 `content_base` 强约定

修改：

- `references/workflow/01_template_intake.md`
- `references/contracts/template_profile_contract.md`
- `scripts/orchestrate/make_agent_task.py`
- `scripts/template/build_fidelity_template.py`
- `scripts/orchestrate/ppt_parent.py`
- `scripts/template/template_library.py`

任务：

1. Template Worker 提示改为：先建立 `content_base`，其 required components 只允许稳定身份元素；核心功能页其次；模型页最后且可选。
2. Builder 阻断缺少 `content_base` 的 fidelity decision。
3. Parent 的 template complete gate 阻断缺少 `content_base` 的 registry。
4. 模板库发布阻断缺少 `content_base` 的 package。
5. 保持“每个 layout required components 非空”的现有规则。

禁止：

- 不通过角色 allowlist 自动猜哪些组件是“身份元素”。该判断由 Template Worker视觉完成、人工审阅确认。
- 不新增 layout 分类字段。

### Phase 3：简化 Layout 选择规则

修改：

- `references/workflow/03_layout_worker.md`
- `references/contracts/layout_plan_contract.md`
- Parent 生成的 Layout Worker prompt（只在存在重复或矛盾时改）。

任务：

1. 写清选择顺序：页面功能匹配核心页 → 内容语义精确匹配模型页 → `content_base`。
2. 明确业务模型不代表模板身份。
3. 明确找不到匹配时不得选“最接近模型”，必须回到 `content_base`。
4. 不新增 Layout Plan 字段；继续使用 `template_layout_id` 和 `layout_reason`。
5. 人工 Layout Review 负责主观检查“是否硬套模型”，不要尝试用脆弱关键词 validator 自动判定语义。

### Phase 4：缩小 SVG task 输入

修改：

- `scripts/orchestrate/make_agent_task.py`
- `references/workflow/04_svg_worker.md`
- `references/contracts/worker_svg_contract.md`
- `scripts/orchestrate/ppt_parent.py` 中 SVG dispatch prompt（如有重复）。

任务：

1. 从 batch 的 layout pages 收集唯一 `template_layout_id`。
2. 由 registry 解析并只加入对应 `canvas_file`。
3. 未知 ID 或缺失 canvas 时在 make-task 阶段直接失败。
4. 不再把 `template_asset_registry.json`、`components.svg`、全部 canvas 加入 SVG task。
5. 从可信 profile 中提取最小 `template_style`，写入已有 batch input；不再单独传完整 profile。
6. SVG Worker 文档压缩为一个简单执行顺序，不重复 Template 提取逻辑。

验证：

- 一个 batch 只选择 `content_base` 时，task 中只有一个 canvas。
- 一个 batch 选择两个不同 canvas 时，task 中恰好两个 canvas，且去重。
- task 不含候选 registry、components.svg、完整 profile 和未选 canvas。

### Phase 5：更新模板审阅表达

修改：

- `scripts/generate_template_review_html.py`

任务：

1. 继续嵌入实际生产 canvas，不另造第二套视觉 canvas。
2. 删除“中性内容占位”相关说明。
3. 对 `content_base` 显示“默认开放内容页”。
4. 对其他内容模型显示“仅在内容关系精确匹配时使用”。
5. 继续展示源页证据、required/optional components 和逐 layout 强反馈。

验证：

- HTML 中没有把黑灰块描述为内容区域。
- `content_base` 审阅卡存在并可单独反馈。
- Server 提交反馈合同不变。

### Phase 6：迁移内置默认模板

修改：

- `assets/template_library/planner-simple-default/fidelity_template/template_registry.json`
- `assets/template_library/planner-simple-default/fidelity_template/layout_canvases/*.svg`
- `assets/template_library/planner-simple-default/template_worker_result.json`
- `assets/template_library/planner-simple-default/manifest.json`

任务：

1. 将 `content_light` 迁移为 `content_base`。
2. 所有内置 canvas 的 replace 层清空。
3. 保留 `two_column_light`、`data_light` 作为可选模型。
4. 重新计算 registry locked hashes 和 manifest package hashes。
5. 不保留旧 `content_light.svg`；确认没有引用后直接删除。

验证：

- 默认模板仍可校验、复制和创建 SVG task。
- 选择普通内容页时使用 `content_base`。
- 模板目录没有旧 `content_light.svg` 或过期 hash。

### Phase 7：迁移当前测试模板

必须在代码和单元测试通过后执行。

要求：

1. 使用 Parent 记录的原 Template Agent；优先恢复 Agent ID `019f6a08-f017-79c0-80fb-937146f02709`。只有明确 `not_found` 才能创建替代 Worker。
2. 让原 Worker在当前 decision 中增加 `content_base`，只绑定 `chapter_marker` 或其他经视觉确认的跨页身份元素。
3. 保留 cover、contents、chapter、closing。
4. 漏斗、流程、数据表、三卡对比保留为可选专用模型，不作为 fallback。
5. 重新运行 builder、render、视觉对照、visual gate 和 Parent collect。
6. 重新生成 `/template` 人工审阅页；不得自动批准。

注意：

- 当前项目之前出现过 self-review SVG hash 落后于最终 builder 的问题。最终 builder 后再计算 self-review hashes，之后不得再次改写 canvas。
- 预览输出中若存在 registry 不再引用的旧 PNG，确认后删除，不得留作备份。

## 7. 测试修改清单

主要修改：

- `scripts/test/smoke_v2.py`

新增或调整以下断言：

1. `test_fidelity_template_component_handoff`
   - decision 包含 `content_base`。
   - canvas replace layer 为空。
   - apply 后内容成功写入，locked hash 仍有效。

2. `test_builtin_default_template_applies_executable_canvases`
   - 默认模板包含 `content_base`。
   - 原 `content_light` 不再存在。
   - 普通内容布局使用 `content_base`。

3. `test_fidelity_failure_modes`
   - 缺少 `content_base` 必须失败。
   - `content_base.required_components=[]` 仍必须失败。

4. 新增 `test_fidelity_canvas_has_empty_replace_layer`
   - 生成的每张 canvas replace layer 无可见或不可见子节点。

5. 新增 `test_svg_task_only_includes_selected_canvases`
   - 只传 batch 实际选择的 canvas。
   - 不传 profile、asset registry、components.svg 和未选 canvas。

6. 新增 `test_content_base_accepts_free_layout`
   - Layout taxonomy 可使用任意合适的 `layout_id`/wireframe，同时 `template_layout_id=content_base`。
   - SVG 可自由构建内容层并通过 fidelity validator。

7. 保留现有锁定层篡改测试。
   - 本次简化不能削弱 `FIDELITY_LOCKED_LAYER_MISMATCH`、required component 和 geometry/style 校验。

## 8. 验收标准

### 8.1 确定性验收

- [ ] 每个 fidelity registry 都有 `content_base`。
- [ ] `content_base.required_components` 非空。
- [ ] Builder 生成的所有 canvas replace 层为空。
- [ ] locked layer hash 校验仍然有效。
- [ ] 普通页面可使用任意 Layout taxonomy/wireframe，并以 `content_base` 作为模板 canvas。
- [ ] 专用模型未被 Layout 选择时，不进入 SVG task。
- [ ] SVG task 不含提取证据文件、components.svg、完整 profile 或未选 canvas。
- [ ] 默认模板和当前测试模板均完成迁移，无旧 `content_light.svg` 或陈旧预览。
- [ ] Template、Layout、SVG 的人工 review gate 保持有效。
- [ ] 原 Agent 返修原则未被破坏。

### 8.2 自动化验收

```bash
'/Users/ivan/.venvs/skills-py312/bin/python' \
  '02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell/scripts/test/smoke_v2.py'

'/Users/ivan/.venvs/skills-py312/bin/python' \
  '02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell/scripts/test/mece_scan_v2.py'

'/Users/ivan/.venvs/skills-py312/bin/python' \
  '/Users/ivan/.codex/skills/.system/skill-creator/scripts/quick_validate.py' \
  '02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell'
```

要求全部 exit code 0。不得通过删除测试或放宽现有 validator 获得通过。

### 8.3 真实项目验收

在 `V2PPTTest2` 重新构建模板后：

- [ ] 审阅页显示无黑灰占位内容的实际 canvas。
- [ ] `content_base` 一眼可识别模板身份，但不预设业务模型。
- [ ] 漏斗/流程/数据表/对比页明确为专用模型。
- [ ] template visual gate 为 `status=pass, issues=[]`。
- [ ] 用一个不匹配任何现有模型的内容页做 forward test，Layout 必须选择 `content_base`。
- [ ] SVG Worker只收到该页实际使用的 canvas，并能按 wireframe 自由设计内容。
- [ ] 渲染 PNG 通过视觉检查，validator 0 hard errors。

### 8.4 性能与复杂度验收

不设不可靠的固定秒数目标，使用结构指标：

- SVG task 的 canvas 数量等于当前 batch 使用的唯一 canvas 数量。
- SVG task 不再加载提取阶段文件。
- SVG Worker prompt 不再解释模板提取、候选审计和模型选择。
- 不新增独立 runtime 文件、重复合同或 legacy 分支。

## 9. 人类 Checkpoint

### Checkpoint A：新模板审阅

- 时机：当前测试模板重建并通过 visual gate 后。
- 展示：`/template` 审阅页，重点看 `content_base`、核心功能页和专用模型边界。
- 用户决定：批准、逐 layout 修改或整体退回。
- 保存：`template_feedback.json`。

### Checkpoint B：端到端普通内容页

- 时机：自动化测试通过后。
- 展示：一个不属于漏斗/流程/数据表/三卡对比的真实内容页，其 Layout Plan、SVG PNG 和 task input 摘要。
- 用户判断：页面是否保留模板身份，同时没有被旧模型框死。
- 反馈：返回原 Layout/SVG Worker，不在 Parent 中直接修改页面。

## 10. 删除与清理规则

每次删除前先用 `rg` 确认无引用；确认后直接删除，不创建备份副本。

本次预期删除：

- `scripts/template/layout_canvas.py` 中的 `abstract_content()`。
- 默认模板旧 `layout_canvases/content_light.svg`（完成迁移后）。
- 当前项目和默认模板中不再由 registry 引用的陈旧 canvas/preview。
- 因本次修改产生的 `__pycache__`、临时测试目录和无引用 import。

不得顺手删除与本次目标无关的既有文件。

## 11. 五种失败模式扫描

- Premature Completion：风险高。必须在当前模板 visual gate、人工审阅和普通内容页 forward test 完成后才宣布完成。
- Duplication：不新增 runtime 文件；同一选择规则只在 Layout workflow/contract 各保留必要的执行与 schema 表述。
- Sediment：删除 `abstract_content()`、旧 `content_light.svg` 和陈旧预览；不留 legacy fallback。
- Sprawl：SVG Worker不再读取提取证据和全部 canvas；Template 细节留在 Template workflow。
- No-op：所有新规则都有 builder/Parent/task input/test 或人工 review 对应检查，不写“尽量灵活”类空指令。

## 12. 新对话启动指令

建议把下面内容作为新对话首条指令：

```text
请使用 Planner's PPT Hell Skill，严格按
PPT-Skill-around/V2PPTTest2/Template-Runtime-Simplification-Handoff.md
执行模板运行时简化重构。

先跑 baseline，再按 Phase 1–7 顺序实施；遵循最小改动原则。不要新增第二套 registry、layout 分类字段、legacy fallback 或备份目录。每个 Phase 完成后运行对应验证。当前测试模板返修必须优先恢复 Parent 已记录的原 Template Agent，只有 not_found 才能替换。最终必须通过 smoke_v2、mece_scan_v2、quick_validate、当前模板 visual gate 和一个 content_base 真实 forward test；不要自动批准模板人工审阅。
```

## 13. 完成定义

只有同时满足以下条件才算完成：

1. 自动化测试全部通过。
2. 默认模板完成迁移并可正常应用。
3. 当前测试模板生成有效 `content_base`，visual gate 通过。
4. SVG task 输入确实缩小到最小运行时。
5. 普通内容页不会被业务模型框死。
6. 人工模板审阅已生成并等待用户决定。
7. 本次变更产生的旧文件和陈旧预览已清理。

