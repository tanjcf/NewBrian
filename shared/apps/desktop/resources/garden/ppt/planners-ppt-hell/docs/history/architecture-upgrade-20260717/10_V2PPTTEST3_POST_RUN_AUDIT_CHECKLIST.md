# V2PPTTest3 post-run audit checklist

Use only after the independent model finishes. Do not place this checklist in the forward-test package.

- Verify `TEST_PACKAGE_MANIFEST.json` input and Skill hashes did not change.
- Reconstruct Parent state transitions and action durations from `flow_events.jsonl`.
- Match every dispatch to one task, one Agent ID, one result, exact input hashes, and exact output set.
- Confirm Template/Content parallel preparation did not leak task inputs across Workers.
- Confirm Template review was explicit and hash-bound; no automated approval.
- Confirm every fidelity layout has required components and an empty replace layer.
- Confirm Layout selected `content_base` for every page without an exact specialized-model match.
- Confirm each SVG batch received only its selected canvases and batch-scoped runtime.
- Confirm locked hashes, required components, validator reports, visual self-review, full-deck review, and human approvals are current.
- Count failed commands, repeated calls, retries, Agent replacement attempts, `not_found` events, and time spent per state.
- Inspect SVG/PNG/PPTX quality independently; do not accept Worker self-report as visual evidence.
- Rerun smoke, MECE, quick validation, visual gate, and a fresh `content_base` forward against the exact RC Skill.
- Produce a causal report separating Skill defects, model noncompliance, environment failures, and unavoidable human wait time.
