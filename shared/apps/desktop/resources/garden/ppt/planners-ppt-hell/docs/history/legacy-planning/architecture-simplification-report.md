# Architecture Simplification Report

**Date**: 2026-07-09
**Scope**: Planner's PPT Hell v2 progressive simplification (6 phases)
**Agent Role**: 测试 Agent（诊断 + 修复 + 候选建议，不执行删除）

---

## Executive Summary

v2 架构方向正确。通过 6 个 Phase 的渐进式简化：
- 统一了路由权威（消除新旧路径混用）
- 合并了 task 生成权力（单一 schema 来源）
- 识别了 5 组字节级重复文件
- 标记了 6 个 oversized reference
- 发现了 3 类发布包沉积

15/15 smoke tests 全部通过，无回归。

---

## Simplified Architecture

### Parent Responsibilities
- 状态推导（`derive()` → `status/next --json`）
- 审阅环境诊断（`preflight-layout-review --json`）
- Task 生成（委托给 `make_agent_task.py`，不内置 schema）
- Result 收集（委托给 `collect_agent_results.py`）
- Gate 协调（调用 `pipeline_gate.py`）
- Export 协调（调用 `pptflow.py export`）

### Worker Responsibilities
- Content Worker：源 Markdown → `page_content.json`
- Layout Worker：`page_content.json` + layout taxonomy → `layout_plan.json`
- SVG Worker：裁剪后的单页 content/layout + style/svg rules → `page_XX.svg`
- Review Worker：validator + PNG → `integrated_review.json`
- Repair Worker：修复 SVG（max 2 rounds）
- Retrospective Worker：运行分析 → 候选建议

### Script Responsibilities
| Script | 唯一职责 |
|--------|----------|
| `ppt_parent.py` | 状态、分发、preflight、gate 协调 |
| `make_agent_task.py` | **Task schema 唯一生成者** |
| `collect_agent_results.py` | **Result 收集唯一入口** |
| `validate_agent_result.py` | **Schema 验证唯一入口** |
| `pipeline_gate.py` | Gate 执行（7 gates） |
| `pptflow.py` | Export 唯一路径 |
| `review_server.py` | 人工审批唯一入口 |
| `generate_layout_html.py` | Layout 审阅 HTML + 错误文件 |
| `analyze_run.py` | Retrospective 分析 |

### Contract Responsibilities
| Contract | 权威内容 |
|----------|----------|
| `agent_task_contract.md` | Task JSON schema |
| `agent_result_contract.md` | Result JSON schema（含 input_hashes 必填） |
| `page_content_contract.md` | Content JSON schema |
| `layout_plan_contract.md` | Layout JSON schema |
| `worker_svg_contract.md` | SVG 技术约束 |
| `template_profile_contract.md` | Template profile schema |
| `repair_loop_contract.md` | Repair tracking schema |
| `batch_learning_contract.md` | Batch learning schema |
| `retrospective_contract.md` | Retrospective output schema |

---

## Phase-by-Phase Results

### Phase 0: Smoke Test Baseline ✅
- 15 tests covering routes, parent JSON, schema validation, SVG split-pages, layout errors, server metadata, retrospective, SKILL.md frontmatter
- 15/15 passed

### Phase 1: Single Route Authority ✅
- Fixed 4 old paths in `make_agent_task.py`
- Fixed 8 wrong domain paths in 3 workflow reference files
- Zero old/wrong paths remaining in active code
- Smoke tests: 15/15

### Phase 2: Merge Task Generation ✅
- `ppt_parent.py make-task` now delegates to `make_agent_task.py` via subprocess
- Parent output matches direct script output (contract, input_files, output_files, step all identical)
- Task schema now has single source of truth
- Smoke tests: 15/15

### Phase 3: Duplicate Reference Analysis
- 5 byte-level duplicate pairs identified
- Active route uses new paths (`references/domain/`, `references/contracts/`)
- Old paths are compatibility_hold only
- **Candidate cleanup deferred to Owner**

### Phase 4: Worker Reference Compression Analysis
- 6 files exceed 400-line target:
  - `03_layout_worker.md` (892 lines)
  - `02_content_worker.md` (702 lines)
  - `template_profile_contract.md` (673 lines)
  - `00_parent_orchestrator.md` (656 lines)
  - `agent_result_contract.md` (653 lines)
  - `batch_learning_contract.md` (594 lines)
- Recommendation: move examples to `references/examples/`, keep active workflow to schema + rules + completion criteria
- **Candidate restructuring deferred to Owner**

### Phase 5: Package Sediment Analysis
- `scripts/__pycache__/` (12 .pyc files) → exclude from bundle
- `examples/minimal_deck_work/` → exclude from bundle (test artifact)
- `../backups/` → exclude from bundle (keep in repo only)
- **Cleanup deferred to Owner**

---

## Removed / Moved

| Item | Action | Reason |
|------|--------|--------|
| Old paths in `make_agent_task.py` | Fixed to v2 paths | Route unification |
| Wrong `references/domain/0X_*.md` in workflow docs | Fixed to `references/domain/*.md` | Route unification |
| Duplicate task schema in `ppt_parent.py` | Replaced with delegation to `make_agent_task.py` | Single source of truth |

---

## Active Route Table

| Step | References | Scripts | Outputs |
|------|-----------|---------|---------|
| 0 Init | `00_parent_orchestrator.md` | `init_svg_project.py` | project scaffold |
| 1 Template | `01_template_intake.md`, `template_profile_contract.md` | `analyze_pptx_template.py` | `template_profile.json` |
| 2 Content | `02_content_worker.md`, `page_content_contract.md` | `make_agent_task.py` | `page_content.json`, `agent_result.json` |
| 3 Layout | `03_layout_worker.md`, `layout_taxonomy.md`, `layout_plan_contract.md` | `make_agent_task.py`, `estimate_layout_capacity.py`, `generate_layout_html.py` | `layout_plan.json`, `01_layout_direction.html` |
| 4 Draft | `04_svg_worker.md`, `style_system.md`, `svg_rules.md`, `worker_svg_contract.md` | `make_agent_task.py --split-pages` | `page_XX.svg` (per-page) |
| 5 Validate | `05_integrated_review_worker.md` | `render_svg_png.py`, `validate_svg_layout.py` | `validation_summary.json`, `integrated_review.json` |
| 6 Repair | `06_repair_loop.md`, `repair_loop_contract.md` | — | `revision_notes.json`, fixed SVGs |
| 7 Visual | `07_visual_review.md` | `generate_review_html.py`, `review_server.py` | `02_visual_review.html`, `feedback.json` |
| 8 Learning | `batch_learning_contract.md` | — | `batch_learning_notes.json` |
| 9 Export | — | `pptflow.py export` | `final_deck.pptx` |
| 10 Retro | `08_retrospective.md`, `retrospective_contract.md` | `analyze_run.py` | `run_summary.json`, `default_suggestions.md`, `memory_candidates.json` |

---

## Failure Mode Scan (Post-Simplification)

| Mode | Risk | Status |
|------|------|--------|
| Premature Completion | Low | `agent_result.json` + SHA256 + `input_hashes` + `collect_agent_results.py` rejection |
| Duplication | Low | Single route authority (Phase 1), single task schema (Phase 2). 5 duplicate files are passive copies, not active confusion |
| Sediment | Medium | Old references still present as compatibility_hold. Phase 3 candidates identified but not executed |
| Sprawl | Medium | 6 oversized references. Phase 4 compression candidates identified but not executed |
| No-op | Low | All critical rules enforced via scripts + contracts, not prose |

---

## Owner Cleanup Execution

Owner review completed. The following deletion scope was approved and executed after verifying:
- all active routes use `references/domain/` and `references/contracts/`
- no active code/doc route references the old five paths
- each old file is byte-identical to its v2 authority copy

### Deleted Duplicate Files (Phase 3)
| File | Action | Reason |
|------|--------|--------|
| `references/03_style_system.md` | deleted | Byte-identical to `references/domain/style_system.md`; old route no longer active |
| `references/04_svg_rules.md` | deleted | Byte-identical to `references/domain/svg_rules.md`; old route no longer active |
| `references/05_layout_taxonomy.md` | deleted | Byte-identical to `references/domain/layout_taxonomy.md`; old route no longer active |
| `references/page_content_contract.md` | deleted | Byte-identical to `references/contracts/page_content_contract.md`; old route no longer active |
| `references/layout_plan_contract.md` | deleted | Byte-identical to `references/contracts/layout_plan_contract.md`; old route no longer active |

### Oversized References (Phase 4)
| File | Lines | Suggested Action | Target |
|------|-------|-----------------|--------|
| `03_layout_worker.md` | 892 | Move examples to `references/examples/layout_examples.md` | ≤350 |
| `02_content_worker.md` | 702 | Move examples to `references/examples/content_examples.md` | ≤300 |
| `template_profile_contract.md` | 673 | Keep schema, move verbose explanations to examples | ≤400 |
| `00_parent_orchestrator.md` | 656 | Extract detailed walkthrough to examples | ≤400 |
| `agent_result_contract.md` | 653 | Move verbose examples to `references/examples/agent_result_examples.md` | ≤350 |
| `batch_learning_contract.md` | 594 | Extract example section | ≤350 |

### Package Sediment (Phase 5)
| Item | Action | Reason |
|------|--------|--------|
| `scripts/__pycache__/` | deleted | Build cache; not Skill source |
| `scripts/**/*.pyc` | verified absent | Compiled cache; already covered by `.gitignore` |
| `../examples/minimal_deck_work/` | kept in repo, exclude from release bundle | Smoke test fixture; useful for regression testing |
| `../backups/` | kept in repo, exclude from release bundle | Original version backup required by Owner |

---

## Test Results (Final)

```
=== Planner's PPT Hell v2 Smoke Tests ===
T1: Route files              ✅
T2: parent status/next/preflight JSON  ✅✅✅
T3: Schema validation        ✅✅
T4: content/layout gate      ✅✅
T5: SVG per-page split       ✅✅
T6: layout_html_errors       ✅
T7: review_server metadata   ✅
T8: Retrospective            ✅
T9: SKILL.md frontmatter     ✅
T10: collect_agent_results   ✅
Results: 15 passed, 0 failed, 15 total
✅ ALL TESTS PASSED
```

---

## Stop / Continue Recommendation

**RECOMMENDATION: CONTINUE WITH REFERENCE COMPRESSION ONLY AFTER A SEPARATE DESIGN PASS**

已完成：
1. 5 个 byte-identical duplicate references 已删除
2. `scripts/__pycache__/` 已删除，`.pyc` 当前无残留
3. `examples/minimal_deck_work/` 保留为 smoke test fixture
4. `backups/` 保留为原版本备份

剩余工作：
1. 6 个 oversized references 仍建议压缩，但这属于内容结构设计，不应和删除缓存/重复入口混在同一轮做
2. 发布包规则应明确排除 `examples/minimal_deck_work/` 与 `backups/`
3. 每次压缩 reference 后都必须跑 `scripts/test/smoke_v2.py`

当前状态：架构已简化，路由统一，schema 权威单一；重复旧入口和缓存沉积已清理。剩余工作是 reference 内容压缩，而不是路由重构。
