# BRAIN Product Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved cross-platform BRAIN workbench with secure model access, six workspace families, document annotations, quantitative simulation, and a Rust desktop execution core.

**Architecture:** Electron main remains the trusted desktop control plane, React remains the presentation layer, Spring remains the remote account/model/search control plane, and Rust Core incrementally owns privileged and compute-heavy local work. All cross-process contracts are versioned and all credentials remain outside renderer, Rust, logs, and project files.

**Tech Stack:** Electron 35, React 19, TypeScript, Node agent runtime, pnpm, Rust, Tokio, serde, local framed JSON then tonic gRPC, SQLite/event files, OS credential stores, Spring remote APIs.

---

### Task 1: Foundation and credential gates

**Files:**
- Modify: `scripts/verify-layout.mjs`
- Create: `scripts/verify-layout-policy.mjs`
- Test: `scripts/verify-layout-policy.test.mjs`
- Modify: `platforms/*/apps/desktop/src/main/index.ts`
- Test: `shared/apps/desktop/src/main/private-model-credential-policy.test.ts`

- [x] Write and run a failing test that rejects a supported platform without agentd/main/preload/renderer entries.
- [x] Enforce complete generated application entries for every declared platform.
- [x] Store macOS BYOK only through protected `safeStorage`.
- [x] Reject Linux `basic_text` and accept only Secret Service/KWallet.
- [x] Build Windows, macOS x64, Ubuntu x64, and Ubuntu arm64 source trees.
- [ ] Package and launch on real macOS x64/arm64 and Ubuntu x64/arm64 hosts; record install, restart, credential-save, credential-use, and uninstall evidence.

Run:

```text
pnpm verify:layout
pnpm build:macos-x64
pnpm build:ubuntu-x64
pnpm build:ubuntu-arm64
pnpm build:windows
```

Expected: all commands exit zero. Platform packaging remains blocked until executed on each real target OS.

### Task 2: Rust Core protocol and lifecycle

**Files:**
- Create: `rust/brain-core/Cargo.toml`
- Create: `rust/brain-core/src/main.rs`
- Create: `rust/brain-core/src/protocol.rs`
- Create: `rust/brain-core/src/limits.rs`
- Create: `shared/packages/protocol/src/rust-core.ts`
- Create: `shared/apps/desktop/src/main/rust-core-client.ts`
- Test: `shared/apps/desktop/src/main/rust-core-client.test.ts`

- [x] Write a failing contract test for protocol version, request ID, project ID, operation, limits, status, error code, and artifacts.
- [x] Implement framed JSON request/response types in Rust and TypeScript from the same checked schema fixture.
- [x] Add spawn handshake, version rejection, timeout, cancellation, crash detection, and bounded stdout/stderr.
- [x] Add a test proving credentials and arbitrary environment variables are absent from the child environment.
- [x] Add graceful shutdown and orphan cleanup tests.
- [x] Commit only after Rust unit tests, TypeScript contract tests, and desktop build pass.

### Task 3: Restricted file and process operations

**Files:**
- Create: `rust/brain-core/src/path_policy.rs`
- Create: `rust/brain-core/src/file_ops.rs`
- Create: `rust/brain-core/src/process_ops.rs`
- Create: `rust/brain-core/src/git_ops.rs`
- Modify: `shared/apps/desktop/src/main/runtime-command-service.ts`

- [x] Write traversal and symlink-escape tests using real temporary directories.
- [x] Implement canonical project-root binding and operation-specific path validation.
- [x] Implement atomic file reads/writes with byte limits and revision hashes.
- [x] Implement process groups, timeout, cancellation, output bounds, and cleanup.
- [x] Require an approval token for mutating operations and reject replayed tokens.
- [x] Route one existing file read and one shell execution through Rust behind a feature flag; verify fallback and rollback.

### Task 4: Workspace shell and catalog scoping

**Files:**
- Create: `shared/packages/protocol/src/workspace-types.ts`
- Modify: `shared/apps/desktop/src/renderer/app/WorkspaceModules.tsx`
- Modify: platform `src/renderer/ui.tsx` overlays
- Test: `shared/apps/desktop/src/renderer/app/workspace-selection.test.ts`

- [x] Define the six workspace families and media submodes as protocol data.
- [x] Test that the switcher is at the top of the left navigation and does not replace conversation content.
- [x] Scope projects and threads by workspace while retaining shared project files.
- [x] Persist the selected workspace and restore it without moving a conversation to another catalog.
- [x] Add empty, loading, unavailable, and migration states.

### Task 5: Document ingestion and structural anchors

**Files:**
- Create: `shared/packages/protocol/src/document-anchors.ts`
- Create: `shared/apps/desktop/src/main/document-worker-client.ts`
- Create: `workers/documents/src/worker.ts`
- Create: `shared/apps/desktop/src/renderer/app/DocumentAnnotationLayer.tsx`

- [ ] Define discriminated anchors for image, PDF, DOCX, PPTX, XLSX, and text.
- [ ] Write fixture tests that reopen and extract representative files of every format.
- [ ] Render each format with stable object IDs and coordinate transforms.
- [ ] Store immutable annotations separately from originals.
- [ ] Submit annotation IDs through chat and produce a bounded revision preview.
- [ ] Export a new valid file revision and verify it by reparsing and visual rendering.
- [ ] Run document workers outside Electron main and migrate their supervision to Rust Core.

### Task 6: Quantitative trading workspace

**Files:**
- Create: `shared/packages/protocol/src/quant-types.ts`
- Create: `shared/apps/desktop/src/main/market-data-service.ts`
- Create: `shared/apps/desktop/src/main/simulation-ledger.ts`
- Create: `shared/apps/desktop/src/renderer/app/QuantWorkspace.tsx`
- Create: `rust/brain-core/src/backtest.rs`

- [ ] Define adjusted OHLCV and turnover contracts with exchange timezone and source metadata.
- [ ] Add fixture and provider-contract tests for daily, weekly, monthly, range, and adjustment modes.
- [ ] Render candlestick and volume charts in the right plugin panel with resize and empty states.
- [ ] Implement a double-entry simulation ledger for cash, orders, fills, positions, fees, and P&L.
- [ ] Schedule strategy skills with idempotency keys and market-calendar constraints.
- [ ] Compute isolated per-skill return, drawdown, volatility, risk-adjusted return, win rate, and trade count.
- [ ] Prove no live broker order path exists in this phase.

### Task 7: Remaining workspace programs

**Files:**
- Create focused workspace components under `shared/apps/desktop/src/renderer/workspaces/`
- Create protocol contracts under `shared/packages/protocol/src/workspaces/`
- Create isolated workers under `workers/`

- [ ] Deliver software and automation using the existing local tool and approval runtime.
- [ ] Deliver data and decision with datasets, tables, charts, analysis artifacts, and reproducible calculations.
- [ ] Deliver game creation with project files, asset inspection, runnable preview, and playtest evidence.
- [ ] Deliver video creation with timeline, media assets, render jobs, cancellation, and output verification.
- [ ] Deliver music creation with tracks, clips, waveform/MIDI artifacts, render jobs, and output verification.
- [ ] Keep files as a shared project capability and avoid duplicating file browsers per workspace.

### Task 8: Search and model policy integration

**Files:**
- Modify Spring control-plane search policy and BRAIN model tool contracts in their owning repositories.
- Test server routing, desktop IPC redaction, citations, time stamping, and failure behavior.

- [ ] Route free news search first for supported market-news requests.
- [ ] Invoke paid web search only for time-sensitive or insufficient free-source queries.
- [ ] Attach source URLs and search time to current-information answers.
- [ ] Return an explicit unavailable result when search fails and prevent unsupported freshness claims.
- [ ] Add administrator enable/disable, provider, budget, quota, and audit controls with zero ordinary-user setup.
- [ ] Verify company keys remain server-side and user BYOK remains desktop-side only.

### Task 9: Persistence, diagnostics, and recovery

**Files:**
- Modify versioned local state services and error outbox under `shared/apps/desktop/src/main/`.
- Create migration, corruption, concurrency, and restart tests.

- [ ] Add schema-versioned migrations with backups and rollback behavior.
- [ ] Bound project metadata, cache, artifacts, and diagnostic retention separately.
- [ ] Restore active tasks, approvals, cancellations, and artifacts after process or device restart.
- [ ] Preserve provider-required thinking context without exposing private reasoning in diagnostics.
- [ ] Verify error reports retain structured fields and redact credentials recursively.

### Task 10: Release gates

**Files:**
- Modify platform packaging manifests and CI workflows.
- Create release evidence manifests under `docs/testing/releases/`.

- [ ] Build signed Windows installer, signed/notarized macOS DMG/ZIP, and Ubuntu AppImage/DEB for both supported architectures.
- [ ] Test clean install, upgrade from previous release, restart recovery, uninstall, and rollback.
- [ ] Run real credential-store tests on each OS.
- [ ] Run document matrix, quant simulation, workspace switching, model, search, cancellation, and crash-recovery flows.
- [ ] Publish hashes, signatures, known risks, and a truthful GO/NO-GO decision.
