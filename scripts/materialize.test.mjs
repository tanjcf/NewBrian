import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("Windows materialization copies Rust source but preserves destination Cargo artifacts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brain-materialize-test-"));
  for (const dir of ["scripts", "shared", "platforms/windows", "rust/brain-core/src", "rust/brain-core/target/debug", ".materialized/windows/rust/brain-core/target/debug"]) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  await copyFile(new URL("./materialize.mjs", import.meta.url), path.join(root, "scripts/materialize.mjs"));
  await writeFile(path.join(root, "rust/brain-core/src/main.rs"), "fn main() {}\n");
  await writeFile(path.join(root, "rust/brain-core/target/debug/brain-core.exe"), "stale source artifact");
  await writeFile(path.join(root, "rust/brain-core/target/debug/cache"), "source cache");
  const destination = path.join(root, ".materialized/windows/rust/brain-core/target/debug/brain-core.exe");
  await writeFile(destination, "existing runtime");
  const result = spawnSync(process.execPath, [path.join(root, "scripts/materialize.mjs"), "windows"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(destination, "utf8"), "existing runtime");
  assert.equal(await readFile(path.join(root, ".materialized/windows/rust/brain-core/src/main.rs"), "utf8"), "fn main() {}\n");
  await assert.rejects(access(path.join(root, ".materialized/windows/rust/brain-core/target/debug/cache")));
});
