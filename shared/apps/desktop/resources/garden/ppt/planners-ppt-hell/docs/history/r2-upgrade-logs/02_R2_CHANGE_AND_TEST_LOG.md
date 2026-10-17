# R2 Change and Test Log

## Release boundary

- Previous candidate remains unchanged at `releases/2026-07-17-vnext-candidate`.
- R2 is isolated at `releases/2026-07-17-vnext-candidate-r2` and can be rolled back by selecting the previous Skill path.

## Modified Skill files

- `SKILL.md`
- `agents/openai.yaml`
- `references/architecture.md`
- `references/contracts/layout_plan_contract.md`
- `references/contracts/svg_stage_contract.md`
- `references/contracts/template_profile_contract.md`
- `references/workflow/00_pipeline_controller.md`
- `references/workflow/01_template_intake.md`
- `references/workflow/03_layout_stage.md`
- `references/workflow/04_svg_stage.md`
- `scripts/generate_template_review_html.py`
- `scripts/review_server.py`
- `scripts/orchestrate/ppt_pipeline.py`
- `scripts/orchestrate/make_stage_task.py`
- `scripts/orchestrate/finalize_stage.py`
- `scripts/template/apply_fidelity_template.py`
- `scripts/validate_svg_layout.py`
- `scripts/test/smoke_v2.py`

## Acceptance files

- `acceptance/template-review-r2/00_template_review.html`
- `acceptance/weak-model-clean-flow/RUN_PROMPT.md`
- `acceptance/weak-model-clean-flow/input/Final Copy Deck.md`
- `acceptance/weak-model-clean-flow/input/测试模板.pptx`

Input SHA-256:

- Markdown: `fb2f10930b8a78cd05adeb007875f92ce6c7299407023266653772c04e24dbab`
- Template: `53ae2161eaa1b967cca125e7469d10fe7bf85e1a8691171c0c6b3169ba722ac9`

## Validation status

- Before the final R2 documentation/helper assertions, the inherited vNext test suite passed 17/17.
- Static R2 audit confirms the new review labels/actions, explicit template-confirmation flag, SVG one-shot-subagent task metadata, exact per-page canvas argv, feedback-resolution gate, and missing-image hard-error code are present.
- The generated R2 template review HTML exists and contains per-Layout pass/discard/revise controls plus only batch-submit/all-pass overall actions.
- The latest R2 Python compile and smoke rerun was requested on 2026-07-17 but was rejected before process creation by the Codex automatic approval usage limit. This is an environment block, not a test failure.
- Because the same approval limit also blocks starting the Python review server, R2's live HTTP health check, `smoke_v2.py`, `mece_scan_v2.py`, `quick_validate.py`, and `forward_content_base_v2.py` must be rerun in the new clean-flow task or after execution approval becomes available.

No test is reported as passed unless it actually ran against the stated revision.
