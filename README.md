# codeCN BRAIN

codeCN BRAIN is the cross-platform source repository for codeCN. It separates
code shared by macOS and Windows from platform-specific packaging, configuration,
and source overrides. The original codeCN repository remains unchanged.

## Layout

```text
shared/                 Files identical on macOS and Windows
platforms/macos/common/ macOS-common files and macOS versions of divergent files
platforms/macos/arm64/  Apple Silicon-specific overrides
platforms/macos/x64/    Intel-specific overrides
platforms/ubuntu/common/ Ubuntu-common files and Linux package configuration
platforms/ubuntu/arm64/ Ubuntu ARM64-specific overrides
platforms/ubuntu/x64/   Ubuntu Intel/AMD 64-bit-specific overrides
platforms/windows/      Windows-only files and Windows versions of divergent files
scripts/                Import, materialization, and verification tooling
docs/                   Documentation index under docs/README.md
docs/architecture/      Technical contracts and repository rules
docs/product/           Product design and implementation playbook
docs/plans/             Active implementation checklists
docs/evidence/          Dated test and release evidence
.materialized/          Generated runnable workspaces (ignored by Git)
```

Platform files use the same relative paths as the shared layer. macOS
materialization applies three layers: `shared`, `macos/common`, and the selected
CPU architecture. Windows applies `shared` and `platforms/windows`.
Ubuntu follows the same three-layer model as macOS: `shared`, `ubuntu/common`,
and one CPU architecture overlay.

## Development

Requirements: Node.js 22+ and pnpm 10.

```bash
pnpm materialize:macos-arm64
pnpm check:macos-arm64

pnpm materialize:macos-x64
pnpm check:macos-x64

pnpm materialize:windows
pnpm check:windows

pnpm materialize:ubuntu-x64
pnpm check:ubuntu-x64

pnpm materialize:ubuntu-arm64
pnpm check:ubuntu-arm64
```

Run a command inside a generated platform workspace:

```bash
node scripts/run-platform.mjs macos-arm64 dev:desktop
node scripts/run-platform.mjs macos-x64 dev:desktop
node scripts/run-platform.mjs ubuntu-x64 dev:desktop
node scripts/run-platform.mjs windows dev:desktop
```

Windows has three explicit runtime/release environments:

```bash
node scripts/run-platform.mjs windows dev:desktop       # local development
pnpm package:windows:test                               # unsigned MSI for installation testing
pnpm package:windows:production                         # signed production MSI from a clean worktree
```

Test artifacts are written to `apps/desktop/release/test`; production artifacts are
written to `apps/desktop/release/production`. Production packaging always requires a
valid Authenticode signature. Override service endpoints with
`CODECN_TEST_GATEWAY_BASE_URL` / `CODECN_TEST_PREVIEW_URL` or
`CODECN_PRODUCTION_GATEWAY_BASE_URL` / `CODECN_PRODUCTION_PREVIEW_URL`.
Defaults: Test uses `http://120.48.151.202:8790/v1` and
`http://120.48.151.202:3000`; Production uses `https://api.sinnauze.cn/v1` and
`https://api.sinnauze.cn`. Do not use the retired `*.wangjietech.com` hosts —
they are parked/blocked and cannot reach the model gateway.

Create architecture-specific macOS installers with:

```bash
pnpm package:macos-arm64  # Apple Silicon / M-series
pnpm package:macos-x64    # Intel Mac
pnpm package:ubuntu-x64   # Intel/AMD 64-bit Ubuntu
pnpm package:ubuntu-arm64 # ARM64 Ubuntu
```

`materialize:macos` remains a convenience alias for the current host CPU.

Generated workspaces live under `.materialized/<platform>` and must not be
edited. Make changes in `shared/` when behavior is cross-platform, or in the
corresponding `platforms/<platform>/` path when behavior is platform-specific.

Refresh the managed layers from a deliberate upstream snapshot with:

```bash
node scripts/import-upstream.mjs /path/to/original/codeCN
```

See [docs/README.md](docs/README.md) for the documentation map, and
[docs/architecture/repository-layout.md](docs/architecture/repository-layout.md)
for ownership and synchronization rules.
