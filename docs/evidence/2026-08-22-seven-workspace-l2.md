# Seven Workspace L2 acceptance evidence — 2026-08-22

## Verdict

**Phase 1 L2 gate: PASS (10/10)** — Windows materialized desktop run on 2026-08-22 completed all child suites sequentially; machine-readable output in [`2026-08-22-seven-workspace-l2-run.json`](./2026-08-22-seven-workspace-l2-run.json).

| Metric | Value |
|---|---|
| Aggregator caseId | `BRAIN-SEVEN-WORKSPACE-L2-E2E` |
| Suites | 10 / 10 green |
| Total wall time | ~183 s (local Windows dev host) |
| Build gate | `pnpm build` + `node --check out/main/index.js` |

## Aggregator

| Field | Value |
|---|---|
| Script | `platforms/windows/apps/desktop/scripts/test-electron-seven-workspace-l2.mjs` |
| Root entry | `pnpm test:seven-workspace-l2` |
| caseId | `BRAIN-SEVEN-WORKSPACE-L2-E2E` |

### Child suites (sequential)

| Suite | Script | caseId | Duration (ms) |
|---|---|---|---|
| workspace-section-restart | `test-electron-workspace-section-restart.mjs` | `BRAIN-WORKSPACE-SECTIONS-RESTART-E2E` | 84387 |
| quant | `test-electron-quant-workspace.mjs` | `BRAIN-QUANT-WORKSPACE-E2E` | 10483 |
| data | `test-electron-data-workspace.mjs` | `BRAIN-DATA-WORKSPACE-E2E` | 10665 |
| flow | `test-electron-flow-workspace.mjs` | `BRAIN-FLOW-WORKSPACE-E2E` | 10408 |
| document-revision | `test-electron-brain-document-revision.mjs` | `BRAIN-DOC-REVISION-E2E` | 13142 |
| pdf-annotation | `test-electron-brain-pdf-annotation.mjs` | `BRAIN-PDF-CJK-ANNOTATION-E2E` | 9966 |
| media | `test-electron-media-workspace.mjs` | `BRAIN-MEDIA-WORKSPACE-E2E` | 18671 |
| game | `test-electron-game-workspace.mjs` | `BRAIN-GAME-WORKSPACE-E2E` | 11588 |
| game-template | `test-electron-game-template.mjs` | `BRAIN-GAME-TEMPLATE-E2E` | 9471 |
| engine-auto-install | `test-electron-engine-auto-install.mjs` | `BRAIN-ENGINE-AUTO-INSTALL-E2E` | 2055 |

## Contract / unit evidence

| Area | Test file | Assertion |
|---|---|---|
| SQLite ingest | `brain-workspace-storage.test.ts` | `parse_status=READY`, `recordFileIngestResult` for TXT/MD/PNG/PDF/DOCX/PPTX/XLSX |
| Artifact lineage | `brain-workspace-storage.test.ts` | `sourceWorkspaceKey` inherited from task |
| Document worker | `document-worker-formats.test.ts` | six-format anchors > 0, reopen stability |
| Simulation ledger | `simulation-ledger.test.ts` | cash + marketValue conservation after buy |
| Quant gateway | `quant-market-contract.test.ts` | skip without `BRAIN_MARKET_DATA_URL`; live health when set |
| Flow service | `flow-execution-service.test.ts` | approval, unregistered tool FAILED |
| Engine discovery | `engine-discovery-service.test.ts` | managed/system resolution |
| Managed PATH | `shell-env.test.js` | `BRAIN_MANAGED_ENGINES_ROOT` prepends ffmpeg bin |
| Music WAV parse | `music-media-service.test.ts` | duration + waveform; skips LIST chunk before `data` |
| PPTX shape rewrite | `pptx-shape-rewriter.test.ts` | shape text replacement in OOXML |

## Phase 2 additions (same branch)

| caseId | Scope |
|---|---|
| `BRAIN-GAME-TEMPLATE-E2E` | One-click Web game template + inspect READY |
| `BRAIN-ENGINE-AUTO-INSTALL-E2E` | `discoverBrainEngines` / `ensureBrainEngine` IPC surface (managed/system ffmpeg path) |
| `BRAIN-MEDIA-WORKSPACE-E2E` (extended) | 3-shot storyboard → timeline push; music `<audio>` metadata + ffprobe duration |

Engine auto-install downloads FFmpeg/Godot on Windows when `BRAIN_ENGINE_AUTO_INSTALL !== "false"`. Epic/UE chain remains manual-first-login only.

## How to reproduce (Windows)

```powershell
pnpm install --frozen-lockfile
pnpm materialize:windows
cd .materialized/windows/apps/desktop
pnpm test:brain-workspace-storage
pnpm test:simulation-ledger
pnpm test:document-worker-formats
# After Electron production build + session helper:
pnpm test:seven-workspace-l2
```

## Known gaps

- macOS/Ubuntu managed engine installer mirrors Windows in Phase 3 packaging gate only.
- Signed release GO/NO-GO tracked separately in `docs/evidence/releases/2026-08-22-seven-workspace-go-no-go.md`.
