# Thread 019f6f84-0b48-7d93-bfd3-aa89dd6311e2 Audit

## Runtime

The inspected turns consumed approximately 4,117,655 ms, or 68.63 minutes in total.

## Confirmed defects

1. The agent treated an available template path as consent to extract it. The intake gate did not force a new user reply.
2. The template review interaction encoded the decision at the wrong level. Pass/discard/revise belongs to each concrete Layout; the batch level only submits the collected decisions or marks every Layout passed.
3. SVG work ran without an announced one-shot subagent. The pipeline did not provide a sufficiently concrete executor instruction and fallback notice.
4. The initial Template task included `template_profile.json` as both an input and an output, causing an avoidable stale-input failure.
5. The agent guessed validator arguments and manually copied paths. One path contained the typo `acceptances`, creating pure rework.
6. A hand-written Layout JSON contained a syntax error. Machine validation caught it, but only after a wasted generation attempt.
7. Layout capacity failures required revision. More importantly, user feedback was not closed item by item; line-chart and 3:4 placeholder requirements had to be repeated.
8. One SVG batch omitted page_06. Batch/page completeness was not treated as a pre-finalization invariant by the worker.
9. Canvas background image links became invalid after canvas copying because relative paths were preserved against the wrong output directory.
10. Final PPTX export retained a LibreOffice CJK-font substitution risk. This is an environment/rendering risk, not evidence that the semantic pipeline succeeded cleanly.

## Causal conclusion

The long runtime was not caused by visual generation alone. Most delay came from contract ambiguity at handoffs: implicit template consent, wrong review decision scope, unconstrained executor choice, copied paths, partial feedback resolution, and background portability. Validators caught several defects, but too late; they cannot compensate for contradictory prompts or imprecise tasks.

## R2 response

- Force a new user-confirmed template choice with `--user-confirmed`.
- Make review decisions tri-state per Layout and derive batch approval from those decisions.
- Prefer one one-shot subagent per SVG batch, announce it, and define an explicit serial fallback.
- Remove the initial Template output from its own input set.
- Freeze exact canvas-start argv per page in the SVG task.
- Require Layout revision `feedback_resolution` to close every frozen feedback item.
- Rewrite copied canvas image paths relative to the destination SVG.
- Reject missing or absolute local image references as hard SVG validation errors.

## Residual risks

- A weaker model can still produce poor visual judgment; the visual review gate remains necessary.
- Host environments without subagent capability will be slower, but must now disclose serial fallback.
- LibreOffice/font availability can still alter exported PPTX rendering.
- R2's latest Python suite rerun is pending because the local execution approval quota rejected the command before process creation.
