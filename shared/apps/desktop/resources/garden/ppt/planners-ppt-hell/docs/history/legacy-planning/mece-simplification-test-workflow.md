# Planner's PPT Hell v2 MECE Simplification Test Workflow

## Purpose

This document hands off a second simplification round to a testing Agent.

The goal is not to add features. The goal is to prove, with evidence, where the Skill still violates MECE:

- same rule repeated in multiple places
- same responsibility split across multiple files
- same contract field explained differently in multiple documents
- scripts with overlapping authority
- references that force unnecessary context load
- no-op prose that does not change agent behavior

This round must produce a report first. Structural edits are allowed only where the phase explicitly permits them and only after tests pass.

## Current Baseline

Known stable facts after the previous cleanup:

```text
□ v2 route authority uses references/domain/ and references/contracts/
□ 5 byte-identical old references were deleted
□ scripts/__pycache__/ was deleted
□ smoke_v2.py passes 15/15
□ examples/minimal_deck_work/ is kept as the regression fixture
□ backups/ is kept as the original-version backup
```

Current scale signals:

```text
SKILL.md: 165 lines
workflow references: 3866+ lines
contract references: 3791+ lines
domain references: 1141+ lines
scripts: many files over 500 lines
```

The system works, but it is still too large. The next simplification must be based on responsibility boundaries, not line-count deletion.

## Non-Negotiable Safety Rules

The testing Agent must not break these behaviors:

```text
□ parent status/next/preflight JSON remains machine-readable
□ make_agent_task.py remains the single task schema generator
□ collect_agent_results.py remains the single result collection entry
□ validate_agent_result.py remains the schema validation entry
□ pipeline_gate.py remains the gate authority
□ review_server.py remains the human approval authority
□ generate_layout_html.py still writes layout_html_errors.json
□ split-page SVG tasks still use trimmed per-page inputs
□ retrospective outputs suggestions only, never auto-applies defaults
□ export still goes through pptflow.py export
□ human approval checkpoints are not removed
```

## Permission Boundary

Testing Agent may:

```text
□ run tests and scans
□ create analysis reports under planning/
□ create temporary analysis scripts under /tmp or planners-ppt-hell/scripts/test/
□ propose file moves, merges, and deletions
□ make small documentation link fixes if tests prove a path is wrong
□ make small test additions that protect current behavior
```

Testing Agent must not directly:

```text
□ delete files
□ move active references
□ merge large references
□ merge or delete scripts
□ change gate, approval, export, retrospective, or parent orchestration semantics
□ rewrite SKILL.md active route table without Owner approval
□ remove examples/minimal_deck_work/
□ remove backups/
```

Any structural change candidate must be reported in this format:

```markdown
| item | current_owner | duplicate_or_overlap | proposed_owner | proposed_action | risk | verification |
```

## Architecture Target

The final architecture should follow this ownership model:

```text
SKILL.md
  Owns: trigger, route table, high-level parent flow, when to read which reference.
  Does not own: detailed worker rules, schemas, examples, script behavior details.

references/workflow/
  Owns: step-specific worker instructions, completion criteria, what to produce.
  Does not own: full JSON schema, shared domain taxonomy, script implementation rules.

references/contracts/
  Owns: schema, required fields, validation semantics, allowed values.
  Does not own: long examples unless they are minimal schema examples.

references/domain/
  Owns: reusable design taxonomy, style rules, SVG design constraints.
  Does not own: workflow sequencing, output paths, agent process rules.

scripts/orchestrate/
  Owns: parent state, task generation, result collection, schema validation entrypoints.
  Does not own: rendering, layout HTML generation, review server implementation.

scripts/validate/
  Owns: focused validators for one artifact type.
  Does not own: orchestration state or task generation.

scripts/template/
  Owns: PPTX template extraction/profile validation support.
  Does not own: generic style system rules beyond outputting a profile.
```

## Required Deliverables

The testing Agent must create:

```text
planning/mece-simplification-report.md
planning/mece-responsibility-matrix.csv
planning/mece-duplicate-rule-index.json
planning/mece-action-candidates.md
```

Optional, if useful:

```text
planners-ppt-hell/scripts/test/mece_scan.py
```

## Phase 0: Baseline Lock

### Goal

Prove the current system works before doing any MECE analysis.

### Commands

Use the repo's working Python environment.

```bash
/Users/ivan/.venvs/skills-py312/bin/python planners-ppt-hell/scripts/test/smoke_v2.py
```

### Required Report Section

```markdown
## Phase 0 Baseline

- smoke_v2.py: PASS/FAIL
- failures: [...]
- current git status summary: [...]
- files that must not be touched: [...]
```

### Gate

If smoke tests fail, stop. Do not start simplification analysis until baseline is restored or the failure is explicitly classified as unrelated test fixture drift.

## Phase 1: Responsibility Inventory

### Goal

Create a file-by-file responsibility map. This must be evidence-based, not vibes.

### Scan Scope

```text
planners-ppt-hell/SKILL.md
planners-ppt-hell/README.md
planners-ppt-hell/references/**/*.md
planners-ppt-hell/scripts/**/*.py
```

### Method

For every file, classify:

```text
file_path
layer: skill | workflow | contract | domain | script_orchestrate | script_validate | script_render | script_template | doc
primary_responsibility: one sentence
secondary_responsibilities: list
inputs_owned: list
outputs_owned: list
rules_owned: list
rules_referenced_elsewhere: list
scripts_called_or_referenced: list
contracts_called_or_referenced: list
route_status: active | fixture | compatibility | unknown
line_count
owner_confidence: high | medium | low
```

### Output

Write `planning/mece-responsibility-matrix.csv`.

### Acceptance

```text
□ Every active file has one primary responsibility
□ Any file with more than 3 secondary responsibilities is flagged
□ Any file with owner_confidence=low is explained
□ Active / fixture / compatibility / unknown statuses are assigned
```

## Phase 2: Rule Duplication Index

### Goal

Find repeated rules and repeated concepts, not just byte-identical files.

### Rule Families

At minimum, index these rule families:

```text
approval_required
forbidden_writes
allowed_writers
future_batch_forbidden
layout_approval
visual_approval
export_allowed
input_hashes_required
agent_result_required
split_pages_trimmed_inputs
layout_html_errors
review_server_metadata
approval_key_not_plaintext
retrospective_requires_confirmation
template_profile_limits
svg_validation_rules
svg_repair_loop_limit
copy_handling_required
wireframe_required
capacity_report_required
```

### Method

Search exact terms first, then inspect semantic duplicates manually.

Useful commands:

```bash
rg -n "approval|forbidden_writes|allowed_writers|export_allowed|input_hashes|split-pages|layout_html_errors|review_server|retrospective|copy_handling|wireframe|capacity" planners-ppt-hell
```

For each rule family, identify:

```text
canonical_owner: one file that should own the rule
mentions: all files/line references where the rule appears
mention_type: owns | references | repeats | contradicts | example
duplication_level: none | acceptable_pointer | repeated_detail | conflict
recommended_action: keep | replace_with_pointer | move_to_contract | move_to_workflow | delete_noop | needs_owner_review
```

### Output

Write `planning/mece-duplicate-rule-index.json`.

### Acceptance

```text
□ At least 20 rule families inspected
□ Every repeated_detail has a proposed canonical owner
□ Every conflict has line references
□ No recommendation says "simplify" without naming the target owner
```

## Phase 3: Contract Boundary Audit

### Goal

Make contracts MECE. Contracts should own schema and validation semantics; workflow docs should point to contracts instead of restating fields at length.

### Questions

For each contract:

```text
□ What artifact does it own?
□ Is the schema duplicated in a workflow file?
□ Are required fields explained in more than one place?
□ Are examples too long for an active contract?
□ Could examples move to references/examples/ without losing behavior?
□ Is this contract enforced by a script, or only prose?
```

### Special Focus

```text
agent_result_contract.md
agent_task_contract.md
batch_learning_contract.md
template_profile_contract.md
repair_loop_contract.md
layout_plan_contract.md
page_content_contract.md
worker_svg_contract.md
```

### Output Section

```markdown
## Contract Boundary Audit

| contract | owns | duplicated_in | enforcement_script | proposed_compression | risk | test |
```

### Acceptance

```text
□ Each contract has one artifact owner
□ Any schema repeated outside contract is flagged
□ Any contract without enforcement is flagged as prose-only
□ Compression candidates distinguish examples vs mandatory rules
```

## Phase 4: Workflow Reference Compression Audit

### Goal

Reduce worker references so each one contains only:

```text
□ when this step runs
□ required inputs
□ output files
□ completion criteria
□ step-specific decision rules
□ pointers to contracts/domain references
```

Workflow references should not contain:

```text
□ full schemas already in contracts
□ long examples that can move to examples
□ rules owned by scripts
□ repeated global approval rules
□ repeated SVG technical rules owned by domain/svg_rules or worker_svg_contract
```

### Method

For each workflow file, create a section map:

```text
heading
line_range
purpose
owner_layer: workflow | contract | domain | script | example | noop
keep_in_file: yes | no
proposed_destination
reason
```

### High-Priority Files

```text
references/workflow/03_layout_worker.md
references/workflow/02_content_worker.md
references/workflow/00_parent_orchestrator.md
references/workflow/07_visual_review.md
references/workflow/04_svg_worker.md
```

### Output Section

```markdown
## Workflow Compression Candidates

| file | current_lines | target_lines | sections_to_keep | sections_to_move | sections_to_delete | risk | verification |
```

### Acceptance

```text
□ Every oversized workflow file has a target line count
□ Each moved section has a target destination
□ Each deleted section is justified by no-op or duplicate owner
□ No human checkpoint is removed
```

## Phase 5: Script Responsibility Audit

### Goal

Identify overlapping script authority and script sediment.

### Script Ownership Rules

Use this expected map:

```text
ppt_parent.py: state, next action, preflight, delegation
make_agent_task.py: task JSON generation only
collect_agent_results.py: result collection only
validate_agent_result.py: agent task/result schema validation only
pipeline_gate.py: gate pass/fail only
pptflow.py: export coordination only
generate_layout_html.py: layout review HTML only
generate_review_html.py: visual review HTML only
review_server.py: approval server only
render_svg_png.py: SVG to PNG rendering only
validate_svg_layout.py: SVG layout validation only
analyze_pptx_template.py: PPTX template profile extraction only
validate_template_profile.py: template profile validation only
analyze_run.py: retrospective analysis only
```

### Audit Questions

```text
□ Does any script generate artifacts outside its owner scope?
□ Does any script duplicate validation already owned by another script?
□ Does any script contain old compatibility logic that can be removed?
□ Are there two scripts with confusingly similar names?
□ Is there any script not routed by SKILL.md, workflow docs, or tests?
```

### Known Suspicion Areas

```text
template_analyzer.py vs scripts/template/analyze_pptx_template.py
validate_project_contracts.py vs scripts/validate/* validators
pptflow.py vs scripts/orchestrate/ppt_parent.py
generate_review_html.py vs review_server.py
native_svg_to_ppt.py vs pptflow.py export path
```

### Output Section

```markdown
## Script Responsibility Audit

| script | expected_owner | actual_behaviors | overlap_with | route_status | proposed_action | risk | verification |
```

### Acceptance

```text
□ Every script has active/fixture/unknown status
□ Any duplicate CLI or legacy script is flagged
□ Any proposed merge names the surviving script
□ Any proposed deletion names the smoke/regression tests required first
```

## Phase 6: Context Load Simulation

### Goal

Estimate what each Agent actually needs to read. The point is to reduce parent and worker context load.

### Simulated Runs

For each scenario, list the exact files the Agent should read:

```text
S1: New project without template
S2: New project with PPTX template
S3: Content worker task
S4: Layout worker task
S5: SVG worker per-page task
S6: Validate + repair task
S7: Visual review task
S8: Retrospective task
S9: Export task
```

### Output Section

```markdown
## Context Load Simulation

| scenario | must_read | should_not_read | current_forced_load | proposed_route_change | expected_context_reduction |
```

### Acceptance

```text
□ Parent should not need to read worker details
□ SVG worker should not read full deck content when per-page inputs exist
□ Template flow should not load SVG repair rules
□ Retrospective should not load layout taxonomy or style system unless analyzing those artifacts
```

## Phase 7: No-Op and Weak Prose Scan

### Goal

Find sentences that consume context without changing behavior.

### No-Op Test

For each candidate sentence:

```text
If removed, would an Agent behave differently?
If yes, what concrete behavior changes?
If no, delete or replace with pointer/check/script.
```

### Search Hints

Look for phrases like:

```text
carefully
ensure
high quality
professional
comprehensive
clear
robust
best practice
as needed
appropriate
where possible
```

These words are not automatically bad, but every occurrence must justify itself.

### Output Section

```markdown
## No-Op Candidates

| file | line | text_summary | why_noop | proposed_action | risk |
```

### Acceptance

```text
□ At least top 30 no-op candidates reviewed, or all candidates if fewer
□ Do not remove tone or domain judgment unless it is truly behaviorless
□ Replace weak prose with contract/check/script pointer where possible
```

## Phase 8: MECE Action Plan

### Goal

Convert findings into a staged simplification plan that Owner can approve.

### Action Classes

Use only these action classes:

```text
KEEP: file/section is necessary and correctly owned
POINTER: replace repeated detail with pointer to canonical owner
MOVE_EXAMPLE: move examples to references/examples/
MOVE_RULE: move rule to contract/domain/workflow owner
MERGE_SCRIPT: merge script responsibility into surviving script
LEGACY_HOLD: keep temporarily with expiration condition
DELETE_NOOP: delete prose that changes no behavior
DELETE_SEDIMENT: delete inactive file after tests
SPLIT_SKILL: consider separate Skill/router only if workflow trigger is independent
```

### Required Candidate Table

Write `planning/mece-action-candidates.md` with:

```markdown
| priority | action_class | item | owner_now | owner_after | reason | expected_reduction | risk | required_tests | approval_needed |
```

Priority rules:

```text
P0: contradiction or active route confusion
P1: repeated rule causing maintenance risk
P2: large context reduction with low behavior risk
P3: cleanup only
```

### Acceptance

```text
□ Every candidate has one owner_after
□ Every delete/move/merge requires Owner approval
□ Every candidate names tests to run
□ No candidate relies only on line count
```

## Phase 9: Optional Small Safe Fixes

The testing Agent may make small safe fixes only if all are true:

```text
□ baseline smoke tests pass first
□ fix is limited to broken links, stale route references, typo in command, or report clarity
□ no behavior/gate/contract semantics change
□ smoke tests pass after fix
□ change is documented in mece-simplification-report.md
```

No deletion, move, merge, or large compression is allowed in this phase.

## Final Report Template

Write `planning/mece-simplification-report.md`:

```markdown
# MECE Simplification Report

## Executive Summary

- baseline status:
- largest MECE violations:
- highest ROI simplifications:
- changes made:
- changes requiring Owner approval:

## Phase Results

### Phase 0 Baseline
...

### Phase 1 Responsibility Inventory
...

### Phase 2 Rule Duplication Index
...

### Phase 3 Contract Boundary Audit
...

### Phase 4 Workflow Compression Audit
...

### Phase 5 Script Responsibility Audit
...

### Phase 6 Context Load Simulation
...

### Phase 7 No-Op Scan
...

### Phase 8 Action Plan
...

## Recommended Simplification Sequence

1.
2.
3.

## Stop / Continue Recommendation

- stop_reason:
- owner_decisions_needed:
- tests_to_run_before_next_edit:
```

## Final Verification

Before handing back:

```bash
/Users/ivan/.venvs/skills-py312/bin/python planners-ppt-hell/scripts/test/smoke_v2.py
find planners-ppt-hell -type d -name __pycache__
find planners-ppt-hell -type f -name "*.pyc"
```

Also run:

```bash
rg -n "references/(03_style_system|04_svg_rules|05_layout_taxonomy|page_content_contract|layout_plan_contract)\\.md|references/domain/0[345]_" planners-ppt-hell
```

Expected:

```text
□ smoke_v2.py passes
□ no __pycache__ or .pyc under planners-ppt-hell
□ no old deleted reference paths under planners-ppt-hell
```

## Owner Review Questions

The testing Agent must end with these questions answered:

```text
1. Which file is the worst MECE offender, and why?
2. Which repeated rule creates the most maintenance risk?
3. Which simplification gives the largest context reduction with lowest behavior risk?
4. Which files should not be touched because they encode important gates?
5. What is the recommended first edit for the Owner, and what test proves it safe?
```

## Definition of Done

This MECE test round is complete when:

```text
□ all four required planning outputs exist
□ smoke tests pass before and after any small safe fixes
□ every active file is classified
□ repeated rules have canonical owners
□ oversized references have section-level compression candidates
□ script overlaps are identified with surviving owner recommendation
□ deletion/move/merge candidates are separated from safe fixes
□ Owner can approve the next simplification round without redoing the audit
```
