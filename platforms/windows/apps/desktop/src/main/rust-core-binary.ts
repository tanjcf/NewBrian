import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

interface WindowsRustCoreBinaryOptions {
  isPackaged: boolean;
  resourcesPath: string;
  appDirectory: string;
  exists?: (path: string) => boolean;
  verifyRelease?: (binaryPath: string) => void;
}

function assertSha256(binaryPath: string) {
  const manifest = JSON.parse(readFileSync(join(dirname(binaryPath), "brain-core-release.json"), "utf8")) as { sha256?: string; signer?: string };
  const expected = String(manifest.sha256 || "").trim().toLowerCase();
  const actual = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
  if (!/^[a-f0-9]{64}$/u.test(expected)) {
    throw new Error("BRAIN_CORE_RELEASE_UNSIGNED: brain-core-release.json has no sha256. Place the official brain-core build beside this manifest.");
  }
  if (actual !== expected) throw new Error("BRAIN_CORE_RELEASE_MISMATCH: brain-core does not match the published sha256.");
  return String(manifest.signer || "").trim();
}

function assertAuthenticodeSigner(binaryPath: string, signer: string) {
  const script = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:BRAIN_CORE_BINARY",
    "if ($signature.Status -ne 'Valid') { Write-Output ('STATUS=' + $signature.Status); exit 2 }",
    "$subject = [string]$signature.SignerCertificate.Subject",
    "Write-Output $subject"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, BRAIN_CORE_BINARY: binaryPath }
  });
  const subject = String(result.stdout || "").trim();
  if (result.status !== 0 || !subject.includes(signer)) {
    throw new Error(`BRAIN_CORE_SIGNER_MISMATCH: brain-core signature is not ${signer}.`);
  }
}

function verifyWindowsRelease(binaryPath: string) {
  const signer = assertSha256(binaryPath);
  if (signer) assertAuthenticodeSigner(binaryPath, signer);
}

function officialBinary(root: string) {
  return [
    join(root, "apps", "desktop", "build", "rust-core", "brain-core.exe"),
    join(root, "build", "rust-core", "brain-core.exe")
  ];
}

export function resolveWindowsRustCoreBinary(options: WindowsRustCoreBinaryOptions) {
  const exists = options.exists ?? existsSync;
  const verifyRelease = options.verifyRelease ?? verifyWindowsRelease;
  if (options.isPackaged) {
    const bundled = resolve(options.resourcesPath, "brain-core", "brain-core.exe");
    if (!exists(bundled)) {
      throw new Error(`BRAIN_CORE_BINARY_MISSING: packaged Rust Core is unavailable at ${bundled}`);
    }
    verifyRelease(bundled);
    return bundled;
  }

  let current = resolve(options.appDirectory);
  while (true) {
    const manifest = join(current, "rust", "brain-core", "Cargo.toml");
    if (exists(manifest)) {
      for (const profile of ["debug", "release"]) {
        const candidate = join(current, "rust", "brain-core", "target", profile, "brain-core.exe");
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
