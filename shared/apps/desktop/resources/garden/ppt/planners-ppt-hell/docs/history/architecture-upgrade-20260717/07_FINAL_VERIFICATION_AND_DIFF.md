# 最终验证与差异清单

## 边界与回滚

- 正式 Skill：`02 - skills-library/03-design-delivery/PlannerPPTSolution/planners-ppt-hell`，本轮全程只读。
- 候选版：`PPT-Skill-around/planners-ppt-hell-architecture-upgrade-staging-20260717`。
- 回滚边界：不需要恢复命令；在用户确认前不覆盖正式目录，直接丢弃 staging 即可回滚。

## 主线独立验证

- `smoke_v2.py`：PASS 40/40（修复 wireframe 适配器后重跑）。
- `mece_scan_v2.py`：PASS。
- Skill `quick_validate.py`：`Skill is valid!`。
- Test 模板 visual gate：首轮 10-layout PASS；用户反馈返修后最终 5-layout 再次 PASS，issues 为空。
- 真实 `content_base` forward：PASS；SVG task 只带 `content_base.svg`；title `(140,100)`、body `(140,270)` 与 Layout Plan wireframe 一致；validator errors 0；PNG 生成。
- 默认模板应用：PASS；内置包为 5 个真实 canvas，包含 `content_base`，不再包含伪别名 `two_column_light` / `data_light`；smoke 直接验证应用、最小 task、wireframe 坐标、locked/required validator。
- Server：`http://127.0.0.1:8772/health` 返回 running；`/template` 可用。
- 图片资源：源页 2–6 均为 HTTP 200 + `image/png` + 非零体积；`bg_01.jpeg`、`bg_02.jpeg`、`img_01.png` 也均 200。
- 真实浏览器：首轮 10-layout 页通过；最终返修页为 5 layout cards、5 inline canvases、5 Yes/No、5 单独反馈框、1 整体反馈框、1 模板名输入；0 broken images；0 console error/warn。
- 人工批准：未提交；Test 包仍为 `pending_review`。
- 受保护领域文档：`layout_taxonomy.md`、`style_system.md`、`svg_rules.md` 正式/候选 SHA-256 分别完全一致。
- 清理扫描：候选版无绝对项目路径、无 backup/bak 目录、无 `.pyc` / `__pycache__`、无 review fixture 残留。

## 新增文件

- `references/architecture.md`：维护者架构地图，不进入 Worker task。
- `scripts/test/forward_content_base_v2.py`：可重复的真实 `content_base` forward。
- `UPGRADE_IMPLEMENTATION_LOG.md`：Phase 1–7 实施与失败日志。
- 通用专用 canvas 最小 task 能力保留在独立 synthetic test fixture；不再依赖 Test 模板声称它们存在。
- 默认模板 `fidelity_template/canvas_previews/`：5 张页预览、manifest 与 contact sheet。

## 修改文件

### 入口、架构、合同与 workflow

- `SKILL.md`
- `references/contracts/agent_result_contract.md`
- `references/contracts/agent_task_contract.md`
- `references/contracts/layout_plan_contract.md`
- `references/contracts/template_profile_contract.md`
- `references/workflow/00_parent_orchestrator.md`
- `references/workflow/01_template_intake.md`
- `references/workflow/04_svg_worker.md`
- `references/workflow/08_retrospective.md`

### 运行时、Server、模板和导出

- `scripts/generate_template_review_html.py`
- `scripts/review_server.py`
- `scripts/render_svg_png.py`
- `scripts/validate_contracts.py`
- `scripts/orchestrate/collect_agent_results.py`
- `scripts/orchestrate/make_agent_task.py`
- `scripts/orchestrate/ppt_parent.py`
- `scripts/template/apply_fidelity_template.py`
- `scripts/template/build_fidelity_template.py`
- `scripts/template/extract_template_assets.py`
- `scripts/template/template_library.py`

### 测试

- `scripts/test/smoke_v2.py`
- `scripts/test/mece_scan_v2.py`

### Test 模板包

- `assets/template_library/Test-023ffae3/manifest.json`
- `assets/template_library/Test-023ffae3/template_profile.json`
- `assets/template_library/Test-023ffae3/template_asset_registry.json`
- `assets/template_library/Test-023ffae3/template_worker_result.json`
- `assets/template_library/Test-023ffae3/fidelity_template/components.svg`
- `assets/template_library/Test-023ffae3/fidelity_template/template_registry.json`
- `assets/template_library/Test-023ffae3/fidelity_template/layout_canvases/content_base.svg`
- `assets/template_library/Test-023ffae3/fidelity_template/canvas_previews/png_manifest.json`
- `assets/template_library/Test-023ffae3/fidelity_template/canvas_previews/full_deck_contact_sheet.png`

### 默认模板包

- `assets/template_library/planner-simple-default/manifest.json`
- `assets/template_library/planner-simple-default/template_profile.json`
- `assets/template_library/planner-simple-default/fidelity_template/template_registry.json`

## 删除/替换的旧文件

- Test 模板旧 canvas/preview 名：`cover.svg/png`、`contents.svg/png`、`chapter.svg/png`、`closing.svg/png`；分别由 `cover_red`、`contents_light`、`chapter_light`、`closing_red` 取代。
- Test 模板被拒绝且无引用的 `template_media/logo_01.png`–`logo_04.png`。
- 默认模板伪专用 canvas：`two_column_light.svg`、`data_light.svg`。
- 第一轮人工反馈拒绝的 Test 专用 canvas/预览：`content_hero`、`content_data`、`content_compare`、`content_funnel`、`content_process`；同时删除仅 hero 使用的 `img_01.png` 及所有不可达 component。
- 候选版中的全部 `.pyc` / `__pycache__`。

## 待用户的最后人工节点

1. 在 `http://127.0.0.1:8772/template` 审阅返修后的 5 个 Layout；每个选 Yes/No，可填单独反馈，并保留模板命名与整体反馈。
2. 批准提交后，再将 staging 与正式 Skill 做一次差异确认，由用户明确决定是否替换正式版。

## 残余风险

- 第一轮反馈已作为设计取舍执行，但删除 layout 使 package/HTML/hash 发生变化；最终 5-layout 包仍必须由用户给出新的人工批准。
- validator 的 O(T²) 比较和 renderer 的串行/固定等待是已记录的性能风险，本次为降低回归面没有改写；不影响当前正确性验收。
- 正式目录仍有历史 `__pycache__`；它们不会被带入 staging，但只有在用户批准正式替换后才会从正式 Skill 消失。
