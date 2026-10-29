import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertRustCoreRelease, sha256Hex, type RustCoreReleaseManifest } from "./rust-core-release.ts";

interface UnixRustCoreBinaryOptions {
  isPackaged: boolean;
  resourcesPath: string;
  appDirectory: string;
  exists?: (path: string) => boolean;
  verifyRelease?: (binaryPath: string) => void;
}

function verifyUnixRelease(binaryPath: string) {
  const manifestPath = join(dirname(binaryPath), "brain-core-release.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RustCoreReleaseManifest;
  assertRustCoreRelease(manifest, sha256Hex(readFileSync(binaryPath)));
}

function officialBinary(root: string) {
  return [
    join(root, "apps", "desktop", "build", "rust-core", "brain-core"),
    join(root, "build", "rust-core", "brain-core")
  ];
}

export function resolveUnixRustCoreBinary(options: UnixRustCoreBinaryOptions) {
  const exists = options.exists ?? existsSync;
  const verifyRelease = options.verifyRelease ?? verifyUnixRelease;
  if (options.isPackaged) {
    const bundled = resolve(options.resourcesPath, "brain-core", "brain-core");
    if (!exists(bundled)) {
      throw new Error(`BRAIN_CORE_BINARY_MISSING: packaged Rust Core is unavailable at ${bundled}`);
    }
    verifyRelease(bundled);
    return bundled;
  }

  let current = resolve(options.appDirectory);
  while (true) {
    if (exists(join(current, "rust", "brain-core", "Cargo.toml"))) {
      for (const profile of ["debug", "release"]) {
        const candidate = join(current, "rust", "brain-core", "target", profile, "brain-core");
        if (exists(candidate)) return candidate;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  current = resolve(options.appDirectory);
  while (true) {
    if (!exists(join(current, "rust", "brain-core", "Cargo.toml"))) {
      for (const candidate of officialBinary(current)) {
        if (!exists(candidate)) continue;
        verifyRelease(candidate);
        return candidate;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("BRAIN_CORE_BINARY_MISSING: download the official brain-core release. This tree does not include Rust source.");
}
