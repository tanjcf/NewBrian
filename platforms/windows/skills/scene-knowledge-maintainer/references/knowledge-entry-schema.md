# Knowledge entry schema

Store confirmed entries under `# Project Knowledge` in `project-knowledge.md`:

```markdown
## [scene] concise capability or workflow name

- Status: confirmed
- Tool/interface: stable tool or endpoint name
- Applies to: project, environment, and version boundary
- Learned at: ISO-8601 timestamp
- Evidence: concise observable evidence; use a local artifact path or request ID when safe
- Description: what the capability does and how the Agent should use it
- Constraints: approvals, required inputs, unsupported behavior, and recovery rules
```

Store unresolved entries under `# Learning Open Questions` in `learning-open-questions.md`:

```markdown
## [scene] concise unresolved topic

- Status: needs-verification
- Observed at: ISO-8601 timestamp
- Observation: what was actually observed
- Missing evidence: the smallest check needed to confirm or reject it
- Do not assume: claims that must not enter answers or Tool decisions yet
```

Rules:

- Use one entry per stable capability or workflow.
- Replace superseded facts and retain a short compatibility note; do not preserve contradictory active rules.
- Never paste full Tool output when a bounded summary and safe identifier are enough.
- Do not store access tokens, API keys, cookies, passwords, private prompts, or raw user data.
