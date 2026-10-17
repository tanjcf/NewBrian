# MECE Simplification Report v2 (Corrected)

**Date**: 2026-07-09 | **Replaces**: `mece-simplification-report.md`

---

## Changes From v1

| Issue | v1 Problem | v2 Fix |
|-------|-----------|--------|
| Stale P0 | Recommended deleting 5 already-deleted files | Removed; marked "already completed" |
| Root refs misclassified | 5 root `references/*.md` labeled `compatibility` | Reclassified as `active_routed` with per-file action |
| Thin matrix | 8 columns, no ownership detail | 13 columns: inputs_owned, outputs_owned, rules_owned, scripts_called, contracts_called |
| Heuristic rule owners | Single `canonical_owner` field | Triple: `prose_owner` / `schema_owner` / `enforcement_owner` |
| Mixed completed/proposed | P0 included finished work | Separated into "Completed" and "Proposed" sections |

---

## Executive Summary

- **Baseline**: 15/15 smoke tests pass. 0 __pycache__. 0 .pyc. 0 deleted-file route references.
- **5 byte-identical old refs**: Already deleted in previous round ✅.
- **5 root active refs**: Migrated to `references/domain/` + `references/contracts/`; old root copies deleted.
- **Completed high-ROI simplifications**: Layout, Content, and SVG workers now use short workflow instructions with contract/domain pointers.
- **Remaining context risk**: no large P1 workflow context issue remains. The next simplification target is script-count and contract-field necessity, not more workflow prose.

---

## Already Completed (Do Not Re-execute)

| Action | Status | Verified |
|--------|--------|----------|
| Delete `references/03_style_system.md` | ✅ Done | `test -f` → absent |
| Delete `references/04_svg_rules.md` | ✅ Done | `test -f` → absent |
| Delete `references/05_layout_taxonomy.md` | ✅ Done | `test -f` → absent |
| Delete `references/page_content_contract.md` | ✅ Done | `test -f` → absent |
| Delete `references/layout_plan_contract.md` | ✅ Done | `test -f` → absent |
| Delete `scripts/__pycache__/` | ✅ Done | `find -type d -name __pycache__` → none |
| Unify route authority to `references/domain/` + `references/contracts/` | ✅ Done | `rg` scan → 0 old paths |
| Merge task generation (parent delegates to make_agent_task.py) | ✅ Done | Parent/direct output identical |
| Write `smoke_v2.py` (15 tests) | ✅ Done | 15/15 pass |
| Migrate 5 active root refs into `references/domain/` + `references/contracts/` | ✅ Done | smoke 15/15 + old route scan clean |
| Delete duplicate `scripts/template_analyzer.py` | ✅ Done | no production callers; smoke 15/15 |
| Compress `references/workflow/02_content_worker.md` active context | ✅ Done | 702 → 144 lines; smoke 15/15 |
| Compress `references/workflow/03_layout_worker.md` active context | ✅ Done | 892 → 275 lines; smoke 15/15 + layout-ready gate |
| Compress `references/workflow/04_svg_worker.md` active context | ✅ Done | 348 → 147 lines; smoke 15/15 + SVG split task schema valid |
| Compress `references/workflow/05_integrated_review_worker.md` active context | ✅ Done | 290 → 111 lines |
| Compress `references/workflow/06_repair_loop.md` active context | ✅ Done | 309 → 123 lines |
| Compress `references/workflow/07_visual_review.md` active context | ✅ Done | 362 → 133 lines |
| Remove dead `batch_learning_contract.md` and task injection | ✅ Done | active `batch_learning` refs → 0 |
| Localize active contracts to Chinese-first reading layer | ✅ Done | 12 active contracts, max 87 lines |

---

## Phase 2 (Corrected): Rule Duplication Index

20 rule families with triple owner classification. All in `mece-duplicate-rule-index-v2.json`.

**Key finding**: No semantic contradictions. All rules have identifiable prose, schema, and enforcement owners. Dead `batch_learning` was removed instead of implemented, keeping retrospective as the explicit user-confirmed learning path.

### Rules with weakest enforcement

| Rule | Enforcement | Risk |
|------|-----------|------|
| `retrospective_requires_confirmation` | `analyze_run.py` writes `requires_user_confirmation: true` | Low |
| `svg_repair_loop_limit` | `make_agent_task.py` sets `max_repair_rounds=2` | Low |

---

## Phase 3 (Corrected): Contract Boundary Audit

### Active root references migration status

| File | Previous Active Routes (rg evidence) | Final Route |
|------|---------------------------|-----------------|
| `references/06_quality_checklist.md` | `make_agent_task.py:405` (validate step input) | `references/domain/quality_checklist.md` ✅ |
| `references/integrated_review_contract.md` | `05_integrated_review_worker.md:21,169,184` | `references/contracts/integrated_review_contract.md` ✅ |
| `references/page_manifest_contract.md` | `make_agent_task.py:343` (template step contract) | `references/contracts/page_manifest_contract.md` ✅ |
| `references/revision_notes_contract.md` | `make_agent_task.py:514`, `05_integrated_review_worker.md:168` | `references/contracts/revision_notes_contract.md` ✅ |
| `references/self_review_contract.md` | `make_agent_task.py:402` (validate step contract) | `references/contracts/self_review_contract.md` ✅ |

All 5 were copied to the v2 route, production references were updated, smoke tests passed, and the old root copies were deleted.

---

## Phase 4 (Corrected): Workflow Compression

| File | Lines | Target | Main Issue |
|------|-------|--------|-----------|
| `03_layout_worker.md` | 275 | Done | Contract/taxonomy/example duplication removed |
| `02_content_worker.md` | 144 | Done | Contract/schema/example duplication removed |
| `04_svg_worker.md` | 147 | Done | SVG technical rules and repair detail moved back to contract/domain owners |
| `01_template_intake.md` | 188 | Done | Template schema and validation detail moved back to contract owner |
| `00_parent_orchestrator.md` | 287 | Done | Detailed state walkthroughs replaced by control-plane reference |
| `05_integrated_review_worker.md` | 111 | Done | Agent result boilerplate/examples removed |
| `06_repair_loop.md` | 123 | Done | Repair protocol reduced to task/input/output/boundary/stop/check |
| `07_visual_review.md` | 133 | Done | Review provenance and human checkpoint retained; boilerplate removed |

---

## Phase 5 (Corrected): Script Overlaps

| Overlap | Description | Surviving Owner |
|---------|------------|-----------------|
| `template_analyzer.py` ↔ `scripts/template/analyze_pptx_template.py` | Same PPTX analysis purpose | resolved: old script deleted; `analyze_pptx_template.py` is sole authority |
| `pptflow.py` ↔ `ppt_parent.py` | Both derive flow state | `ppt_parent.py` (v2); `pptflow.py` retains export + legacy status |
| `native_svg_to_ppt.py` ↔ `pptflow.py` | PPT conversion chain | Intentional: `pptflow.py` is gate, `native_svg_to_ppt.py` is engine |

No inactive scripts. All 21 Python scripts are routed or legacy-documented after validator consolidation.

---

## Phase 8 (Corrected): Proposed Action Plan

### P0: Active Route Inconsistency

| # | Action | Item | Risk | Tests |
|---|--------|------|------|-------|
| — | — | Complete | — | smoke_v2.py |

### P1: Large Context Reduction

| # | Action | Item | Est. Reduction |
|---|--------|------|---------------|
| P1-1 | COMPLETE | `03_layout_worker.md` active-context diet | 617 lines removed |
| P1-2 | COMPLETE | `02_content_worker.md` active-context diet | 558 lines removed |
| P1-3 | COMPLETE | `04_svg_worker.md` active-context diet | 201 lines removed |
| P1-4 | COMPLETE | `00_parent_orchestrator.md` control-plane diet | 369 lines removed |
| P1-5 | COMPLETE | `01_template_intake.md` active-context diet | 90 lines removed |
| P1-6 | COMPLETE | `05_integrated_review_worker.md` active-context diet | 179 lines removed |
| P1-7 | COMPLETE | `06_repair_loop.md` active-context diet | 186 lines removed |
| P1-8 | COMPLETE | `07_visual_review.md` active-context diet | 229 lines removed |

### P2: Contract Compression

| # | Action | Item | Est. Reduction |
|---|--------|------|---------------|
| P2-1 | COMPLETE | `agent_result_contract.md` compact executable contract | 579 lines removed |
| P2-2 | COMPLETE | `batch_learning_contract.md` removed as dead contract | 594 lines removed |
| P2-3 | COMPLETE | `repair_loop_contract.md` compact executable contract | 395 lines removed |
| P2-4 | COMPLETE | `agent_task_contract.md` compact executable contract | 373 lines removed |
| P2-5 | COMPLETE | content/layout/manifest/self-review/SVG contracts compacted | 775 lines removed |

### P3: Cleanup

| # | Action | Item |
|---|--------|------|
| P3-1 | LEGACY_HOLD | `template_analyzer.py` (after P0-2 merge confirmation) |
| P3-2 | DELETE_SEDIMENT | `scripts/__pycache__/` if regenerated |
| P3-3 | KEEP | `agents/openai.yaml` (OpenAI runtime config, not part of core Skill logic) |

---

## Recommended Execution Sequence

1. **Fresh script/contract scan**: Identify duplicate script responsibilities and unused contract fields.
2. **Owner-first deletion**: Delete or merge only when route ownership is explicit and smoke tests cover it.
3. **Final cleanup**: Remove regenerated caches and stale planning references.

---

## Owner Review Questions (Updated)

1. **Worst MECE offender**: `03_layout_worker.md` (893 lines, 3x target). Repeats domain taxonomy + contract schema.
2. **Biggest maintenance risk**: workflow references still restate generic `agent_result` / SHA256 / forbidden-write rules.
3. **Highest ROI simplification**: script-count reduction and contract-field diet.
4. **Do not touch**: `pipeline_gate.py`, `review_server.py`, `pptflow.py export`, `validate_svg_layout.py`, `native_svg_to_ppt.py`.
5. **Recommended next edit**: run an acceptance scan against script overlaps and unused contract fields before further deletion.
