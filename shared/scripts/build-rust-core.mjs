import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fetchOfficialRustCore, writeRustCoreReleaseManifest } from "./fetch-rust-core.mjs";

const generatedRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(process.env.NEWBRAIN_SOURCE_ROOT || generatedRoot);
const executableName = process.platform === "win32" ? "brain-core.exe" : "brain-core";
const stagedBinary = join(generatedRoot, "apps", "desktop", "build", "rust-core", executableName);
const manifestPath = join(sourceRoot, "rust", "brain-core", "Cargo.toml");
let hasSource = false;
try {
  hasSource = (await stat(manifestPath)).isFile();
} catch {
  hasSource = false;
}
if (!hasSource) {
  await fetchOfficialRustCore({ sourceRoot, outputPath: stagedBinary });
} else {
  const cargo = process.env.CARGO?.trim() || "cargo";
  const build = spawnSync(cargo, ["build", "--release", "--locked", "--manifest-path", manifestPath], {
    cwd: sourceRoot,
    env: process.env,
    stdio: "inherit",
    shell: false
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Rust Core release build failed with exit code ${build.status ?? 1}`);
  const builtBinary = join(sourceRoot, "rust", "brain-core", "target", "release", executableName);
  await mkdir(dirname(stagedBinary), { recursive: true });
  await copyFile(builtBinary, stagedBinary);
  if (process.platform !== "win32") await chmod(stagedBinary, 0o755);
  if ((await stat(stagedBinary)).size <= 0) throw new Error(`Rust Core staged binary is empty: ${stagedBinary}`);
  await writeRustCoreReleaseManifest(stagedBinary, "");
  console.log(`Rust Core staged: ${stagedBinary}`);
}
