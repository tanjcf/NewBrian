# codeCN for macOS

The macOS desktop app lives in `apps/desktop` and shares the protocol/UI packages in this workspace. This tree is kept in feature parity with `windows/` (currently **0.1.65**), with macOS packaging, entitlements, and platform defaults layered on top.

## Development

```bash
pnpm install
pnpm --dir apps/desktop dev
```

## Validation

```bash
pnpm --dir apps/desktop check
pnpm --dir packages/protocol check
pnpm --dir apps/desktop test:storage
pnpm --dir apps/desktop test:package-resources
pnpm --dir apps/desktop build
```

## Package DMG and ZIP

Supports **Apple Silicon (`arm64`)** and **Intel (`intel`)** so Monterey / newer macOS on either chip can install the matching build (Electron 35 requires macOS 11+).

```bash
# Current machine arch only
pnpm --dir apps/desktop package:mac

# Explicit
pnpm --dir apps/desktop package:mac:arm64   # Apple Silicon
pnpm --dir apps/desktop package:mac:intel   # Intel Mac
pnpm --dir apps/desktop package:mac:all     # both
```

Artifacts (examples):

- `codeCN Mac-0.1.65-arm64.dmg` — Apple Silicon
- `codeCN Mac-0.1.65-intel.dmg` — Intel

The packaging helper sanitizes local configuration before copying it into the app (API keys, shortcuts, MCP servers, worktree paths). By default it rewrites `127.0.0.1` to the production host (`CODECN_PACKAGE_HOST`, default `120.48.151.202`). Set `CODECN_PACKAGE_KEEP_LOCALHOST=1` to keep loopback endpoints for local smoke builds.

It uses a complete locally installed Electron runtime when available, otherwise restores one from the Electron cache before falling back to a download.

For a faster unpacked-app smoke build without DMG/ZIP creation:

```bash
pnpm --dir apps/desktop package:mac:dir
```

Artifacts are written to `apps/desktop/release`. Per-arch checksums: `SHA256SUMS-arm64.txt` / `SHA256SUMS-intel.txt`.

### Asar hotfix (in-app upgrade patch)

For replacing `app.asar` / selected Resources without a full installer:

```bash
pnpm --dir apps/desktop package:mac:hotfix
# optional: CODECN_HOTFIX_MIN_VERSION=0.1.65 CODECN_HOTFIX_EXTRA_RESOURCES=codecn.features.json
```

Produces `codeCN Mac-<version>-<arch>.hotfix.zip` plus `mac-hotfix-manifest-<version>.json`. Publish with `package_kind: "hotfix"` (or a `.hotfix.zip` download URL). Packaged apps can download and apply it from Settings → 更新, then relaunch. Dev/`electron .` mode cannot apply hotfixes.

Builtin plugins under `apps/desktop/build/plugins` are bundled as `extraResources`.

## System PATH on macOS

GUI launches inherit a minimal PATH (`/usr/bin:/bin:...`). At startup the main process resolves a full user PATH from:

1. login interactive shell (`$SHELL -ilc 'printf %s "$PATH"'`)
2. `/usr/libexec/path_helper -s`
3. common locations such as Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) and `~/.local/bin`

The resolved PATH is written to `process.env.PATH` and used for shell env, conda/node discovery, and tool lookups. Startup writes `system PATH resolved ...` into `tmp-desktop-debug.log`.

```bash
pnpm --dir apps/desktop test:system-path
```

## Signing and notarization

electron-builder signs automatically when a valid Developer ID Application identity is available. Notarization is enabled when either credential set is present:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`; or
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; or
- `APPLE_KEYCHAIN` and `APPLE_KEYCHAIN_PROFILE`.

Never commit signing credentials or a populated local `codecn.config.json`.

The repository also includes the manually triggered `Build macOS Installer` GitHub Actions workflow. Configure the optional `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` secrets to produce signed and notarized artifacts.
