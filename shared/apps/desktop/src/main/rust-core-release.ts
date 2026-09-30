import { createHash } from "node:crypto";

export interface RustCoreReleaseManifest {
  schemaVersion: 1;
  fileName: string;
  sha256: string;
  signer: string;
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertRustCoreRelease(manifest: RustCoreReleaseManifest, actualSha256: string) {
  const expected = String(manifest.sha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expected)) {
    throw new Error("BRAIN_CORE_RELEASE_UNSIGNED: brain-core-release.json has no sha256. Place the official brain-core build beside this manifest.");
  }
  if (String(actualSha256 || "").trim().toLowerCase() !== expected) {
    throw new Error("BRAIN_CORE_RELEASE_MISMATCH: brain-core does not match the published sha256.");
  }
  return expected;
}
