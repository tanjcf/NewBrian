# Architecture Overview

## Product Goal

Build a coding agent platform that can grow from a local desktop assistant into a full multi-agent engineering console.

## Core Principles

1. Local-first execution for file access, shell, Git, and tests.
2. Explicit approval gates before risky actions.
3. Shared protocol between UI, orchestrator, and tools.
4. Replaceable model providers and routing logic.
5. Durable event log for replay, audit, and recovery.

## Runtime Topology

```text
Desktop UI (Electron)
  -> Renderer: task UI, diff review, session timeline
  -> Main: native integration, windowing, process boot
  -> IPC bridge

Local Agent Runtime (agentd)
  -> session manager
  -> planner
  -> tool executor
  -> patch applier
  -> policy guard
  -> event store

Future Gateway Services
  -> model router
  -> provider adapters
  -> skill registry
  -> memory and audit backends
```

## Bounded Components

### `apps/desktop`

Responsibilities:

- render workspace and task state
- display streamed assistant output
- collect approval decisions
- preview patches, logs, and tool output

### `apps/agentd`

Responsibilities:

- own session state machine
- execute tools inside a controlled sandbox boundary
- emit structured events
- prepare patch proposals instead of blind edits

### `packages/protocol`

Responsibilities:

- typed contracts for sessions, tasks, tools, approvals, and events
- stable event names shared by UI and runtime

### `packages/ui`

Responsibilities:

- desktop design tokens
- layout primitives
- session components

## Phase 1 Scope

Phase 1 intentionally excludes:

- cloud multi-tenant API gateway
- automatic model routing
- BYOK management
- private skill synthesis
- full PII redaction pipeline

Those stay as extension points, not immediate blockers.

