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

- [x] Define discriminated anchors for image, PDF, DOCX, PPTX, XLSX, and text.
- [x] Write fixture tests that reopen and extract representative files of every format.
- [x] Render each format with stable object IDs and coordinate transforms.
  - [x] PDF/image/PPTX/XLSX overlays project `objectId` rects through `projectDocumentRect`; DOCX uses stable paragraph object hits; focused transform tests pass.
- [x] Store immutable annotations separately from originals.
- [x] Submit annotation IDs through chat and produce a bounded revision preview.
- [x] Export a new valid file revision and verify it by reparsing and visual rendering.
- [x] Run document workers outside Electron main and migrate their supervision to Rust Core.

### Task 6: Quantitative trading workspace

**Files:**
- Create: `shared/packages/protocol/src/quant-types.ts`
- Create: `shared/apps/desktop/src/main/market-data-service.ts`
- Create: `shared/apps/desktop/src/main/simulation-ledger.ts`
- Create: `shared/apps/desktop/src/renderer/app/QuantWorkspace.tsx`
- Create: `rust/brain-core/src/backtest.rs`

- [x] Define adjusted OHLCV and turnover contracts with exchange timezone and source metadata.
- [x] Add fixture and provider-contract tests for daily, weekly, monthly, range, and adjustment modes.
- [x] Render candlestick and volume charts in the right plugin panel with resize and empty states.
- [x] Implement a double-entry simulation ledger for cash, orders, fills, positions, fees, and P&L.
- [x] Schedule strategy skills with stable trading-date idempotency keys, exchange-calendar decisions, weekend/holiday filtering, and failure recording.
- [x] Compute isolated per-skill return, drawdown, volatility, risk-adjusted return, win rate, and trade count.
- [x] Prove no live broker order path exists in this phase.

### Task 7: Remaining workspace programs

**Files:**
- Create focused workspace components under `shared/apps/desktop/src/renderer/workspaces/`
- Create protocol contracts under `shared/packages/protocol/src/workspaces/`
- Create isolated workers under `workers/`

- [x] Deliver software and automation using the existing local tool and approval runtime.
  - [x] Discover only approved package scripts and execute them through Rust Core approval, true UTF-8 byte-bounded output, timeout, cancellation, and task status IPC.
  - [x] Persist every terminal state in SQLite, reject execution before approval, ignore late completion after cancellation, and reconcile interrupted tasks as failed without replaying side effects; 21 focused Windows tests and the Electron production build pass.
- [x] Deliver data and decision with datasets, tables, charts, analysis artifacts, and reproducible calculations.
  - [x] Import bounded CSV datasets, persist metadata, restore rows after restart through hash-checked project-bound IPC, and provide paginated/filterable table UI.
  - [x] Add deterministic numeric summary computation keyed by dataset source hash and persist it through IPC/SQLite.
  - [x] Expose bounded numeric trend data and an SVG chart in the data workspace; cap samples at 256, preserve empty states, persist hash-bound summaries, and verify the Windows Electron production build.
- [x] Deliver game creation with project files, asset inspection, runnable preview, and playtest evidence.
  - [x] Inspect authorized Web, Godot, Unity, and Unreal projects with bounded, non-symlink-following asset counts.
  - [x] Surface verified preview scripts as approval-gated conversation requests without direct renderer execution.
  - [x] Supervise preview start, readiness, cancellation, bounded logs, restart reconciliation, and screenshot playtest evidence through the execution boundary.
- [x] Deliver video creation with timeline, media assets, render jobs, cancellation, and output verification.
  - [x] Define the FFmpeg/FFprobe runtime prerequisite and keep missing-tool behavior explicit when binaries are absent.
  - [x] Real FFmpeg encoding verified on Windows through `media-render-real-process.test.ts` + VideoRenderService + Rust Core (2026-08-20 re-run: 2/2 pass, ~1.8s). Evidence: FFprobe `format.duration > 0` on short MP4 output; event-driven cancel settles `CANCELLED`/`BRAIN_CORE_CANCELLED` without late success. Command: `node --experimental-strip-types --test src/main/media-render-real-process.test.ts` with `BRAIN_FFMPEG_BINARY` / `BRAIN_FFPROBE_BINARY` / `BRAIN_RUST_CORE_BINARY`.
  - [x] Desktop UI click-through verified via `pnpm test:media-workspace-runtime` / `scripts/test-electron-media-workspace.mjs` (2026-08-20): file select → add clip → native approval → `SUCCEEDED` → preview ready + `outputFileId` (`file_62a38972-…`); screenshot `%TEMP%\brain-video-workspace-preview.png`.
- [x] Deliver music creation with tracks, clips, waveform/MIDI artifacts, render jobs, and output verification.
  - [x] Persist timelines and clips, inspect WAV/MIDI metadata, expose bounded WAV waveform samples, pass authorized audio media into approved Rust Core render jobs, and verify output boundary.
  - [x] Real FFmpeg encoding verified on Windows through `media-render-real-process.test.ts` + MusicRenderService + Rust Core (same 2026-08-20 re-run). Evidence: FFprobe `format.duration > 0` on short WAV output; SQLite task/artifact persistence covered by related storage tests.
  - [x] Desktop UI click-through verified via `test-electron-media-workspace.mjs` (2026-08-20): music workspace render → `SUCCEEDED` / preview ready; screenshot `%TEMP%\brain-music-workspace-preview.png`.
- [x] Keep files as a shared project capability and avoid duplicating file browsers per workspace.
  - [x] Shared `ProjectFilePicker` + project-scoped `activeBrainDocumentFileId` bind Video/Music/Data; Files tab remains the single project file list.
  - [x] Verify versioned DOCX paragraph, XLSX cell, and PPTX shape-text writeback with owner-scoped change sets, output boundaries, SHA-256 registration, and focused Windows tests.
  - [x] Add PDF page/rectangle annotation writeback with pdf-lib, versioned output and bounds validation; Windows unit tests and Electron production build pass.
  - [x] CJK annotation text embeds a system font via `@pdf-lib/fontkit` (`simhei` / Noto Sans SC / YaHei). `pdf-annotation-writer.test.ts` asserts `usedCjkFont=true` and unreplaced Chinese text; Electron case `test-electron-brain-pdf-annotation.mjs` exports annotated `note.v2.pdf`.
  - [x] Codex document annotate → accept → export Electron E2E: `test-electron-brain-document-revision.mjs` (markdown structural anchors → `note.v2.md`).
  - [x] OpenClaw image/video Auto-tools path E2E: `test-openclaw-media-gateway-e2e.mjs` proves `wait=false` invoke + `/auto/tools/jobs` poll for `image_generate` / `video_generate` against a local mock gateway (live vendor keys still optional when spring-app is reachable).

### Task 8: Search and model policy integration

**Files:**
- Modify Spring control-plane search policy and BRAIN model tool contracts in their owning repositories.
- Test server routing, desktop IPC redaction, citations, time stamping, and failure behavior.

- [x] Route free news search first for supported market-news requests.
  - [x] spring-app `WebSearchOrchestrator` + `FreeNewsSearchService`; desktop tool `news_search_free` → `POST /api/desktop/v1/market-news-search`. `WebSearchOrchestratorTest` proves FREE_ONLY skips paid when free news is sufficient.
- [x] Invoke paid web search only for time-sensitive or insufficient free-source queries.
  - [x] Orchestrator upgrades at most once (`FREE_THEN_PAID`); paid path remains `web.search_paid` / Bocha gateway. Unit evidence: `WebSearchOrchestratorTest.callsPaidOnceWhenFreeNewsInsufficient`.
- [x] Attach source URLs and search time to current-information answers.
  - [x] Tool payloads include `searchedAt` + URLs/`citationBlock`; agent-loop `finalizeDesktopWebSearchAnswer` appends `来源（检索时间 …）` from tool evidence. Unit-tested in `desktop-web-search.test.ts` and `CitationValidationServiceTest`.
- [x] Return an explicit unavailable result when search fails and prevent unsupported freshness claims.
  - [x] `WEB_SEARCH_UNAVAILABLE` tool/status paths + `assertAnswerAllowsFreshnessClaims` / finalizer block freshness without evidence.
- [x] Add administrator enable/disable, provider, budget, quota, and audit controls with zero ordinary-user setup.
  - [x] Admin API `GET/PUT /api/admin/v1/web-search-policy`, `GET /api/admin/v1/web-search-audit`; Vue panel `WebSearchPolicySection` (provider shown as company Bocha). Defaults enable search with free-first so ordinary users need no setup.
- [x] Verify company keys remain server-side and user BYOK remains desktop-side only.
  - [x] Desktop client sends only session auth to Spring; company `app.web-search.token` stays on server. Desktop unit tests assert Authorization is the session bearer and no Bocha key is accepted from the client path.

Desktop progress: free-first orchestration + admin policy/audit + citation finalizer landed; live gateway E2E against AKShare/Bocha still depends on reachable search nodes.

### Task 9: Persistence, diagnostics, and recovery

**Files:**
- Modify versioned local state services and error outbox under `shared/apps/desktop/src/main/`.
- Create migration, corruption, concurrency, and restart tests.

- [x] Add schema-versioned migrations with backups and rollback behavior.
- [x] Bound project metadata, cache, artifacts, and diagnostic retention separately.
  - [x] `brain-retention-policy` + `pruneRetention` / `DesktopErrorOutbox.pruneSent` enforce separate count/age budgets; focused storage tests pass.
- [x] Restore active tasks, approvals, cancellations, and artifacts after process or device restart.
  - [x] Startup `restoreWorkspaceAfterRestart` fail-closes interrupted game/software/media tasks, preserves CANCELLED markers, and invalidates missing artifacts without replaying side effects. Main-thread model-chat approval resume remains delegated/Holon checkpoint based (unchanged).
- [x] Preserve provider-required thinking context without exposing private reasoning in diagnostics.
- [x] Verify error reports retain structured fields and redact credentials recursively.

### Task 10: Release gates

**Files:**
- Modify platform packaging manifests and CI workflows.
- Create release evidence manifests under `docs/testing/releases/`.

- [ ] Build signed Windows installer, signed/notarized macOS DMG/ZIP, and Ubuntu AppImage/DEB for both supported architectures.
- [ ] Test clean install, upgrade from previous release, restart recovery, uninstall, and rollback.
- [ ] Run real credential-store tests on each OS.
- [ ] Run document matrix, quant simulation, workspace switching, model, search, cancellation, and crash-recovery flows.
- [ ] Publish hashes, signatures, known risks, and a truthful GO/NO-GO decision.
