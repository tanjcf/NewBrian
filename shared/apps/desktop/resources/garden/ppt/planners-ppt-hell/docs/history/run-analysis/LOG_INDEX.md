# Work Log Index

## Primary logs

- `RUN_LOG.md` — chronological Parent/phase log.
- `WORK_LOG_DETAILED.md` — consolidated detailed log of the main Agent and all Workers, including failures, retries, blockers, and time-loss points.
- `_internal/00_project/review_server.log` — local review-server request, health, restart, and shutdown log.

## Worker execution records

- `_internal/00_project/tasks/content_agent_result.json`
- `_internal/00_project/tasks/template_agent_result.json`
- `_internal/00_project/tasks/layout_agent_result.json`
- `_internal/00_project/tasks/svg_batch_01_agent_result.json`
- `_internal/00_project/tasks/svg_batch_02_agent_result.json`
- `_internal/00_project/template_worker_result.json`

## Human review and gate records

- `_internal/00_project/template_feedback.json`
- `_internal/01_layout_plan/layout_feedback.json`
- `_internal/00_project/tasks/inputs/template_feedback.json`
- `_internal/00_project/tasks/inputs/layout_feedback.json`

## Validation and visual self-review records

- `_internal/04_validation/validation_summary.json`
- `_internal/04_validation/self_review.json`
- `_internal/04_validation/batches/batch_01.json`
- `_internal/04_validation/batches/batch_01_self_review.json`
- `_internal/04_validation/batches/batch_02.json`
- `_internal/04_validation/batches/batch_02_self_review.json`

## Review artifacts

- `01_layout_direction.html`
- `02_visual_review.html`
- `_internal/03_png_preview/full_deck_contact_sheet.png`
- `_internal/03_png_preview/pages/page_01.png` through `page_06.png`

All paths in this index are relative to this fresh project directory. The two consolidated Markdown logs are the recommended entry points; the JSON records preserve the exact Worker contract and hash evidence.

# 历史架构审计

- `SKILL_EVOLUTION_CAUSAL_AUDIT.md`：整合 7 个历史任务，重建 Skill 从 Parent、batch、模板方向、资产复用、fidelity 到运行时简化的演化因果链，并给出替代式收敛方案。
- `SKILL_RUN_ANALYSIS_AND_OPTIMIZATION_REPORT.md`：当前 fresh run 的耗时、错误、质量与直接优化分析。
