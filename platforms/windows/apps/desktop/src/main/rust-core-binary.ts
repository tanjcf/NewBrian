import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface WindowsRustCoreBinaryOptions {
  isPackaged: boolean;
  resourcesPath: string;
  appDirectory: string;
  exists?: (path: string) => boolean;
}

export function resolveWindowsRustCoreBinary(options: WindowsRustCoreBinaryOptions) {
  const exists = options.exists ?? existsSync;
  if (options.isPackaged) {
    const bundled = resolve(options.resourcesPath, "brain-core", "brain-core.exe");
    if (!exists(bundled)) {
      throw new Error(`BRAIN_CORE_BINARY_MISSING: packaged Rust Core is unavailable at ${bundled}`);
    }
    return bundled;
  }

  let current = resolve(options.appDirectory);
  while (true) {
    const manifest = join(current, "rust", "brain-core", "Cargo.toml");
    if (exists(manifest)) {
      // Development builds are produced by plain `cargo build`; prefer them so a
      // stale release artifact cannot silently run an older protocol.
      for (const profile of ["debug", "release"]) {
        const candidate = join(current, "rust", "brain-core", "target", profile, "brain-core.exe");
        if (exists(candidate)) return candidate;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("BRAIN_CORE_BINARY_MISSING: build rust/brain-core before starting the desktop runtime.");
}
