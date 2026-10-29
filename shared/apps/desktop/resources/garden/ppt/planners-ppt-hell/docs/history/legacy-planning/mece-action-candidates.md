# MECE Action Candidates

> Generated: 2026-07-09 | Source: `scripts/test/mece_scan.py`

## Priority Legend

| Priority | Definition |
|----------|-----------|
| **P0** | Contradiction or active route confusion |
| **P1** | Repeated rule causing maintenance risk |
| **P2** | Large context reduction with low behavior risk |
| **P3** | Cleanup only |

---

## P0 Candidates

| # | Action Class | Item | Owner Now | Owner After | Reason | Expected Reduction | Risk | Required Tests | Approval |
|---|-------------|------|-----------|-------------|--------|-------------------|------|----------------|----------|
| P0-1 | MERGE_SCRIPT | `scripts/template_analyzer.py` vs `scripts/template/analyze_pptx_template.py` | Two scripts do same PPTX analysis | `scripts/template/analyze_pptx_template.py` | Byte-identical purpose; old script is legacy duplicate. New script has v2 contract output format. | Remove 1 script (~240 lines) | Old workflows referencing `template_analyzer.py` would break | smoke_v2.py + verify no imports | Yes |
| P0-2 | POINTER | `pptflow.py` vs `ppt_parent.py` both derive flow state | `pptflow.py` (legacy) + `ppt_parent.py` (v2) | `ppt_parent.py` is v2 authority | Two status/next derivation engines; `pptflow.py` is legacy, `ppt_parent.py` is v2. `pptflow.py export` must be kept. | Clarify roles only | Export path must remain through pptflow.py | smoke_v2.py status/next tests | Yes |
| P0-3 | DELETE_SEDIMENT | 5 byte-identical old references in `references/` root | `references/` root (legacy copies) | Delete; authority in `references/domain/` + `references/contracts/` | Already proven byte-identical; no active route references them; deleted in architecture-simplification-report Owner execution | Remove 5 files (~2,700 lines) | Zero — all active routes use new paths | smoke_v2.py T1 route test | Already approved |

## P1 Candidates

| # | Action Class | Item | Owner Now | Owner After | Reason | Expected Reduction | Risk | Required Tests | Approval |
|---|-------------|------|-----------|-------------|--------|-------------------|------|----------------|----------|
| P1-1 | MOVE_EXAMPLE | `02_content_worker.md` (703 lines) → target 300 lines | workflow | workflow + examples/ | 700+ lines for a worker reference; long examples, schema field repetition, and verbose rationale sections. Move examples to `references/examples/content_examples.md`. Keep: step purpose, inputs, outputs, completion criteria, key rules, contract pointers. | ~400 lines | Must keep copy policy rules (they are behavioral, not examples) | smoke_v2.py + verify content task generation still works | Yes |
| P1-2 | MOVE_EXAMPLE | `03_layout_worker.md` (893 lines) → target 350 lines | workflow | workflow + examples/ | Largest single reference. Layout taxonomy is duplicated from domain/. Long wireframe examples, full copy_handling walkthroughs. Move to examples. | ~540 lines | Must keep layout judgment rules (page_mode, density, anti-laziness) | smoke_v2.py + pipeline_gate layout-ready | Yes |
| P1-3 | MOVE_RULE | SVG technical rules repeated in `04_svg_worker.md` (349 lines) and `worker_svg_contract.md` (258 lines) | workflow + contract | contract owns rules; workflow points | Same forbidden elements (foreignObject, filter, use, style), same canvas rules, same metadata requirements appear in both. Contract should own; workflow should say "see worker_svg_contract.md". | ~200 lines from workflow | Must not weaken SVG worker discipline | smoke_v2.py + validate_svg_layout tests | Yes |
| P1-4 | POINTER | `template_profile_contract.md` (674 lines) — schema duplicated in `01_template_intake.md` (279 lines) | contract | contract owns schema; workflow points | Template intake workflow restates full schema fields. Replace with pointer: "Follow template_profile_contract.md schema." | ~150 lines from workflow | Must not lose extraction instructions unique to workflow | smoke_v2.py + validate_template_profile | Yes |
| P1-5 | POINTER | `agent_result_contract.md` (654 lines) — verbose examples | contract | contract + examples/ | Full Draft-07 JSON Schema inline is very long. Move long examples to `references/examples/agent_result_examples.md`. Keep: purpose, required fields table, validation rules. | ~300 lines | Must keep input_hashes requirement clear | smoke_v2.py + validate_agent_result | Yes |

## P2 Candidates

| # | Action Class | Item | Owner Now | Owner After | Reason | Expected Reduction | Risk | Required Tests | Approval |
|---|-------------|------|-----------|-------------|--------|-------------------|------|----------------|----------|
| P2-1 | POINTER | `00_parent_orchestrator.md` (657 lines) → target 400 lines | workflow | workflow | Contains detailed walkthroughs of every state; each could be "see step reference". Parent needs: role, entry point, gate table, human checkpoint rules, file permissions. | ~250 lines | Parent is the most critical role — must not lose control rules | smoke_v2.py all parent tests | Yes |
| P2-2 | MOVE_EXAMPLE | `batch_learning_contract.md` (595 lines) → target 350 lines | contract | contract + examples/ | Very detailed JSON Schema with full Draft-07. Move schema details to examples. Keep: purpose, required fields, rules (forbidden_changes, applied_constraints). | ~245 lines | Must keep constraint semantics clear | smoke_v2.py + batch learning scenario | Yes |
| P2-3 | POINTER | `repair_loop_contract.md` (460 lines) → target 350 lines | contract | contract | Full schema with all nested object definitions. Keep: repair_round, max_rounds, escalation conditions, fix_type enum. Move full schema to examples. | ~110 lines | Repair loop rules are safety-critical | smoke_v2.py + repair scenario | Yes |
| P2-4 | MERGE_SCRIPT | `validate_project_contracts.py` (413 lines) vs `scripts/validate/` validators | script | `scripts/validate/` | Cross-contract validator overlaps with single-contract validators. Consider splitting or clarifying which validates what. | Minimal | Cross-validation is useful for content↔layout↔manifest consistency | smoke_v2.py + validate_project_contracts | Yes |
| P2-5 | DELETE_NOOP | Old `references/` root files (`06_quality_checklist.md`, `page_manifest_contract.md`, `self_review_contract.md`, `integrated_review_contract.md`, `revision_notes_contract.md`) | references/ root | Keep if routed, else LEGACY_HOLD | 5 old contract files in references/ root. Not byte-identical duplicates (different from contracts/ files). Check if any active route references them. | ~2,400 lines if removable | Old scripts may still reference these paths | grep for references in scripts/ | Yes |

## P3 Candidates

| # | Action Class | Item | Owner Now | Owner After | Reason | Expected Reduction | Risk | Required Tests | Approval |
|---|-------------|------|-----------|-------------|--------|-------------------|------|----------------|----------|
| P3-1 | DELETE_NOOP | No-op prose in workflow references | Various | Workflow files | "ensure", "carefully", "high quality" — 3 candidates found (very low count; prose is mostly substantive). | Negligible | None — these are truly behaviorless | smoke_v2.py | No |
| P3-2 | LEGACY_HOLD | `scripts/template_analyzer.py` | scripts/ | LEGACY_HOLD until P0-1 | Duplicate of `scripts/template/analyze_pptx_template.py`. Keep until Owner confirms no external callers. | 240 lines | Unknown external callers | smoke_v2.py | Yes |
| P3-3 | MOVE_EXAMPLE | `agents/openai.yaml` | agents/ | Keep as-is or remove if not used | Agent config file for OpenAI runtime. Not part of core Skill logic. | 1 file | May be needed for OpenAI runtime | N/A | Yes |
| P3-4 | DELETE_SEDIMENT | `scripts/__pycache__/` and `*.pyc` | scripts/ | Exclude from bundle | Build artifacts | 12 files | Zero | find + smoke_v2.py | No |

---

## Summary

| Priority | Count | Estimated Total Reduction |
|----------|-------|--------------------------|
| P0 | 3 | ~2,940 lines + 1 script |
| P1 | 5 | ~1,590 lines |
| P2 | 5 | ~705 lines + clarify overlaps |
| P3 | 4 | ~240 lines + build artifacts |

**Total estimated reduction**: ~5,200+ lines across references, plus removal of 1 duplicate script and build artifacts.

**Key insight**: The largest MECE violations are not rule contradictions (rules are mostly well-owned). The main issues are:
1. **Content bloat**: workflow references are 2-3x larger than needed because they include full schemas and long examples
2. **Legacy sediment**: 5 byte-identical old refs + 1 duplicate script + 5 old contracts with unclear route status
3. **Overlap without conflict**: pptflow.py and ppt_parent.py both derive state — complementary rather than contradictory, but should be clarified
