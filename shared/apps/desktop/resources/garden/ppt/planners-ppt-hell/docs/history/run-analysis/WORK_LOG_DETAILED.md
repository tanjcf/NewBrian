# Fresh PPT Full-Flow Detailed Work Log

Project: `planners-ppt-output-fresh-20260716`  
Started from a new output directory on 2026-07-16. No previous output project was reused.

## Final state at log close

- Parent state: `VISUAL_REVIEW`
- SVG batches: `batch_01`, `batch_02`
- SVG pages: 6 generated
- SVG validator: `0 errors` in both batches
- PNG previews: 6 files, all `1920x1080`, valid size
- Visual review HTML: `02_visual_review.html`
- Review URL: `http://127.0.0.1:8768/review`
- Human visual approval: pending; not auto-submitted or auto-approved

## Worker identities

- Template Worker original Agent: `019f6b9c-d30a-7971-9768-ce909e7057d2` (Euclid)
- Layout Worker original Agent: `019f6b26-a84e-7d20-9add-76b100eed08b` (McClintock)
- SVG batch_01 Worker: `019f6b6c-7c39-7912-a0ab-c842cad42fe4` (Lagrange)
- SVG batch_02 Worker: `019f6b6c-7cc3-7922-b81b-b2ffb104cd3f` (Mill)

## Chronological execution and failures

### 1. Fresh start and baseline

- Created the fresh output project and recorded execution in `RUN_LOG.md`.
- Ran baseline checks before implementation:
  - `smoke_v2.py`: 36/36 passed
  - `mece_scan_v2.py`: passed
  - Skill `quick_validate.py`: passed
- Initial command error: used a non-existent `scripts/ppt_parent.py` path. Corrected by locating the actual orchestrator under `scripts/orchestrate/ppt_parent.py`.
- Initial CLI error: supplied `--project-dir`; Parent expects the project path as the first positional argument. Corrected without changing project state.

### 2. Template phase

- Extracted the source template into the fresh project and rendered 9 source pages.
- Reused the original Template Agent for feedback revision as required.
- Final template contains five layouts: `content_base`, `cover`, `contents`, `chapter`, `closing`.
- Removed `product_hero`; all canvas replace layers remain empty; locked layers and required components remain enforced.
- Template review UX was simplified after repeated user feedback: per-layout checkbox, per-layout feedback, template name, and one overall feedback box; the four rigid dimensions were removed.
- Template review asset-path defect fixed: inline SVG media paths were rewritten to the server-rooted project path. Raster and inline media then returned HTTP 200.
- `template_library.py` had an obsolete four-dimension publish check; it was changed to require layout approvals plus overall feedback while preserving visual/candidate/registry gates.
- Parent completion check had an obsolete asset registry schema assumption; it was updated to accept the current `approved` list schema.
- Review-page cleanup temporarily removed `00_template_review.html`, causing `File not found: 00_template_review.html`; the page was regenerated and HTTP 200 verified.
- Template was published as `Test-023ffae3` only after the user’s template approval was recorded. No automatic approval was used.

### 3. Layout phase

- Layout Worker selected `content_base` for all six pages because no specialized model matched precisely.
- First Layout collection failed on metadata: mixed timestamps and missing/non-empty compression rationale requirements. The original Layout Agent repaired metadata only; content and wireframes were preserved.
- User submitted Layout feedback:
  - page_01: reduce useless left whitespace
  - page_02: review/rework despite no written note
  - page_03: clarify five hot-topic mainlines
  - page_04/page_05: strengthen numeric results and preserve image placeholders
  - page_06: keep stable
- Original Layout Agent completed the revision. First collection then failed because `feedback_sha256` was absent.
- A second repair incorrectly placed the feedback hash only inside `input_hashes`; Parent requires a top-level `feedback_sha256`. The same original Agent corrected the field. Final Layout collection passed with `issues: []`.
- The capacity report retained `overfull` warnings for multiple dense pages. These remained visible risks and were not suppressed.

### 4. Layout Review renderer diagnosis and fix

- User supplied three screenshots showing unreadable/ugly copy presentation.
- Root causes recorded:
  1. `generate_layout_html.py` recursively flattened structured `body_blocks`, turning tables into raw sequences such as `table / 数据维度 / 具体数值 / 说明`.
  2. `core_message` was displayed once as the lead and again by generic recursion.
  3. Capacity `overfull` was warning-only and did not block Layout Review.
  4. Full uncompressed copy was retained on dense `content_base` pages, creating a real content-to-space mismatch.
- Minimal renderer fix applied:
  - structured list/table blocks now render semantically;
  - generic fallback excludes `core_message` and structured blocks;
  - review-only CSS was added for structured blocks;
  - no Layout Plan, SVG, template, approval, or manifest was changed.
- Regenerated `01_layout_direction.html`; browser DOM verification showed real table semantics and hierarchical list items.

### 5. Layout approval hash gate

- The first approval belonged to the pre-fix HTML hash. Parent correctly rejected reuse after the renderer changed the HTML.
- User resubmitted approval against the current HTML hash.
- Parent advanced to `SVG_BATCH_BUILD` with `all_approved: true`.

### 6. SVG phase

- Created and bound two isolated SVG tasks.
- Initial SVG generation completed visually for all six pages.
- First `collect-all` failed for both batches because `agent_result.json` lacked `input_hashes` and had `started_at` earlier than task generation.
- Original SVG Workers repaired only metadata. A second collection found mixed timezone fields causing `completed_at` to precede `started_at`.
- Original SVG Workers normalized both timestamps to UTC `Z` and preserved all SVG/validation files.
- Final `collect-all` passed for both batches with `issues: []` and `all_complete: true`.
- Batch outputs were generated from approved `content_base` canvases. Locked layers, required components, wireframes, final copy, and template layout IDs were preserved.

### 7. Visual review preparation

- First attempt to generate `02_visual_review.html` was blocked by page_06 static warnings:
  - body text entered footer zone;
  - title lines slightly overlapped;
  - excessive font tiers;
  - high text density and low module utilization warnings.
- Reused the original batch_02 Worker. It made a minimum page_06 SVG-only visual correction:
  - removed footer invasion;
  - removed title overlap;
  - reduced font tiers from 8 to 5;
  - preserved approved content, wireframe, locked layers, required components, and template ID.
- Validator returned `0 errors`; PNG and visual self-review found no visual must-fix.
- Final `02_visual_review.html` generated successfully and the Review Server is ready.

## Time-loss / friction record

- Wrong Parent script path and wrong CLI argument order at the beginning.
- Multiple metadata repair loops caused by the distinction between `input_hashes` and top-level `feedback_sha256`.
- Review Server reported `reused` while the port was not responding; an attempted `stop-review --stage layout` was invalid because stop-review has no stage argument. Correct stop/restart then restored the server.
- Approval had to be resubmitted after the renderer fix because the HTML hash changed; this was required by the gate, not duplicated work.
- SVG collection required two rounds of timestamp normalization because the workers originally mixed local time and UTC.
- Visual review generation required one page_06 repair before the review page could be generated.
- These delays are retained as process evidence; no output backups or legacy fallback directories were created.

## Current human action required

Open `http://127.0.0.1:8768/review`, inspect the full deck, and submit the final visual decision. The project must not advance past Visual Review without that human decision.

