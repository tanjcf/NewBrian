# Codex Forge

Codex Forge is a local-first coding agent workbench designed to iterate toward a full Codex-like product.

The immediate goal is not to clone a proprietary product byte-for-byte. The goal is to build a production-capable alternative with the same major system boundaries:

- desktop operator console
- local agent runtime
- tool execution and approval pipeline
- model gateway and routing
- session memory, audit, and automation

## Repository Layout

```text
apps/
  desktop/      Electron + React shell
  agentd/       Local agent runtime service
packages/
  protocol/     Shared task, tool, and event contracts
  ui/           Reusable desktop UI building blocks
docs/
  architecture/ System design and runtime boundaries
  roadmap/      Delivery phases and milestones
```

## Delivery Strategy

Phase 1 builds a runnable local coding agent:

- desktop shell
- workspace explorer
- conversation view
- command approval flow
- local tool execution
- patch preview

Later phases add:

- multi-agent orchestration
- worktree isolation
- model routing
- skill system
- policy engine
- memory and automation

## Current Status

This repository is scaffolded manually because the current machine does not yet have `npm` or `cargo`. The code and docs are structured so that once the toolchain is installed, implementation can continue without reshaping the repository.

See [docs/architecture/overview.md](/Users/jctanking/workerpases/测试/NewBrain/docs/architecture/overview.md) and [docs/roadmap/phases.md](/Users/jctanking/workerpases/测试/NewBrain/docs/roadmap/phases.md).

## Prerequisites

To move from scaffold to runnable implementation, install:

- Node.js package manager: `npm` or `pnpm`
- TypeScript toolchain
- Rust and Cargo for the future native runtime

## Run

After installing `pnpm`, use:

```bash
cd /Users/jctanking/workerpases/测试/NewBrain
pnpm install
pnpm dev:desktop
```

To run the local runtime separately:

```bash
pnpm dev:agentd
```

## Package Windows MSI (Double-click)

Prerequisites (Windows machine):

- Node.js installed
- Dependencies installed under `windows/` (recommended: run `pnpm install` in `windows/` once)

Build + package MSI by double-clicking:

- `package-win-msi.bat` (repo root)

Output:

- `windows/apps/desktop/release/NewBrain 0.1.0.msi`

## Package for macOS

```bash
cd /Users/jctanking/workerpases/测试/NewBrain
pnpm install
pnpm package:mac
```

Expected outputs:

- `apps/desktop/release/*.dmg`
- `apps/desktop/release/*.zip`

If you want signed distribution builds later, add Apple Developer signing and notarization settings before shipping outside your own machine.
