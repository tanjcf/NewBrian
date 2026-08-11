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
platforms/<platform>/<relative-path>
```

`shared` owns a file only when the imported macOS and Windows bytes are identical.
When the same relative path differs, each platform owns its complete version in its
overlay. Platform-only files also live in that platform's overlay.

This deliberately uses complete-file overrides instead of line-level patches. A
generated workspace is therefore normal source code that existing Node, TypeScript,
Electron, and packaging tools can consume without custom module resolution.

## Materialization

`scripts/materialize.mjs` creates `.materialized/<platform>` atomically enough for
local development: it builds a temporary directory, copies the shared layer, applies
the overlay, writes provenance metadata, and then replaces the prior generated tree.

The generated directory is disposable. Never commit or edit it.

## Change rules

- Cross-platform change: edit `shared/` and validate both platforms.
- Platform-only change: edit only `platforms/<platform>/` and validate that platform.
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

