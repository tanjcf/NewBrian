import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "./capability-registry.js";
import { activateProviderManifest } from "./provider-activation.js";

test("activation registers manifest providers and capabilities", () => {
  const registry = new CapabilityRegistry();
  const activated = activateProviderManifest({ registry, manifest: {
    id: "official.sheets",
    version: "1.0.0",
    permissions: ["workspace.read"],
    verification: { suite: "spreadsheet.v1" },
    providers: [{ id: "local", type: "builtin", capabilities: ["spreadsheet.analyze"] }]
  } });
  assert.deepEqual(activated, [{ capabilityId: "spreadsheet.analyze", providerId: "official.sheets.local" }]);
  assert.equal(registry.getCapability("spreadsheet.analyze").providerId, "official.sheets.local");
});
