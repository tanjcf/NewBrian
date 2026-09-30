# macOS Phase 1 Blueprint

## Objective

Build a single-machine coding agent for macOS that is safe, inspectable, and able to complete small repository edits through a human approval loop.

## User Journey

1. User opens the desktop app.
2. User attaches one local workspace.
3. User asks for a coding task.
4. Agent runtime plans the next tool action.
5. Desktop app shows approval before shell or write actions.
6. Runtime returns a patch proposal.
7. User reviews and applies the patch.

## macOS-Specific Concerns

- shell defaults should assume `zsh`
- app sandbox strategy must not hide workspace access failures
- terminal execution should be PTY-backed in later iterations, but phase 1 can start with captured child-process output
- file watching should prefer native stability over aggressive live indexing

## Phase 1 Modules

### Desktop Shell

- workspace picker
- conversation panel
- approval drawer
- patch preview
- command log

### Agent Runtime

- session state machine
- tool request builder
- approval wait state
- patch proposal emitter

### Shared Contracts

- session summary
- tool request
- approval request
- patch proposal
- command run

## Non-Goals

- background multi-agent swarms
- worktree isolation
- cloud tenancy

## Model Chat Parity (2026)

Mac desktop model chat follows the same composition graph as Windows:

- `ModelChatPreparationService` with `resolveServerAutoRoute` → `fetchSpringAppAutoRoute`
- Full `ModelChatService` dependency graph via `compose-model-chat.ts`
- `AgentHostLoopBridge.createRuntime` for per-turn runtimes
- Media generation via `executeMediaGenerationTurn`
- IPC via `registerModelChatIpcHandlers` (`desktopIpcChannels.model.chat`)

OS-specific adapters only: shell (`zsh`), paths, and Electron packaging differ; routing and agent loop behavior are shared.

