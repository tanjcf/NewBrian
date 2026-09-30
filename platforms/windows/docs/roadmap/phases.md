# Delivery Phases

## Phase 1: Local Coding Agent

Target outcome:

- one desktop app
- one local runtime
- one workspace attached at a time
- shell, file, and patch tools
- manual approval for execution and apply

macOS implementation focus:

- Electron shell on macOS first
- local agent runtime process launched by the app
- `zsh` command execution model
- workspace path binding under user-approved directories
- read-only inspection before any patch apply

Exit criteria:

- user can open a repo
- ask for a change
- review proposed patch
- approve tool runs
- apply edit and view logs

Concrete deliverables:

- session sidebar
- conversation timeline
- workspace tree
- pending approval card
- patch preview card
- command run log
- shared phase-1 protocol objects

## Phase 2: Engineering Workflow Depth

Target outcome:

- Git worktree sessions
- task checkpoints
- test result summarization
- richer diff review
- resumable runs

Exit criteria:

- multiple isolated tasks can run on the same repository
- failures can be resumed from persisted state

## Phase 3: Multi-Agent Orchestration

Target outcome:

- parent task decomposition
- sidecar researcher or verifier agents
- shared event stream
- result merge workflow

Exit criteria:

- orchestrator can assign bounded subtasks and merge artifacts safely

## Phase 4: Model Gateway and Skills

Target outcome:

- provider abstraction
- model routing policies
- skill registry
- skill execution contracts

Exit criteria:

- runtime can choose among configured models and bind structured skills

## Phase 5: Product Hardening

Target outcome:

- audit trail
- memory
- policy enforcement
- automation
- crash recovery
- packaging for macOS and Windows

Exit criteria:

- product is reliable enough for daily engineering use
