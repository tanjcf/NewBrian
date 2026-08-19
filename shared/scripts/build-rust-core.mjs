import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const generatedRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(process.env.CODECN_SOURCE_ROOT || generatedRoot);
const manifestPath = join(sourceRoot, "rust", "brain-core", "Cargo.toml");
try {
  if (!(await stat(manifestPath)).isFile()) throw new Error();
} catch {
  throw new Error(`Rust Core manifest is unavailable: ${manifestPath}`);
}

const cargo = process.env.CARGO?.trim() || "cargo";
const build = spawnSync(cargo, ["build", "--release", "--locked", "--manifest-path", manifestPath], {
  cwd: sourceRoot,
  env: process.env,
  stdio: "inherit",
  shell: false
});
if (build.error) throw build.error;
if (build.status !== 0) throw new Error(`Rust Core release build failed with exit code ${build.status ?? 1}`);

const executableName = process.platform === "win32" ? "brain-core.exe" : "brain-core";
const builtBinary = join(sourceRoot, "rust", "brain-core", "target", "release", executableName);
const stagedBinary = join(generatedRoot, "apps", "desktop", "build", "rust-core", executableName);
await mkdir(dirname(stagedBinary), { recursive: true });
await copyFile(builtBinary, stagedBinary);
if (process.platform !== "win32") await chmod(stagedBinary, 0o755);
if ((await stat(stagedBinary)).size <= 0) throw new Error(`Rust Core staged binary is empty: ${stagedBinary}`);
console.log(`Rust Core staged: ${stagedBinary}`);
