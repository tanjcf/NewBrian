# Seven Workspace production GO/NO-GO — 2026-08-22

## Decision

**NO-GO for public release** — signed multi-platform installers and clean-machine install/upgrade/uninstall E2E are not complete.

**GO for internal L2 validation** on Windows dev hosts with FFmpeg available and a materialized Electron build.

## Completed gates

| Gate | Status | Evidence |
|---|---|---|
| Seven-scene L2 aggregator (10/10) | PASS | [`2026-08-22-seven-workspace-l2-run.json`](../2026-08-22-seven-workspace-l2-run.json), `pnpm test:seven-workspace-l2` |
| Brain catalog UI (project/conversation lists) | PASS | `WorkspaceModules.tsx`, `workspace-selection.test.ts` |
| Main bundle build gate | PASS | `electron.vite.config.ts`, `repair-bundle-cjs-shim.mjs`, `node --check out/main/index.js` |
| Ingest `parse_status` + extract persistence | PASS (unit) | `brain-workspace-storage.test.ts` |
| Artifact `sourceWorkspaceKey` | PASS (unit + UI) | migration 17, `GameWorkspace.tsx` |
| Media ffprobe + music-media decode + 3-shot storyboard | PASS (E2E script) | `test-electron-media-workspace.mjs` |
| Flow approval + FAILED retry | PASS (E2E script) | `test-electron-flow-workspace.mjs` |
| Engine discovery + managed install (Windows) | PASS (E2E script) | `test-electron-engine-auto-install.mjs`, `engine-discovery-service.ts` |
| Game/Video/Music structured tabs | PASS (implementation) | `VideoStoryboardPanel`, `MusicCompositionPanel`, `GameDesignPanel` |
| Windows test MSI pipeline | PASS (prior evidence) | `docs/evidence/releases/2026-08-22-windows-msi.md` |
| Layout / no-fixed-deadlines verify | PASS (repo scripts) | `pnpm verify:layout`, `verify:no-fixed-deadlines` |
| CI contract matrix (3 OS) + Windows L2 job | PASS (workflow) | `.github/workflows/seven-workspace-l2.yml` |

## Open release blockers

| Blocker | Owner phase | Notes |
|---|---|---|
| Signed Windows production MSI + clean install E2E | Phase 3 | Requires `WINDOWS_CSC_*` secrets |
| macOS notarized DMG + credential store | Phase 3 | Native host only |
| Ubuntu DEB/AppImage x64/arm64 | Phase 3 | Native host only |
| CI L2 green on every push (flaky Electron startup) | Phase 3 | Monitor first nightly/push runs |
| Epic Launcher / UE auto-install | Phase 2+ | Legal login; only `.uproproject` projects |

## Artifact hashes (test channel reference)

See `docs/evidence/releases/2026-08-22-windows-msi.md` for the latest unsigned test MSI SHA-256.

## Risk register (accepted for L2)

- UE 100GB+ download: gated on `.uproproject` detection only.
- OCR / deep Office: deferred past L2; six-format ingest anchors covered by worker + storage tests.
- macOS/Linux engine installers: Windows-first; PATH injection via `BRAIN_MANAGED_ENGINES_ROOT` is cross-platform in `shell-env.js`.
- Media E2E depends on FFmpeg on PATH (CI installs via Chocolatey).

## Next GO criteria

1. `pnpm test:seven-workspace-l2` green on Windows signed build in CI (workflow added; monitor stability).
2. macOS and Ubuntu materialized workspaces pass the same contract test bundle (contract matrix already green).
3. Release manifest with signed hash, known risks, and explicit **GO** from release engineer.
