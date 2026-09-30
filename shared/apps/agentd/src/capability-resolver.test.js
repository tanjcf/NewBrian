import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "./capability-registry.js";
import { CapabilityResolver } from "./capability-resolver.js";

const descriptor = (providerId) => ({ id: "spreadsheet.analyze", version: "1.0.0", providerId, providerType: "builtin", inputSchema: { type: "object" }, outputSchema: { type: "object" }, risk: "read", permissions: [], verification: "spreadsheet.v1" });

test("resolver prefers an already active capability", async () => {
  const registry = new CapabilityRegistry();
  registry.registerProvider({ id: "builtin.local", type: "builtin", version: "1", status: "active" });
  registry.registerCapability(descriptor("builtin.local"));
  const resolver = new CapabilityResolver({ registry, catalog: { find: async () => { throw new Error("catalog should not be queried"); } } });
  assert.equal((await resolver.resolve("spreadsheet.analyze")).source, "active");
});

test("resolver acquires a trusted low-risk provider", async () => {
  const registry = new CapabilityRegistry();
  const candidate = { id: "official.sheet", providerId: "builtin.sheet", trust: "official", local: true, privacy: "local", semanticFit: 1, verificationCoverage: 1, permissions: ["workspace.read"], capabilities: ["spreadsheet.analyze"], platforms: ["windows"], installation: { sourcePath: "x" } };
  const resolver = new CapabilityResolver({
    registry,
    catalog: { find: async () => [candidate] },
    supervisor: { install: async () => ({ status: "active" }) },
    activatePackage: async () => {
      registry.registerProvider({ id: candidate.providerId, type: "builtin", version: "1", status: "active" });
      registry.registerCapability(descriptor(candidate.providerId));
      return { providerId: candidate.providerId };
    }
  });
  assert.equal((await resolver.resolve("spreadsheet.analyze", { platform: "windows" })).source, "acquired");
});

test("resolver requires approval for process or network permissions", async () => {
  const registry = new CapabilityRegistry();
  const candidate = { trust: "official", permissions: ["process.execute"], capabilities: ["spreadsheet.analyze"], installation: {} };
  const resolver = new CapabilityResolver({ registry, catalog: { find: async () => [candidate] } });
  assert.equal((await resolver.resolve("spreadsheet.analyze", { platform: "windows" })).status, "approval_required");
});
