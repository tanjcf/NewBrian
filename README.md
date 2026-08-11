# codeCN BRAIN

codeCN BRAIN is the cross-platform source repository for codeCN. It separates
code shared by macOS and Windows from platform-specific packaging, configuration,
and source overrides. The original codeCN repository remains unchanged.

## Layout

```text
shared/                 Files identical on macOS and Windows
platforms/macos/        macOS-only files and macOS versions of divergent files
platforms/windows/      Windows-only files and Windows versions of divergent files
scripts/                Import, materialization, and verification tooling
docs/architecture/      Repository architecture and contribution rules
.materialized/          Generated runnable workspaces (ignored by Git)
```

Platform files use the same relative paths as the shared layer. Materialization
copies `shared/` first and then applies the selected platform overlay.

## Development

Requirements: Node.js 22+ and pnpm 10.

```bash
pnpm materialize:macos
pnpm check:macos

pnpm materialize:windows
pnpm check:windows
```

Run a command inside a generated platform workspace:

```bash
node scripts/run-platform.mjs macos dev:desktop
node scripts/run-platform.mjs windows dev:desktop
```

Generated workspaces live under `.materialized/<platform>` and must not be
edited. Make changes in `shared/` when behavior is cross-platform, or in the
corresponding `platforms/<platform>/` path when behavior is platform-specific.

Refresh the managed layers from a deliberate upstream snapshot with:

```bash
node scripts/import-upstream.mjs /path/to/original/codeCN
```

See [docs/architecture/repository-layout.md](docs/architecture/repository-layout.md)
for the ownership and synchronization rules.
