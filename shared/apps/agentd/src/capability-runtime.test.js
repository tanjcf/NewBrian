import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "./capability-registry.js";
import { CapabilityRuntime } from "./capability-runtime.js";

function setup(capability = {}) {
  const registry = new CapabilityRegistry();
  registry.registerProvider({ id: "builtin.test", type: "builtin", version: "1.0.0", status: "active" });
  registry.registerCapability({ id: "test.echo", version: "1.0.0", providerId: "builtin.test", providerType: "builtin", inputSchema: { type: "object", required: ["value"] }, outputSchema: { type: "object", required: ["value"] }, risk: "read", permissions: [], verification: "test.v1", ...capability });
  return { registry, providers: new Map([["builtin.test", async (input) => input]]), verifiers: new Map([["test.v1", async () => ({ status: "verified" })]]) };
}

test("runtime invokes only active registered capabilities", async () => {
  const setupValue = setup();
  const runtime = new CapabilityRuntime(setupValue);
  assert.equal((await runtime.invoke("test.echo", { value: 2 })).status, "completed");
  setupValue.registry.setProviderStatus("builtin.test", "degraded");
  assert.equal((await runtime.invoke("test.echo", { value: 2 })).error.code, "PROVIDER_UNAVAILABLE");
});

test("runtime denies mutating capability without approval", async () => {
  const setupValue = setup({ permissions: ["workspace.write"], approval: "conditional", risk: "local-write" });
  const runtime = new CapabilityRuntime(setupValue);
  assert.equal((await runtime.invoke("test.echo", { value: 2 })).error.code, "POLICY_DENIED");
  assert.equal((await runtime.invoke("test.echo", { value: 2 }, { approved: true })).status, "completed");
});
