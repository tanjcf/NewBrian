import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashCapabilityPackage } from "./capability-package.js";
import { ProviderSupervisor } from "./provider-supervisor.js";

async function packageFixture(root, version) {
  const sourcePath = path.join(root, `source-${version}`);
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, "provider.txt"), version);
  return {
    sourcePath,
    manifest: { schemaVersion: 2, id: "test.package", version, providers: [{ id: "builtin.test", type: "builtin" }], permissions: [] },
    expectedIntegrity: await hashCapabilityPackage(sourcePath)
  };
}

test("supervisor installs atomically and rolls back to last-known-good", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-provider-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const supervisor = new ProviderSupervisor({ installRoot: path.join(root, "installed") });
  await supervisor.install(await packageFixture(root, "1.0.0"));
  await supervisor.install(await packageFixture(root, "2.0.0"));
  assert.equal((await supervisor.getActive("test.package")).version, "2.0.0");
  assert.equal((await supervisor.rollback("test.package")).version, "1.0.0");
});

test("supervisor rejects tampering and removes failed staging state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-provider-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = await packageFixture(root, "1.0.0");
  await fs.writeFile(path.join(fixture.sourcePath, "provider.txt"), "tampered");
  const supervisor = new ProviderSupervisor({ installRoot: path.join(root, "installed") });
  await assert.rejects(() => supervisor.install(fixture), /integrity/);
  assert.equal(await supervisor.getActive("test.package"), null);
});

test("supervisor does not activate providers that fail conformance", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-provider-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const supervisor = new ProviderSupervisor({ installRoot: path.join(root, "installed"), conformanceTest: async () => ({ ok: false, reason: "contract mismatch" }) });
  const fixture = await packageFixture(root, "1.0.0");
  await assert.rejects(() => supervisor.install(fixture), /contract mismatch/);
  assert.equal(await supervisor.getActive("test.package"), null);
});
