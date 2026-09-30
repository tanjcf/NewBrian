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
- [x] Add spawn handshake, version rejection, event-driven cancellation, crash detection, and bounded stdout/stderr; execution has no fixed wall-clock deadline.
  - [x] Remove the final Windows attachment/document extractor 30-second deadline. Extraction now continues until completion, explicit caller cancellation, process failure, or bounded-output rejection; focused cancellation/output tests pass in the materialized Windows workspace on 2026-08-22.
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
- [x] Implement process groups, event-driven cancellation, output bounds, and cleanup without a fixed execution deadline.
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
- [x] Left catalog uses Claude Code / NewBrain local folder projects (`projects-section` + `WorkspaceCatalogItem.path`), filtered by `brainWorkspaceKey` (missing → `document`); unbound history defaults to 文档创作; cross-scene「最近」;「新对话」binds the current scene project thread. `brain_project` remains metadata bridge only, not the primary sidebar list (2026-08-22).

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
  - [x] Windows Electron `BRAIN-QUANT-WORKSPACE-E2E` uses a real local market-adapter HTTP boundary and visible right-panel interactions to load 12 validated bars, render K-line/volume marks, execute a 100-share simulated buy, verify the persisted fill/position/equity curve, and create a radar schedule that enters only the simulation queue. The case also verifies that no live-broker order action is exposed (2026-08-22).
  - [x] Remove the remaining fixed request deadlines from market-data and exchange-calendar provider calls. Focused tests assert that neither provider request receives a timer-generated abort signal; requests now settle through provider completion/failure or application/network lifecycle instead of a fixed number of seconds (2026-08-22).

### Task 7: Remaining workspace programs

**Files:**
- Create focused workspace components under `shared/apps/desktop/src/renderer/workspaces/`
- Create protocol contracts under `shared/packages/protocol/src/workspaces/`
- Create isolated workers under `workers/`

- [ ] Deliver software and automation using the existing local tool and approval runtime.
  - [x] Discover only approved package scripts and execute them through Rust Core approval, true UTF-8 byte-bounded output, event-driven cancellation, and task status IPC; no fixed execution deadline is applied.
  - [x] Persist every terminal state in SQLite, reject execution before approval, ignore late completion after cancellation, and reconcile interrupted tasks as failed without replaying side effects; 21 focused Windows tests and the Electron production build pass.
  - [x] Split project files, code tasks, project terminal, tests, Flow, and deployment into real right-panel views. Files reuse the shared file panel; deploy accepts only an explicitly declared `package.json` script and still requires native approval; terminal paths are resolved from the authorized project by Electron main and cannot be supplied by the renderer.
  - [x] Remove the remaining software/game approval expiry by registering one-time project-scoped Rust grants with `ttl_ms=0`; process resources also keep `timeout_ms=0`. Windows focused tests (30/30) and Windows/macOS ARM64/Ubuntu x64 production builds pass on 2026-08-22.
  - [ ] Verify opening and using the native project terminal on actual Windows, macOS, and Ubuntu desktops; cross-target builds prove compilation but do not substitute for native terminal runtime evidence.
    - [x] Windows no longer launches a detached PowerShell window: the software right panel embeds the project terminal, resolves its cwd only from the authorized project in Electron main, streams bounded terminal history, and accepts user input without a fixed execution deadline. `BRAIN-WORKSPACE-SECTIONS-RESTART-E2E` starts it, waits for startup completion, submits `Write-Output BRAIN_TERMINAL_E2E`, and verifies both the host-session snapshot and visible panel output (2026-08-22).
    - [ ] Repeat the native input/output lifecycle on physical macOS and Ubuntu hosts.
- [x] Deliver data and decision with datasets, tables, charts, analysis artifacts, and reproducible calculations.
  - [x] Import bounded CSV datasets, persist metadata, restore rows after restart through hash-checked project-bound IPC, and provide paginated/filterable table UI.
  - [x] Add deterministic numeric summary computation keyed by dataset source hash and persist it through IPC/SQLite.
  - [x] Expose bounded numeric trend data and an SVG chart in the data workspace; cap samples at 256, preserve empty states, persist hash-bound summaries, and verify the Windows Electron production build.
- [x] Deliver game creation with project files, asset inspection, runnable preview, and playtest evidence.
  - [x] Inspect authorized Web, Godot, Unity, and Unreal projects with bounded, non-symlink-following asset counts.
  - [x] Surface verified preview scripts as approval-gated conversation requests without direct renderer execution.
  - [x] Supervise preview start, readiness, cancellation, bounded logs, restart reconciliation, and screenshot playtest evidence through the execution boundary.
  - [x] Replace planning placeholders with revisioned, owner/project/workspace-scoped editors for game design, characters/world, levels, and combat; SQLite restart/isolation/conflict tests and all three target builds pass.
  - [x] Windows Electron `BRAIN-WORKSPACE-SECTIONS-RESTART-E2E` verifies visible game-planning tab editing and saving, two-project isolation, full application exit, fresh-process restart, and durable restoration. The shared revisioned editor/storage path covers design, characters/world, levels, and combat; the case exercises `design` end to end and storage tests cover arbitrary validated section keys.
- [x] Deliver video creation with timeline, media assets, render jobs, cancellation, and output verification.
  - [x] Define the FFmpeg/FFprobe runtime prerequisite and keep missing-tool behavior explicit when binaries are absent.
  - [x] Real FFmpeg encoding verified on Windows through `media-render-real-process.test.ts` + VideoRenderService + Rust Core (2026-08-20 re-run: 2/2 pass, ~1.8s). Evidence: FFprobe `format.duration > 0` on short MP4 output; event-driven cancel settles `CANCELLED`/`BRAIN_CORE_CANCELLED` without late success. Command: `node --experimental-strip-types --test src/main/media-render-real-process.test.ts` with `BRAIN_FFMPEG_BINARY` / `BRAIN_FFPROBE_BINARY` / `BRAIN_RUST_CORE_BINARY`.
  - [x] Desktop UI click-through verified via `pnpm test:media-workspace-runtime` / `scripts/test-electron-media-workspace.mjs` (2026-08-20): file select → add clip → native approval → `SUCCEEDED` → preview ready + `outputFileId` (`file_62a38972-…`); screenshot `%TEMP%\brain-video-workspace-preview.png`.
  - [x] Replace script/storyboard/caption placeholders with revisioned project-scoped editors without changing the existing media/timeline/export pipeline.
  - [x] The same Windows Electron restart case edits and saves the visible video script tab, fully exits Electron, starts a new process against the same profile, and restores the project/scene-bound script without game or music leakage. Storyboard and caption use the same validated section contract.
- [x] Deliver music creation with tracks, clips, waveform/MIDI artifacts, render jobs, and output verification.
  - [x] Persist timelines and clips, inspect WAV/MIDI metadata, expose bounded WAV waveform samples, pass authorized audio media into approved Rust Core render jobs, and verify output boundary.
  - [x] Real FFmpeg encoding verified on Windows through `media-render-real-process.test.ts` + MusicRenderService + Rust Core (same 2026-08-20 re-run). Evidence: FFprobe `format.duration > 0` on short WAV output; SQLite task/artifact persistence covered by related storage tests.
  - [x] Desktop UI click-through verified via `test-electron-media-workspace.mjs` (2026-08-20): music workspace render → `SUCCEEDED` / preview ready; screenshot `%TEMP%\brain-music-workspace-preview.png`.
  - [x] Replace lyrics/arrangement/mix placeholders with revisioned project-scoped editors without changing the existing audio/track/export pipeline.
  - [x] The same Windows Electron restart case edits and saves the visible lyrics tab, fully exits Electron, starts a new process against the same profile, and restores the project/scene-bound lyrics without game or video leakage. Arrangement and mix use the same validated section contract.
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
  - [x] Migration 14 binds legacy/unrecognized project and conversation workspace values to `document`; a real pre-migration SQLite fixture proves the historical project appears only in 文档创作 and its conversation snapshot becomes `document`.
  - [x] Windows Electron `BRAIN-WORKSPACE-SECTIONS-RESTART-E2E` creates projects and conversations in all seven workspaces, proves each scene's left catalog excludes every foreign-scene project/conversation, fully exits the application, and repeats the isolation assertions after a fresh-process restart (2026-08-22).
- [x] Bound project metadata, cache, artifacts, and diagnostic retention separately.
  - [x] `brain-retention-policy` + `pruneRetention` / `DesktopErrorOutbox.pruneSent` enforce separate count/age budgets; focused storage tests pass.
- [x] Restore active tasks, approvals, cancellations, and artifacts after process or device restart.
  - [x] Startup `restoreWorkspaceAfterRestart` fail-closes interrupted game/software/media tasks, preserves CANCELLED markers, and invalidates missing artifacts without replaying side effects. Main-thread model-chat approval resume remains delegated/Holon checkpoint based (unchanged).
- [x] Preserve provider-required thinking context without exposing private reasoning in diagnostics.
- [x] Verify error reports retain structured fields and redact credentials recursively.

### Task 10: Release gates

**Files:**
- Modify platform packaging manifests and CI workflows.
- Create release evidence manifests under `docs/evidence/releases/`.

- [ ] Build signed Windows installer, signed/notarized macOS DMG/ZIP, and Ubuntu AppImage/DEB for both supported architectures.
  - Partial (2026-08-21): **unsigned** Windows MSI package build succeeded from `.materialized/windows-build` via `pnpm package:win-msi`. Artifact `NewBrain 1.3.0.msi` + SHA-256 recorded in `docs/evidence/releases/2026-08-21-windows-msi.md`. Signing identity not configured; macOS/Ubuntu packages **not built**.
- [ ] Test clean install, upgrade from previous release, restart recovery, uninstall, and rollback.
  - Install/start **NOT RUN** on evidence host (documented in the same release note to avoid machine-wide install risk).
- [ ] Run real credential-store tests on each OS.
  - Still blocked / not run for release gate (no multi-OS credential-store evidence in this pass).
- [ ] Run document matrix, quant simulation, workspace switching, model, search, cancellation, and crash-recovery flows.
  - [x] Quant simulation runtime matrix passes on Windows through `BRAIN-QUANT-WORKSPACE-E2E`: provider data, chart rendering, simulated order/fill/position/accounting, and radar schedule creation are observed through the production Electron UI. Thirty focused market/calendar/ledger/scheduler/task-runner tests also pass (2026-08-22).
  - Not part of this packaging-only evidence pass; still open for release gate.
  - [x] Remove fixed wall-clock termination from the normalized capability provider, Tool Host, foreground/background shell execution, model-step wrapper, SSE reader, model callbacks, and research-intake model calls. These paths now settle only through completion, provider/process failure, explicit cancellation, or application shutdown; output and iteration bounds remain independent safety controls.
  - [x] Remove timer-generated aborts from Auto routing, user-knowledge push/pull, official-government search/read, market data/calendar, Agent Turn, Holon, Growth, and local/gateway novel speech. Explicit caller/user cancellation is preserved; response-byte, redirect, retry-count, authorization, and output bounds remain. Windows focused tests cover absent synthetic abort signals and the production Electron build passes (2026-08-22).
  - [x] Remove both Kokoro's 30-second worker-start and 170-second inference termination. Worker readiness now settles by ready/error/exit, inference settles by result/error/exit, and user stop immediately resolves the logical speech request while the warm isolated worker safely finishes/discards in-flight inference rather than being killed mid-model-load (2026-08-22).
  - [x] Remove fixed request termination from desktop authentication/model discovery, ClawHub access, and legacy MCP health/tool calls. Game preview readiness no longer aborts each probe after one second or stops after sixty attempts; it continues until ready, process completion/failure, application shutdown, or explicit user cancellation, and cancellation aborts the active readiness request. The repository guard now scans 21 task-critical files for timer-generated aborts and fixed timeout error contracts. Focused Windows tests pass 72/72 and the production Electron build passes (2026-08-22).
  - [x] Remove the child-agent 120-second wait deadline and its destructive timeout branch. `agent.wait` now settles through child completion/failure/cancellation, never interrupts a child because wall-clock time elapsed, and returns `wait_unavailable` only when no active run handle exists after recovery. Focused collaboration/security tests pass 32/32; the repository guard covers 22 critical files and the Windows production Electron build passes (2026-08-22).
  - [x] Bind projects and conversations to their workspace scene, persist independent selections for every scene, and migrate unbound historical project/conversation records to `document`. Real temporary SQLite migration/restart/owner-isolation tests and renderer scene-selection contract tests pass as part of the same 72-test Windows gate (2026-08-22).
  - [x] Re-run the production Electron `BRAIN-WORKSPACE-SECTIONS-RESTART-E2E` against a fresh isolated profile: all seven scenes expose only their own project/conversation catalogs; the embedded software terminal accepts and renders real PowerShell input; game/video/music project-scoped content remains isolated; a full application exit and fresh process restore every catalog and saved section (2026-08-22).
  - [x] Correct the document capability routing mismatch: the `files` capability returns to the shared project file panel, while `citation` maps to the document references view; the renderer contract test passes 19/19 and the Windows protocol/desktop production build passes (2026-08-22).
  - [x] Windows Test MSI packaging now stages the document worker explicitly and fails closed when `newbrain.bootstrap.json` or `document-worker.js` is absent; the rebuilt unpacked artifact contains both resources and the unsigned Test MSI is generated (2026-08-22).
  - [x] Re-run the scene-bound Electron flows with the current left-side workbench switcher and right-side capability tabs: document revision, quant simulation, video render/preview, and music render/preview all pass; video/music E2E follows the approved prototype navigation (2026-08-22).
  - [x] Repair stale macOS and Ubuntu platform lockfiles against the current shared document/media dependency graph. macOS ARM64/x64 and Ubuntu ARM64/x64 now pass offline frozen installation, protocol/UI/agentd compilation, and complete production Electron builds from freshly materialized workspaces. This is cross-target compile evidence only; physical-host terminal, credential-store, install, and uninstall evidence remains open (2026-08-22).
- [ ] Publish hashes, signatures, known risks, and a truthful GO/NO-GO decision.
  - Partial: Windows MSI hash published in `docs/evidence/releases/2026-08-21-windows-msi.md`. Signature: none (unsigned). Multi-OS GO/NO-GO = **NO-GO** (macOS/Ubuntu/notarization/full matrix blocked). Conditional note only for unsigned Windows package-build success.
