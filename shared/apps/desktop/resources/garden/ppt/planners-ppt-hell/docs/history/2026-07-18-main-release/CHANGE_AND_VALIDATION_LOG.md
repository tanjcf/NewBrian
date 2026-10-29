# 2026-07-18 main release — change and validation log

## Scope decision

This release treats the R2 single-Controller pipeline as the usable main version. It intentionally does not add visual-quality gates, compensate for model vision capability, or expand subagent audit. The changes are limited to deterministic flow, task contracts, completion state, release documentation, and rollback packaging.

## Deterministic flow fixes

1. Revision task input/output collision removed.
   - Layout revisions freeze the previous `layout_plan.json` under task inputs.
   - Template revisions freeze existing semantic outputs under task inputs.
   - SVG revisions freeze previous page SVGs under task inputs.
   - Live production paths are output-only, and task construction rejects exact input/output overlap.
2. Stage completion is current-state bound.
   - The latest successful event must match the current task hash.
   - Every declared output must exist and match its recorded hash.
   - Revision feedback hash must match where applicable.
3. Repeated SVG finalize is idempotent.
   - An unchanged task with unchanged outputs, page PNGs, and contact sheet returns `already_complete: true`.
   - It does not rerun rendering or append duplicate `stage_completed` events.
4. Layout-to-SVG structural execution trace added.
   - Each non-background wireframe region must appear as an exact `data-wireframe-label` on an SVG element/group.
   - Missing regions are aggregated into one hard issue per page.
   - No geometry or visual-quality judgment was added.
5. Template task now declares exact rendered source page IDs, reducing metadata naming ambiguity.

## Preserved gates

- locked layer hash
- required template components
- schema and contract validators
- template visual gate
- Layout capacity validation
- Template, Layout, and Visual human approvals
- strict missing-image PPTX export

## Publication work

- Replaced the previous canonical Skill directory with the validated R2 architecture.
- Flattened the final GitHub repository so `Planners-PPT-Hell/` itself is the Skill bundle root; the obsolete nested `planners-ppt-hell/` layer no longer exists.
- Archived the previous canonical directory at:
  `PPT-Skill-around/releases/2026-07-18-parent-worker-legacy/planners-ppt-hell`
- Moved old repository backups, local test projects, working examples, and the original planning folder to:
  `PPT-Skill-around/releases/2026-07-18-legacy-materials/`
- Copied the original planning documents into `docs/history/legacy-planning/` before archiving the working folder.
- Added repository/Skill README, AGPL license, NOTICE, trademark, commercial, security, changelog, and `.gitignore` files.
- Added the current complete architecture and copied prior architecture audits, upgrade plans, run analyses, and work logs into `docs/history/`.
- Historical documentation is not referenced by `SKILL.md` or stage tasks.

## Validation results

- `smoke_v2.py`: 20/20 pass
- `mece_scan_v2.py`: pass
- Skill Creator `quick_validate.py`: pass
- template visual gate against the R2 full review fixture: pass, zero issues
- default template application: pass in smoke suite
- real unmatched `content_base` forward test: pass, `validator_errors: 0`; title/body wireframe positions preserved
- release tree: no committed runtime `_internal/`, PPTX, review HTML, `.pyc`, or `__pycache__`
