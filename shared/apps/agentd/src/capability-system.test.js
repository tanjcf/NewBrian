import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCapabilitySystem, restoreCapabilitySystem } from "./capability-system.js";
import { createBundledCapabilityCatalog } from "./capability-catalog.js";
import { hashCapabilityPackage } from "./capability-package.js";
import { createBuiltinToolRegistry } from "./tool-registry.js";

async function fixture(root, permissions = []) {
  const sourcePath = path.join(root, "package");
  await fs.mkdir(sourcePath, { recursive: true });
  const manifest = { schemaVersion: 2, id: "official.demo", version: "1.0.0", permissions, providers: [{ id: "local", type: "builtin", entry: "index.js", capabilities: [{ id: "demo.echo", permissions, verification: "builtin.basic.v1" }] }] };
  await fs.writeFile(path.join(sourcePath, "capability.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(sourcePath, "index.js"), "export function invoke(name, input) { return { ok: true, output: name + ':' + input.value }; }\n");
  return { sourcePath, manifest, expectedIntegrity: await hashCapabilityPackage(sourcePath) };
}

test("production capability system acquires, invokes, persists, and restores a provider", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-system-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installation = await fixture(root);
  const entry = { id: "official.demo", trust: "official", local: true, privacy: "local", capabilities: ["demo.echo"], permissions: [], intents: ["演示能力"], installation };
  const catalog = createBundledCapabilityCatalog([entry]);
  const system = createCapabilitySystem({ toolRegistry: createBuiltinToolRegistry(), catalog, dataRoot: path.join(root, "data"), platform: "windows" });
  assert.equal((await system.resolver.resolveForIntent("请使用演示能力", { platform: "windows" }))[0].status, "resolved");
  assert.ok(system.toolRegistry.get("demo.echo"));
  const result = await system.capabilityRuntime.invoke("demo.echo", { value: "ok" });
  assert.equal(result.status, "completed");
  assert.match(result.output.output, /demo\.echo:ok/);
  assert.ok((await system.stateStore.readEvents()).some((event) => event.type === "capability_activated"));
  const restored = createCapabilitySystem({ toolRegistry: createBuiltinToolRegistry(), catalog, dataRoot: path.join(root, "data"), platform: "windows" });
  await restoreCapabilitySystem(restored);
  assert.equal((await restored.capabilityRuntime.invoke("demo.echo", { value: "again" })).status, "completed");
});

test("activation failure rolls installation back instead of exposing a broken provider", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-system-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installation = await fixture(root);
  installation.manifest.providers[0].type = "process";
  await fs.writeFile(path.join(installation.sourcePath, "capability.json"), JSON.stringify(installation.manifest));
  installation.expectedIntegrity = await hashCapabilityPackage(installation.sourcePath);
  const catalog = createBundledCapabilityCatalog([{ id: "official.demo", trust: "official", capabilities: ["demo.echo"], permissions: [], installation }]);
  const system = createCapabilitySystem({ toolRegistry: createBuiltinToolRegistry(), catalog, dataRoot: path.join(root, "data") });
  await assert.rejects(() => system.resolver.resolve("demo.echo", { platform: "windows" }), /not supported/);
  assert.equal(await system.supervisor.getActive("official.demo"), null);
  assert.equal(system.registry.getCapability("demo.echo"), null);
  assert.equal(system.toolRegistry.get("demo.echo"), undefined);
});

test("high-risk provider waits for approval without installing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-system-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installation = await fixture(root, ["process.execute"]);
  const catalog = createBundledCapabilityCatalog([{ id: "official.demo", trust: "official", capabilities: ["demo.echo"], permissions: ["process.execute"], installation }]);
  const system = createCapabilitySystem({ toolRegistry: createBuiltinToolRegistry(), catalog, dataRoot: path.join(root, "data") });
  assert.equal((await system.resolver.resolve("demo.echo", { platform: "windows" })).status, "approval_required");
  assert.equal(await system.supervisor.getActive("official.demo"), null);
});
