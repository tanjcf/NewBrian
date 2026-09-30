import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "./capability-registry.js";

const provider = { id: "builtin.test", type: "builtin", version: "1.0.0", status: "active", capabilities: [] };
const capability = { id: "test.echo", version: "1.0.0", providerId: provider.id, providerType: "builtin", inputSchema: { type: "object" }, outputSchema: { type: "object" }, risk: "read", permissions: [], verification: "test.echo.v1" };

test("registry requires providers and exposes only active capabilities", () => {
  const registry = new CapabilityRegistry();
  assert.throws(() => registry.registerCapability(capability), /provider not registered/);
  registry.registerProvider(provider);
  registry.registerCapability(capability);
  assert.equal(registry.listCapabilities({ activeOnly: true }).length, 1);
  registry.setProviderStatus(provider.id, "degraded");
  assert.equal(registry.listCapabilities({ activeOnly: true }).length, 0);
});

test("registry rejects duplicate registrations", () => {
  const registry = new CapabilityRegistry();
  registry.registerProvider(provider);
  assert.throws(() => registry.registerProvider(provider), /already registered/);
  registry.registerCapability(capability);
  assert.throws(() => registry.registerCapability(capability), /already registered/);
});

test("registry allows multiple providers for the same capability", () => {
  const registry = new CapabilityRegistry();
  registry.registerProvider(provider);
  registry.registerProvider({ ...provider, id: "builtin.backup", status: "active" });
  registry.registerCapability(capability);
  registry.registerCapability({ ...capability, providerId: "builtin.backup" });
  assert.equal(registry.listCapabilities().length, 2);
  assert.equal(registry.getCapability(capability.id).providerId, provider.id);
  registry.setProviderStatus(provider.id, "failed");
  assert.equal(registry.getCapability(capability.id).providerId, "builtin.backup");
});
