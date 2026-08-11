# Phase 1 Live Runtime Boundary

## What Is Implemented Now

The current phase-1 runtime now supports a real local loop for one attached workspace:

- recursive workspace scan with live tree refresh
- approval-gated shell execution
- approval-gated git status inspection
- file-backed patch proposal generation
- explicit patch apply to the workspace
- append-only crash-recoverable rollout storage and SQLite WAL projections
- structured Responses/Chat tool calling with resumable approval
- dynamic skill, plugin, and MCP tool registration
- durable parent/child agent delegation and result merge
- local policy rules, memory retrieval, and isolated automation runs

The desktop app drives these operations through Electron IPC and renders the runtime snapshot directly.

## What Still Counts As Phase 1

The runtime remains local-first, but is no longer limited to a single logical
agent:

- one foreground runtime instance
- one workspace path
- one foreground approval at a time per runtime
- bounded child-agent concurrency
- background automations use separate runtime instances

This keeps the trust model simple while the UI and runtime contracts stabilize.

## Remaining hardening boundaries

The shared protocol now reserves optional snapshot fields for future product phases:

- `delegatedTasks`
- `modelRoutes`
- `memories`
- `automations`

These fields are now populated. Remaining hardening work is deployment-specific:

1. Add an optional VM/container/kernel sandbox for untrusted third-party code.
2. Add signed remote plugin distribution and enterprise trust policy.
3. Move long-running cloud delegation to a remote control plane when required.

See [agent-runtime-v2.md](agent-runtime-v2.md) for the implemented runtime map.
