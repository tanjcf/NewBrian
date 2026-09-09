# Cross-platform repository architecture

## Goals

1. Keep one source of truth for behavior that is identical across operating systems.
2. Preserve independently working macOS and Windows variants where behavior differs.
3. Make platform builds reproducible without modifying the original repositories.
4. Prevent dependencies, generated output, installers, and local state from entering Git.

## Source layers

The repository uses two source layers:

```text
shared/<relative-path>
platforms/windows/<relative-path>
platforms/macos/common/<relative-path>
platforms/macos/arm64/<relative-path>
platforms/macos/x64/<relative-path>
platforms/ubuntu/common/<relative-path>
platforms/ubuntu/arm64/<relative-path>
platforms/ubuntu/x64/<relative-path>
```

`shared` owns a file only when the imported macOS and Windows bytes are identical.
When the same relative path differs, each platform owns its complete version in its
overlay. Platform-only files also live in that platform's overlay. macOS files shared
by Apple Silicon and Intel live under `macos/common`; CPU-specific native resources or
configuration override them from `arm64` or `x64`.
Ubuntu follows the same structure. Its common layer owns Linux packaging and
Bash defaults, while its architecture layers identify native dependency targets.

This deliberately uses complete-file overrides instead of line-level patches. A
generated workspace is therefore normal source code that existing Node, TypeScript,
Electron, and packaging tools can consume without custom module resolution.

## Materialization

`scripts/materialize.mjs` creates `.materialized/<target>` atomically enough for
local development: it builds a temporary directory, copies the shared layer, applies
the overlay, writes provenance metadata, and then replaces the prior generated tree.

The supported targets are `macos-arm64`, `macos-x64`, `ubuntu-arm64`,
`ubuntu-x64`, and `windows`. The macOS and Ubuntu targets each apply their own
common platform overlay before the CPU overlay. The generated
`newbrain.arch.json` gives packaging and diagnostics an explicit architecture contract:
`arm64` for M-series Apple Silicon and `x64` with distribution label `intel` for Intel.
Ubuntu uses `arm64` or `x64` directly and packages AppImage plus Debian artifacts.

The generated directory is disposable. Never commit or edit it.

## Change rules

- Cross-platform change: edit `shared/` and validate both platforms.
- macOS-wide change: edit `platforms/macos/common/` and validate both macOS targets.
- CPU-specific macOS change: edit `platforms/macos/arm64/` or `platforms/macos/x64/`.
- Ubuntu-wide change: edit `platforms/ubuntu/common/` and validate both Ubuntu targets.
- CPU-specific Ubuntu change: edit `platforms/ubuntu/arm64/` or `platforms/ubuntu/x64/`.
- Windows-only change: edit `platforms/windows/`.
- Divergent file that becomes identical: move it into `shared/` and remove both overlays.
- Shared file that must diverge: copy it into both overlays, then remove the shared copy.
- Dependency or script changes: keep root-relative paths compatible with a materialized workspace.

Run `pnpm verify:layout` before commit. It rejects path collisions, forbidden generated
content, missing platform metadata, and files shared by only one platform.

## Import policy

`scripts/import-upstream.mjs` is a migration tool. It reads both source directories,
uses SHA-256 to classify files, and recreates the source layers. Its allowlist includes
application/package source, platform scripts, documentation, skills, and root build
configuration. It excludes dependencies, build output, releases, caches, logs,
installer binaries, and temporary artifacts.

Re-importing replaces the managed source layers, so it should only be used for an
intentional upstream snapshot refresh with a clean Git worktree.
