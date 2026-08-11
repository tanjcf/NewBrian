# codeCN Windows ulit patch (升级补丁包)

Honest small upgrade packages for clients already on a known base version.

## Artifacts

| File | Role |
|------|------|
| `{version}ulit.zip` | Real patch: `app.asar` **bsdiff** + `bspatch.exe` + `apply.cmd` |
| `{version}ulit.msi` | Tiny **applicator** MSI (~same size as the zip). Embeds the zip and runs apply after install. Compatible with 1.2.7 in-app update (`msiexec`). |

These are **not** renamed full Electron MSIs (~240MB).

## Build

```powershell
# From full MSIs (default names under apps/desktop/release):
powershell -File windows/scripts/package-win-ulit-patch.ps1 `
  -BaseVersion 1.2.7 `
  -TargetVersion 1.2.9

# Or from known app.asar files (preferred when MSI extracts are already cached):
powershell -File windows/scripts/package-win-ulit-patch.ps1 `
  -BaseVersion 1.2.7 `
  -TargetVersion 1.2.9 `
  -BaseAsar "$env:LOCALAPPDATA\.codecn\resources\app.asar" `
  -TargetAsar "path\to\1.2.9\resources\app.asar"
```

Requires: Python 3 + `bsdiff4` / `pyinstaller` (first run builds `tools/bspatch.exe`). Base asar SHA-256 **must** match the installed fleet you intend to patch.

## Admin publish (1.2.7 users)

**Recommended version string:** publish as Windows release version **`1.2.9`** (plain semver), **not** `1.2.9.ulit`.

| Field | Value |
|-------|--------|
| version | `1.2.9` |
| package file | `1.2.9ulit.msi` |
| package_kind | inferred as `patch` from filename (`*ulit.msi`) |
| base asar sha256 | `b82c21ae1788228ea89b8727692ac44de98dcaff39d861532552d1a800f7735d` (codeCN **1.2.7**) |
| target asar sha256 | `d192a0405ab1b5c61827460d7549674d18735c2495380a2bbdda43aa06feec26` |

Avoid embedding `ulit` in the admin version field — clients then show `1.2.9.ulit` and local download names can become confusing (`1.2.9.ulitulit.msi` on older builds).

1. Prefer upload **`1.2.9ulit.msi`** as Windows release version **`1.2.9`**, channel `stable` (or canary first).
2. 1.2.7 clients already only know msiexec — they will download and silently install this applicator MSI, which patches `%LOCALAPPDATA%\.codecn\resources\app.asar`.
3. Optional: also publish `1.2.9ulit.zip` for manual apply (`apply.cmd`) or newer clients that understand `package_kind=patch`.

### Current artifact hashes (1.2.7 → 1.2.9)

| Artifact | Size | SHA-256 |
|----------|------|---------|
| `windows/apps/desktop/release/1.2.9ulit.msi` | 9,605,120 bytes (~9.16 MB) | `d508a658ee173c16d083778dd5532ca86bd36f67a6cfcabe90e0baacaeff9232` |
| `windows/apps/desktop/release/1.2.9ulit.zip` | 9,519,234 bytes (~9.08 MB) | `354de499c63cb0391d96f83bc3378f1b68a349aa89cc3a39e167b7b2745c865c` |

### Residual limit for already-running 1.2.7

The blank console titled `find /I "codeCN.exe"` comes from the **old client’s** deferred wait script. Replacing the patch MSI alone does **not** rewrite that script on machines still running 1.2.7. Mitigation:

1. Fully quit codeCN (tray included) **before** clicking update, or close the find window and let msiexec continue.
2. After a successful patch, newer deferred scripts use hidden `Get-Process` (no find window).
3. Ensure the published applicator MSI CA launches via `[SystemFolder]cmd.exe` so “A program required for this install…” is gone even when 1.2.7’s wait loop is ugly.

## Manual apply

1. Quit codeCN.
2. Expand `1.2.9ulit.zip`.
3. Run `apply.cmd` (resolves install root from ARP `InstallLocation`, then `%LOCALAPPDATA%\.codecn`).
   Optional: `apply.cmd "D:\Apps\codeCN"` or set `CODECN_INSTALL_ROOT`.

## Install-root resolution

Order: CLI / `CODECN_INSTALL_ROOT` / msiexec `APPLICATIONFOLDER` → Uninstall registry
`InstallLocation` / `DisplayIcon` (HKCU, HKLM, loaded HKU user hives) → per-profile
`AppData\Local\.codecn` via ProfileList → `%LOCALAPPDATA%\.codecn`.

Never uses `find /I`, `where`, or recursive filesystem search for `codeCN.exe`.

`.cmd` files are ASCII-only without UTF-8 BOM (cmd.exe on Chinese Windows mis-parses UTF-8).

## Current artifact hashes (1.2.9 → 1.2.10)

| Artifact | Size | SHA-256 |
|----------|------|---------|
| `windows/apps/desktop/release/1.2.10ulit.msi` | 9,551,872 bytes (~9.11 MB) | `9ac06c8a66cc319ae134438c1614b11e57150bb98a77b23be0431528984f147d` |
| `windows/apps/desktop/release/1.2.10ulit.zip` | 9,458,049 bytes (~9.02 MB) | `40f2ef39f6794a572eb547f98e669d3e71c495d0ed5a5012de54bde2839e65f8` |
| `windows/apps/desktop/release/1.2.10ulit-install.cmd` | wrapper | double-click-safe msiexec + log + pause on error |

Base asar sha256: `8bc72fe6c161628b2846668ed08050324515a934a7b1f5ec0b00c620b5db19ff`  
Target asar sha256: `e7aa1bfd7a0f841200c4808cfbe87ceab41bb155d0bdb23858eb5f55602fb3eb`

**Do not ship** a 1.2.10 target whose asar sha256 is `2eef29377445eec799fcd1fa8007cd0087987764e4f35419fa4080e3f514f33f`.
That build is missing `node_modules/jszip` and starts with a main-process Error dialog
(`Cannot find module 'jszip'` via exceljs). `package-win-ulit-patch.ps1` now refuses
targets that fail the exceljs/jszip asar entry + require probe.

### Flash-quit fix (interactive MSI)

Root causes of “点击运行闪退” on earlier `0014f5c6…` builds:

1. Stale UTF-8 BOM / CJK `bootstrap.cmd` left in `%LOCALAPPDATA%\codeCN-ulit-1.2.10` was **not overwritten** on reinstall; msiexec CA re-ran it → cmd exit **255** → MSI **1722** with no Chinese UI.
2. `if not "%VAR%"=="" if "%VAR:~-1%"=="." …` expands `%VAR:~-1%` even when empty → cmd **语法不正确** / exit 255.
3. Failure MessageBox needs **STA** PowerShell; MTA from msiexec silently skipped WinForms.

Current MSI CA launches `run-ulit-bootstrap.ps1` via PowerShell `-STA` (not stale `.cmd`), sets `REINSTALLMODE=amus`, ships `show-ulit-failure.ps1` next to the entry script, and strips trailing dots with delayed expansion only.

**How to run:** fully quit codeCN (tray included), then either double-click `1.2.10ulit-install.cmd` (preferred) or `1.2.10ulit.msi`.

## Current artifact hashes (1.2.10 → 1.2.14)

| Artifact | Size | SHA-256 |
|----------|------|---------|
| `windows/apps/desktop/release/1.2.14ulit.msi` | 9,580,544 bytes (~9.14 MB) | `7257bd155c9e68efae65ad8a050eaeef984b40ce5d47b2e21348bdaf0c494ac4` |
| `windows/apps/desktop/release/1.2.14ulit.zip` | 9,488,974 bytes (~9.05 MB) | `3c1760123df2cca737089cf6a1fa02590961b16bb4a8d1abc228262b3458fc80` |
| `windows/apps/desktop/release/1.2.14ulit-install.cmd` | wrapper | double-click-safe msiexec + log + pause on error |

Base asar sha256: `e7aa1bfd7a0f841200c4808cfbe87ceab41bb155d0bdb23858eb5f55602fb3eb`  
Target asar sha256: `7328013f5d08c6537a3693c94881ddd3bf9acdeeb1056fb55b9761a15f92d189`

Full MSI (optional): `windows/apps/desktop/release/codeCN 1.2.14-unsigned.msi`

**Fleet note:** this ulit only applies on the 1.2.10 asar above. Machines still on 1.2.9 need the 1.2.9→1.2.10 ulit first (or a dedicated 1.2.9→1.2.14 rebuild).

## Limits

- Base asar SHA-256 must match the patch `manifest.json` (built for that exact base). Example for the 1.2.9 fleet: `8bc72fe6c161628b2846668ed08050324515a934a7b1f5ec0b00c620b5db19ff`.
- A patch built for 1.2.8 will **refuse** to apply on 1.2.7 (hash mismatch). Publish one applicator per base fleet, or rebuild from the real installed base.
- Does not replace `codecn.exe` (version resource may still show old FileVersion; app `package.json` inside asar becomes the target version).
- Antivirus may briefly lock `bspatch.exe` / `app.asar` during apply.
- Quit codeCN fully (tray included) before applying; locked `app.asar` fails replace.
- Diagnosis log: `%TEMP%\codecn-ulit-patch.log`. On failure the applicator shows a Chinese MessageBox with the log tail.
