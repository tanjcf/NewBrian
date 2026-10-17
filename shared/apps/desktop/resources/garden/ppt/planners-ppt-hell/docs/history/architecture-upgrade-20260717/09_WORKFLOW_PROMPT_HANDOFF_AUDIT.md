# Workflow / Prompt / Handoff audit — 2026-07-17

## Scope and verdict

Audit target: `planners-ppt-hell-architecture-upgrade-staging-20260717`. The formal Skill was read-only.

Verdict: the canonical Template → Content → Layout → SVG → validation/review pipeline now passes its automated handoff gates. Prompt and task inputs are role-scoped, hash-bound, and non-overlapping. The architecture can prevent contradictory or irrelevant instructions and can block invalid outputs; it cannot guarantee aesthetic excellence from language alone, so locked-layer validation, visual self-review, full-deck review, and human approval remain mandatory.

## Worker handoff matrix

| Worker | Owns | Exact runtime evidence | Explicitly excluded |
| --- | --- | --- | --- |
| Template | reusable visual identity, page boundaries, fidelity canvases | source contact sheet, every declared source page, visual manifest, workflow/contract, structural candidate profile only when it exists | title/body/content structure decisions; pseudo input paths |
| Content | traceable facts, page content, source/material roles | source Markdown and Content workflow/contract | template layout choice, wireframe, SVG |
| Layout | final on-slide copy, content structure, wireframe, capacity, `template_layout_id` | Content output, trusted template direction, canonical fidelity registry when relevant, Layout workflow/contract | asset registry, SVG generation; nearest-layout fallback |
| SVG | exact execution of approved copy/wireframe/canvas for one batch | batch input, SVG workflow/contract/rules, batch-scoped template runtime, selected canvases only | full registry, full profile, extraction evidence, asset registry, `components.svg`, unselected canvases, cross-batch writes |

Instruction layering is deliberate: Parent dispatch prompt = short role boundary; task = exact evidence allow-list plus hashes; workflow/contract = method and schema. The same contract is not repeated in all three layers.

## Problems found and corrected in this audit

1. Template tasks listed explanatory strings as if they were files. The task builder now resolves every visual-manifest page to a real file, fails on missing pages, and keeps `input_files` equal to `input_hashes`.
2. SVG tasks exposed the complete fidelity registry. The controller now resolves approved layout IDs before dispatch and generates one batch-scoped runtime with only selected layouts and reachable components. Validator argv uses the same scoped runtime.
3. The SVG workflow and Worker contract still described the old complete-registry input. Both now require the scoped runtime and explicitly prohibit complete registry/profile/evidence/components/unselected canvases.
4. Content dispatch had no canonical short prompt. It now has the same structured dispatch envelope as the other Workers and explicitly excludes layout/wireframe/SVG work.
5. Template dispatch used ambiguous “关键位置”, which could encourage fixed content coordinates. It now says the template fixes only visual identity and page boundaries, keeps replace layers empty, and must not fix title/body/content structure.
6. Layout dispatch was too generic. It now explicitly owns content structure/copy/wireframe/canvas selection and requires `content_base` when no specialized canvas is an exact match.
7. Parent status text still referenced “complete strong feedback” and a possible SVG `template_profile` input. These stale descriptions were removed without weakening feedback provenance or validation.
8. Review documentation still described the retired four-dimension feedback model. It now matches the live UI: per-layout Yes/No, optional per-layout and overall feedback, template name, and all-Yes requirement for approval.

## Verification evidence

- `smoke_v2.py`: PASS 40/40 after corrections.
- `mece_scan_v2.py`: PASS.
- Skill Creator `quick_validate.py`: `Skill is valid!`.
- Real non-specialized `content_base` forward: PASS; exactly one selected canvas (`content_base.svg`), title/body coordinates came from the Layout Plan wireframe, validator errors `0`, PNG generated.
- Current five-layout Test visual gate: PASS with zero issues.
- Review Server `/health`: HTTP 200, session `c8ac33964df24ad7bff136e2dcec2e4a`, PID `58512`.
- Current human feedback: explicitly submitted by the user, template name `Test`, all five layouts `Yes`; approval is bound to current HTML, source PNG hashes, registry, canvas SVG hashes, canvas PNG hashes, and contact sheet hash.

One intermediate regression failed 39/40 because the improved Layout dispatch prompt exceeded the old 150-character test ceiling. The prompt remained concise but contained a newly required fallback boundary; the test ceiling was deliberately raised to 220 and all semantic assertions retained. No production behavior was relaxed.

## Coverage of failure and wasted-call risks

The smoke suite covers stale hashes, wrong/missing layout IDs, missing/tampered canvases and components, rejected layout revision, original-Agent affinity, replacement only after `not_found`, stale human-review evidence, overfull capacity, strict export, visual closure, and selected-versus-unselected specialized canvas payload. Controller-side fail-fast checks now stop missing visual files and invalid fidelity layout IDs before Worker dispatch.

The isolated `Test-023ffae3-human-review` directory is a review shell, not a full production project: it intentionally lacks `tasks/template_agent_result.json`. Running `ppt_parent next` there returns `PREPARE`; this must not be interpreted as rejection of the valid human approval. Canonical production projects create and review inside the same project and are covered by smoke. Promotion of the approved review-shell package therefore needs a controlled import/publish step rather than fabricating a Worker result.

## Residual risks and next release action

- A high-quality prompt reduces wrong calls but does not prove visual quality. Visual self-review, validators, full-deck review, and human gates remain required and unchanged.
- The staging Skill has not replaced the formal Skill. Before promotion, rerun the same four automated gates after any final diff, validate package hashes, import the explicit review approval through the release path, then atomically swap or copy the staging directory with rollback provenance.
- Do not resume the isolated review shell as though it were a complete production run; use its hash-bound approval only for the pending Test package release.
