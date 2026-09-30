# Windows MSI packaging evidence — 2026-08-21 (partial Task 10)

## Verdict

**Package build: PASS** (unsigned MSI produced)  
**Install/start: NOT RUN** (skipped to avoid machine-wide install risk/time)  
**Multi-OS release gate: NO-GO** (Windows package only; macOS/Ubuntu/signing/notarization/full matrix blocked)

## Date / host

| Field | Value |
| --- | --- |
| Date (local) | 2026-08-21T00:44:02+08:00 (hash/metadata capture; MSI build finished ~00:43) |
| Host | DESKTOP-JC7IHI2 |
| OS | Windows_NT 10.0.22631 (Microsoft Windows NT 10.0.22631.0) |
| Arch | AMD64 / x64 |
| Node | v24.15.0 |
| pnpm | 10.0.0 |
| electron-builder | 25.1.8 |
| Electron (packaged) | 35.7.5 |
| App version | 1.3.0 (`@codex-forge/desktop`) |
| Git HEAD (BRAIN workspace) | `18243f557f516fa0e91a7c98b0ca5314d69812bc` (`18243f5`) |
| Git status note | `main` ahead of `origin/main` by 2; working tree had unrelated local modifications at capture time — MSI was built from materialized tree `.materialized/windows-build` |

## Materialized tree

- Preferred tree: `.materialized/windows-build`
- Electron present: yes — `.materialized/windows-build/apps/desktop/node_modules/electron`
- Fresh materialize/sync: **not required** for this run (usable tree already present)

## Commands used

```text
cd /d I:\G盘迁移备份\workrpase\BRAIN\.materialized\windows-build\apps\desktop
pnpm package:win-msi
```

Equivalent script: `node node_modules/electron-builder/cli.js --win msi`

Build wall time: ~379 s (~6.3 min). Exit code: **0**.

## Artifacts

| Artifact | Path | Size (bytes) |
| --- | --- | --- |
| MSI | `I:\G盘迁移备份\workrpase\BRAIN\.materialized\windows-build\apps\desktop\release\codeCN 1.3.0.msi` | 266441685 |
| Unpacked | `...\apps\desktop\release\win-unpacked\` (includes `codecn.exe`) | (directory) |
| Builder debug | `...\apps\desktop\release\builder-debug.yml` | 1353 |

### SHA-256

```text
06B043F62E0D592434FEC488BD0EC2459F95C096EFF463EFAF83A3912E09DA62  codeCN 1.3.0.msi
```

Command:

```powershell
Get-FileHash -LiteralPath '...\release\codeCN 1.3.0.msi' -Algorithm SHA256
```

## Signing

**Unsigned.**

electron-builder logged:

- `signing with signtool.exe` then `no signing info identified, signing is skipped` for both `codecn.exe` and `codeCN 1.3.0.msi`
- `signHook=false`, `cscInfo=null`

No Authenticode certificate / CSC env was configured for this run.

## Build warnings (non-fatal)

- `file source doesn't exist` — `.materialized\codecn.bootstrap.json`
- `file source doesn't exist` — `...\apps\desktop\build\rust-core\brain-core.exe`

Packaging still completed and produced the MSI.

## Install / start attempt

**NOT RUN.** Rationale: machine-wide MSI install is risky/long for this evidence pass; Task 10 partial goal was package build + hash + honest status. No clean-install, upgrade, restart-recovery, uninstall, or rollback evidence on this host.

## BLOCKED (honest)

| Item | Status |
| --- | --- |
| Signed Windows installer | BLOCKED (no signing identity / CSC) |
| macOS signed + notarized DMG/ZIP | BLOCKED (not this host / not run) |
| Ubuntu AppImage/DEB (arch matrix) | BLOCKED (not this host / not run) |
| Full multi-OS release matrix | BLOCKED |
| Clean install / upgrade / uninstall / rollback | NOT RUN |
| Real credential-store tests per OS | BLOCKED / NOT RUN |
| Document matrix, quant, workspace, model, search, cancel, crash-recovery on packaged app | NOT RUN (this evidence is packaging-only) |
| Notarization | BLOCKED (macOS-only; N/A here) |

## GO / NO-GO

**NO-GO** for multi-OS signed release promotion.

**CONDITIONAL** only for “Windows unsigned MSI package build succeeded on this host” — usable as packaging evidence, **not** as a ship gate.

## Evidence file

This document: `docs/evidence/releases/2026-08-21-windows-msi.md`
