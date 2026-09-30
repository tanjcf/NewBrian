# Task-based Expert Collaboration

## User Flow

The model evaluates the task, attachments, scene and global/project Skill context.
Complex tasks can use `expert.propose` to recommend one to three experts with
specific reasons and responsibilities. No prior expert or Skill selection is needed.
The existing durable goal decision card offers accept, adjust and continue without experts.
Uninstalled builtin packs are identified before acceptance.

`expert.summon` remains an internal compatibility tool. All desktop invocation paths
check the persisted task decision or explicit automatic preference before activation.
Declining blocks expert activation for that goal. Adjustments require another proposal.
The newest proposed plan supersedes older acceptance. Expert Skill selection is subject
to the same authorization, and bindings are associated with the active goal's activation events.
Experts organize work; native tools still perform generation and other side effects.

## Preferences

`expert.preference` asks separately whether to save for this project, all projects in
the current scene, or not save. A normal acceptance never writes a preference.
Modes are `auto`, `ask`, and `off`; project preferences override global preferences.
Scope is a SHA-256 digest of the workspace path, so moving a project requires
reconfirming its preferences. It is not a cross-device project identity.
Observed habits remain suggestions, never automatic consent or silent Skill edits.

Spring owns `desktop_expert_preferences`, keyed by authenticated user, scope, scene
and expert. GET `/api/desktop/v1/experts/preferences?scope=...` requires `skills.read`;
POST requires `skills.install`. The startup migration creates the table idempotently.
Desktop confirmation stays in the existing SQLite goal questions and events.
Unavailable Spring preferences do not authorize automatic execution; a save failure
is reported and can be retried. No user Skill files are overwritten.

## Validation And Rollout

- Focused desktop state, SQLite reopen and Spring-client contract tests.
- Spring validation tests and Maven package build.
- Electron fixture tests: initial recommendation, adjustment focus, reload, decline,
  and the separately exercised acceptance/install/activation path.
- Windows Electron production build and repository layout verification.

The Electron test uses a deterministic local model, not a live recommendation-quality
benchmark. Remote Spring deployment, real-model recommendation acceptance and MSI
installation are separate rollout checks. Existing unrelated TypeScript errors prevent
claiming a repository-wide clean typecheck. The prior 1.4.4 MSI does not contain this change.
