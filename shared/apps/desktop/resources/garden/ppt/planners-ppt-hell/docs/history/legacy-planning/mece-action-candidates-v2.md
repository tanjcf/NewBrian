# MECE Action Candidates v2 (Corrected)

> Replaces `mece-action-candidates.md`. Separates completed from proposed. All stale references removed.

---

## Already Completed (Verified Absent)

| # | Action | Item | Verified |
|---|--------|------|----------|
| C-1 | DELETE | `references/03_style_system.md` | `test -f` → absent ✅ |
| C-2 | DELETE | `references/04_svg_rules.md` | `test -f` → absent ✅ |
| C-3 | DELETE | `references/05_layout_taxonomy.md` | `test -f` → absent ✅ |
| C-4 | DELETE | `references/page_content_contract.md` | `test -f` → absent ✅ |
| C-5 | DELETE | `references/layout_plan_contract.md` | `test -f` → absent ✅ |
| C-6 | DELETE | `scripts/__pycache__/` | `find` → none ✅ |
| C-7 | UNIFY | Route authority → `references/domain/` + `references/contracts/` | `rg` scan → 0 old paths ✅ |
| C-8 | MERGE | Task generation: parent delegates to make_agent_task.py | Parent/direct output identical ✅ |
| C-9 | MIGRATE | `references/06_quality_checklist.md` → `references/domain/quality_checklist.md` | smoke 15/15 + old route scan clean ✅ |
| C-10 | MIGRATE | `references/integrated_review_contract.md` → `references/contracts/integrated_review_contract.md` | smoke 15/15 + old route scan clean ✅ |
| C-11 | MIGRATE | `references/page_manifest_contract.md` → `references/contracts/page_manifest_contract.md` | smoke 15/15 + old route scan clean ✅ |
| C-12 | MIGRATE | `references/revision_notes_contract.md` → `references/contracts/revision_notes_contract.md` | smoke 15/15 + old route scan clean ✅ |
| C-13 | MIGRATE | `references/self_review_contract.md` → `references/contracts/self_review_contract.md` | smoke 15/15 + old route scan clean ✅ |
| C-14 | DELETE | old root copies for the five migrated refs | `find references -maxdepth 2` confirms only v2 routes remain ✅ |
| C-15 | DELETE | `scripts/template_analyzer.py` | no production callers; v2 authority is `scripts/template/analyze_pptx_template.py` ✅ |
| C-16 | COMPRESS | `references/workflow/02_content_worker.md` active-context diet | 702 → 144 lines; smoke 15/15 ✅ |
| C-17 | COMPRESS | `references/workflow/03_layout_worker.md` active-context diet | 892 → 275 lines; smoke 15/15 + layout-ready gate ✅ |
| C-18 | COMPRESS | `references/workflow/04_svg_worker.md` active-context diet | 348 → 147 lines; smoke 15/15 + SVG split task schema valid ✅ |
| C-19 | COMPRESS | `references/workflow/01_template_intake.md` active-context diet | 278 → 188 lines; smoke 15/15 ✅ |
| C-20 | MERGE | validator scripts → `scripts/validate_contracts.py` | project/template/self-review modes; Python scripts 23 → 21; smoke 17/17 ✅ |
| C-21 | COMPRESS | contract layer active-context diet | 13 contracts: 4,250 → 999 lines; smoke 17/17 + layout-ready gate ✅ |
| C-22 | COMPRESS | `references/workflow/00_parent_orchestrator.md` control-plane diet | 656 → 287 lines; smoke 17/17 + layout-ready gate ✅ |
| C-23 | COMPRESS | `references/workflow/05_integrated_review_worker.md` review-worker diet | 290 → 111 lines; removed agent_result boilerplate/examples ✅ |
| C-24 | COMPRESS | `references/workflow/06_repair_loop.md` repair-loop diet | 309 → 123 lines; task/input/output/boundary/stop/check structure ✅ |
| C-25 | COMPRESS | `references/workflow/07_visual_review.md` visual-review diet | 362 → 133 lines; retained only human checkpoint/provenance boundaries ✅ |
| C-26 | DELETE | `references/contracts/batch_learning_contract.md` dead contract | active refs 0; retrospective remains explicit/user-confirmed ✅ |
| C-27 | LOCALIZE | contracts Chinese reading layer | 12 active contracts now Chinese-first; English schema boilerplate removed ✅ |

---

## Proposed Actions (Requiring Owner Approval)

### P0: Active Route Inconsistency

| # | Action Class | Item | Current Owner | Target Owner | Reason | Risk | Tests | Approval |
|---|-------------|------|---------------|-------------|--------|------|-------|----------|
| — | — | No remaining P0 route/script authority issue | — | — | P0-1 and P0-2 completed | — | smoke_v2.py | — |

### P1: Large Context Reduction

| # | Action Class | Item | Current Lines | Target | Reduction | Risk | Tests | Approval |
|---|-------------|------|--------------|--------|-----------|------|-------|----------|
| — | — | No remaining P1 workflow context issue | — | — | Complete | — | smoke_v2.py | — |

### P2: Contract Compression

| # | Action Class | Item | Current Lines | Target | Reduction | Risk | Tests | Approval |
|---|-------------|------|--------------|--------|-----------|------|-------|----------|
| — | — | No remaining P2 contract compression issue | — | — | Complete | — | smoke_v2.py | — |

### P3: Cleanup

| # | Action Class | Item | Risk | Tests | Approval |
|---|-------------|------|------|-------|----------|
| P3-2 | DELETE_SEDIMENT | `scripts/__pycache__/` if regenerated | Zero | find | No |
| P3-3 | KEEP | `agents/openai.yaml` (OpenAI runtime config) | N/A | N/A | No |

---

## Summary

| Priority | Count | Total Estimated Reduction |
|----------|-------|--------------------------|
| P0 (route fix) | 0 | Complete |
| P1 (context reduction) | 0 | Complete |
| P2 (contract compression) | 0 | Complete |
| P3 (cleanup) | 2 | Minimal |

**Recommended next edit**: run a fresh MECE scan focused on script-count and contract-field necessity; do not add new mechanisms unless a live route requires them.
