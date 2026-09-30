# Windows Test MSI packaging evidence — 2026-08-22

## Verdict

**Test package build: PASS** (unsigned MSI produced after a fresh materialization and offline frozen install).  
**Required resource validation: PASS** (`codecn.bootstrap.json` and `document-worker.js` are present in `win-unpacked/resources`).  
**Install/start and signed release: NOT RUN / NO-GO** (this is a test artifact; no signing identity or clean-machine install evidence was available).

## Build evidence

- Materialized source: `.materialized/windows`
- Command: `pnpm install --offline --frozen-lockfile`
- Command: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-win-msi.ps1 -Channel Test`
- Electron production build: PASS
- Renderer workspace contract: 19/19 PASS
- Protocol build: PASS
- MSI: `.materialized/windows/apps/desktop/release/test/codeCN 1.3.0-test-unsigned.msi`
- MSI size: `266,683,596` bytes
- MSI SHA-256: `49C4A0E1CA8AA2AB7B5338CE70974BF41195C2954E2C8340A63A4F61F2B6A3E5`
- Unpacked resources: `.materialized/windows/apps/desktop/release/_p/3856-1/win-unpacked/resources/`
- Signature: `NotSigned` (expected for Test channel)

The packaging script now synchronizes the document Worker before electron-builder runs and fails closed when either the source or packaged Worker is missing. It also validates the bootstrap configuration at the source and unpacked-resource boundaries.

## Remaining release gates

- Signed Windows MSI and production certificate configuration.
- Clean install, first launch, upgrade, restart recovery, uninstall, reinstall, and rollback.
- Signed/notarized macOS artifacts and Ubuntu AppImage/DEB on their native hosts.
- Physical native terminal and credential-store evidence on macOS and Ubuntu.

Therefore this artifact is valid test-packaging evidence, not a release GO decision.
