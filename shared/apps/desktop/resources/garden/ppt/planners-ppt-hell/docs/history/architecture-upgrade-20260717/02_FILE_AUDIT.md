# 全文件审计与处置矩阵

状态：`KEEP` 保留；`FIX` 修改；`REBUILD` 由权威源重建；`DELETE` 无引用后删除；`PROTECT` 只验证不改；`GENERATED` 派生产物。

## 顶层与 Agent 配置

| 文件 | 作用 | 判断 | 处置 |
|---|---|---|---|
| `SKILL.md` | 激活、控制边界、角色路由 | 有效但四维模板反馈、运行时描述陈旧；缺少架构维护入口 | FIX |
| `agents/openai.yaml` | Codex 展示/调用元数据 | 有效；需检查描述是否仍与更新后的 Skill 一致 | KEEP/FIX-if-needed |

## Contracts（8/8）

| 文件 | 判断 | 处置 |
|---|---|---|
| `references/contracts/agent_task_contract.md` | 单一 task 合同有效；需明确 deterministic result metadata 由模板完整提供 | FIX |
| `references/contracts/agent_result_contract.md` | Collector 实际权威；“只填 status/summary”与缺失 metadata 模板矛盾 | FIX |
| `references/contracts/page_content_contract.md` | 内容事实源边界清晰 | KEEP |
| `references/contracts/layout_plan_contract.md` | wireframe/final copy/template layout 权威清晰 | KEEP，补充 `content_base` fallback 的机器可验收语句 |
| `references/contracts/page_manifest_contract.md` | 单一稳定索引、无第二状态机 | KEEP |
| `references/contracts/template_profile_contract.md` | 混合视觉方向、结构证据、旧 binding 运行时模型；过度承载 | FIX：保留提取/审计，删除作为 SVG施工输入的语义 |
| `references/contracts/worker_svg_contract.md` | 已符合最小运行时与已选 canvas | KEEP，作为冲突收敛目标 |
| `references/contracts/retrospective_contract.md` | 不自动修改 Skill/memory | KEEP |

## Workflow（7/7）

| 文件 | 判断 | 处置 |
|---|---|---|
| `references/workflow/00_parent_orchestrator.md` | 控制流程总体有效；四维反馈陈旧；serial/Parent执行表述需与 task role 统一 | FIX |
| `references/workflow/01_template_intake.md` | visual-first、canvas、content_base 有效；人工反馈描述仍旧 | FIX |
| `references/workflow/02_content_worker.md` | 职责清晰；result metadata 依赖手写 | FIX result 提交流程，不改内容规则 |
| `references/workflow/03_layout_worker.md` | `content_base` 默认与专用模型精确匹配规则正确 | KEEP/加强可测试条件 |
| `references/workflow/04_svg_worker.md` | 前半符合最小 task；后半完整 profile binding/资产/装饰规则与 task 直接冲突 | FIX，删除旧施工模型，不引入 fallback |
| `references/workflow/07_visual_review.md` | 全 deck 审阅与原 Agent修订有效 | KEEP |
| `references/workflow/08_retrospective.md` | 有效，但当前不在主状态机自动完成定义中 | KEEP，架构中标明触发边界 |

## Domain（4/4）

| 文件 | 判断 | 处置 |
|---|---|---|
| `references/domain/layout_taxonomy.md` | Layout 思考权威 | PROTECT |
| `references/domain/style_system.md` | SVG 视觉权威 | PROTECT |
| `references/domain/svg_rules.md` | SVG/PPT 技术与警告处置权威 | PROTECT |
| `references/domain/quality_checklist.md` | 审阅严重度映射有效，但命名引用旧编号需检查 | KEEP/FIX only broken cross-reference |

## 控制、审阅与通用脚本

| 文件 | 唯一职责 | 主要发现 | 处置 |
|---|---|---|---|
| `scripts/init_svg_project.py` | 原子创建项目骨架与 manifest | 有效 | KEEP |
| `scripts/orchestrate/ppt_parent.py` | 单一状态派生/调度/审阅/导出控制平面 | 总体有效；文案/门禁需随新合同同步；继续保持 thin Parent | FIX |
| `scripts/orchestrate/make_agent_task.py` | 最小 task 生成器 | SVG输入正确；result 模板缺 `input_hashes`/revision feedback hash | FIX |
| `scripts/orchestrate/collect_agent_results.py` | 唯一 result 收集与严格校验 | 有效；需要与生成模板共享相同字段定义，避免双写漂移 | FIX without weakening |
| `scripts/review_server.py` | 健康 Server 与反馈原子写入/provenance | 四维 `valid_dimensions` 为死逻辑；错误提示与当前 UX 不一致 | FIX |
| `scripts/generate_template_review_html.py` | 生成逐 layout 模板审阅页 | 三份同名 JS 函数覆盖；四维变量/CSS/JS 残留；整体反馈行为不统一 | REWRITE surgically |
| `scripts/generate_layout_html.py` | 全 deck Layout/copy/wireframe 审阅 | 有效；需回归逐页批准/反馈 | KEEP |
| `scripts/generate_review_html.py` | 全 deck PNG/validation/self-review 审阅 | 有效；阻断 warning 分类需与 validator 一致 | KEEP/FIX only shared blocker policy |
| `scripts/render_svg_png.py` | 渲染 batch/full deck/contact sheet | 有效；正式预览与临时 Worker预览边界清楚 | KEEP |
| `scripts/estimate_layout_capacity.py` | Layout 容量诊断 | 有效；不应被 SVG阶段替代 | KEEP |
| `scripts/validate_contracts.py` | 内容/Layout/manifest/template/self-review 合同验证 | 有效；同步新 profile 运行时边界 | FIX |
| `scripts/validate_svg_layout.py` | SVG/PPT、文字、模板 hash/components 门禁 | 核心门禁必须保留；只补测试，不削弱 | PROTECT/FIX tests-first |
| `scripts/native_svg_to_ppt.py` | 可编辑 PPTX 转换 | Parent env gate 有效 | KEEP |
| `scripts/requirements.txt` | 最小 Python 依赖 | 需与 import 实况核对 | KEEP/FIX-if-drift |
| `scripts/retrospective/analyze_run.py` | 只读运行复盘与候选建议 | 有效；会读 profile 做摘要，不是 SVG运行时扩张 | KEEP |

## 模板脚本

| 文件 | 判断 | 处置 |
|---|---|---|
| `scripts/template/prepare_visual_references.py` | 模板视觉证据准备 | KEEP |
| `scripts/template/extract_template_assets.py` | PPTX/XML 候选提取；仍写 usage_policy 旧字段 | FIX：候选只作审计，不生成 SVG binding |
| `scripts/template/build_fidelity_template.py` | Worker决策→单一 registry/components/canvases | KEEP/FIX，确保 content_base 与空 replace，专用模型只由显式选择产生 |
| `scripts/template/layout_canvas.py` | canvas 生成与 locked hash canonicalization | KEEP；hash 门禁不得削弱 |
| `scripts/template/template_visual_gate.py` | 源页/canvas覆盖、must-fix、hash 门禁 | KEEP |
| `scripts/template/template_library.py` | 发布、校验、应用模板包 | FIX 绝对路径/派生预览发布规则；保持单一 library |
| `scripts/template/apply_fidelity_template.py` | 应用模板到项目 | KEEP；增加默认模板真实 forward 回归 |

## 测试

| 文件 | 判断 | 处置 |
|---|---|---|
| `scripts/test/smoke_v2.py` | 36 个 smoke；覆盖面广但固化四维反馈和部分历史行为；有些 fixture 使用不完整 result | FIX：替换旧断言、增加真实 contract/result/content_base/runtime payload/UX tests |
| `scripts/test/mece_scan_v2.py` | 扫描边界/重复概念 | KEEP，扩展 architecture/legacy terms 检查 |

## Test-023ffae3 模板包（27/27）

| 文件 | 判断 | 处置 |
|---|---|---|
| `manifest.json` | 发布包 hash 权威；当前有效 | REBUILD after any asset change |
| `template_profile.json` | 提取审计与视觉方向；含旧 usage policy | FIX/REBUILD package |
| `template_asset_registry.json` | 37 个候选全审计；有效 | KEEP |
| `template_worker_result.json` | 当前包只剩 4 个批准组件、5 个 layout；与旧项目 27 components/10 layouts 的已完成视觉自检不一致 | REBUILD，恢复有证据的可选模型并重新人工审阅 |
| `contact_sheet.png` | 源模板视觉证据摘要 | KEEP |
| `fidelity_template/template_registry.json` | 单一运行时 registry；有 `content_base` | KEEP/REBUILD hashes |
| `fidelity_template/components.svg` | Builder审计产物；不进 SVG task | KEEP |
| `layout_canvases/cover.svg` | 书挡视觉身份，replace 空 | KEEP |
| `layout_canvases/contents.svg` | 淡色背景，replace 空 | KEEP |
| `layout_canvases/chapter.svg` | 淡色背景，replace 空 | KEEP |
| `layout_canvases/content_base.svg` | 开放基础页，只锁身份 pill，replace 空 | KEEP，真实 forward 必测 |
| `layout_canvases/closing.svg` | 书挡视觉身份，replace 空 | KEEP |
| `canvas_previews/png_manifest.json` | 含旧项目绝对路径，不可移植 | REBUILD 相对路径 |
| `canvas_previews/full_deck_contact_sheet.png` | canvas 派生证据 | REBUILD |
| `canvas_previews/pages/cover.png` | canvas 派生证据 | REBUILD |
| `canvas_previews/pages/contents.png` | canvas 派生证据 | REBUILD |
| `canvas_previews/pages/chapter.png` | canvas 派生证据 | REBUILD |
| `canvas_previews/pages/content_base.png` | canvas 派生证据 | REBUILD |
| `canvas_previews/pages/closing.png` | canvas 派生证据 | REBUILD |
| `template_media/bg_01.jpeg` | 批准的书挡背景，canvas引用 | KEEP |
| `template_media/bg_02.jpeg` | 批准的淡色背景，canvas引用 | KEEP |
| `template_media/img_01.png` | 批准但当前五 canvas 未引用的可选内容图 | VERIFY runtime need; delete only if registry/component/package无引用 |
| `template_media/logo_01.png` | 已明确 rejected，但 profile审计仍引用 | KEEP as audit evidence unless package policy retires rejected media |
| `template_media/logo_02.png` | 同上 | KEEP/decide one policy |
| `template_media/logo_03.png` | 同上 | KEEP/decide one policy |
| `template_media/logo_04.png` | 同上 | KEEP/decide one policy |

专用模型说明：源模板候选中确有 table/funnel/process/compare 几何。旧项目 `planners-ppt-output/_internal/00_project/` 还保留 10-layout registry、27 个 approved components 以及全部 `canvas_png_reviewed:true / usable:true / visual_similarity:pass / must_fix:[]` 的自检记录，说明当前 asset registry 的批量 rejected 是后续简化造成的错误退休。staging 应从这些证据恢复可选模型、重建包并生成新的人工审阅页；验收同时证明“未选不进 SVG task”。

## planner-simple-default 模板包（14/14）

| 文件 | 判断 | 处置 |
|---|---|---|
| `manifest.json` | 默认模板发布包权威 | REBUILD after changes |
| `template_profile.json` | 内置方向；`usage_policy.binding` 与新运行时语义不一致 | FIX |
| `template_asset_registry.json` | 内置资产审计 | KEEP |
| `template_worker_result.json` | 内置决策 | KEEP/FIX schema alignment |
| `fidelity_template/template_registry.json` | 单一 registry，7 layouts + content_base | KEEP |
| `fidelity_template/components.svg` | Builder产物，不进 SVG task | KEEP |
| `layout_canvases/cover_dark.svg` | 核心功能页 | KEEP |
| `layout_canvases/contents_light.svg` | 核心功能页 | KEEP |
| `layout_canvases/section_dark.svg` | 核心功能页 | KEEP |
| `layout_canvases/content_base.svg` | 默认开放基础页，replace 空 | KEEP，真实 forward 必测 |
| `layout_canvases/two_column_light.svg` | 可选专用结构页 | KEEP，仅精确匹配时选 |
| `layout_canvases/data_light.svg` | 可选数据页 | KEEP，仅精确匹配时选 |
| `layout_canvases/closing_dark.svg` | 核心功能页 | KEEP |

## 运行缓存（7/7）

以下均为 Python 运行派生物，无运行时引用，staging 直接删除，不保留备份：

- `scripts/__pycache__/generate_template_review_html.cpython-312.pyc`
- `scripts/__pycache__/review_server.cpython-312.pyc`
- `scripts/orchestrate/__pycache__/collect_agent_results.cpython-312.pyc`
- `scripts/orchestrate/__pycache__/ppt_parent.cpython-312.pyc`
- `scripts/template/__pycache__/layout_canvas.cpython-312.pyc`
- `scripts/template/__pycache__/template_library.cpython-312.pyc`
- `scripts/template/__pycache__/template_visual_gate.cpython-312.pyc`

## 数量闭合

- 顶层/Agent：2
- Contracts：8
- Workflow：7
- Domain：4
- Python/requirements/tests（不含 pyc）：22
- Test 模板包：27
- 默认模板包：14
- pyc：7
- 合计：2 + 8 + 7 + 4 + 22 + 27 + 14 + 7 = 91，与磁盘实际文件数一致。最终实施前由机器 inventory 再次按路径去重验收。
