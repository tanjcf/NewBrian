import test from "node:test";
import assert from "node:assert/strict";
import { createBundledCapabilityCatalog } from "./capability-catalog.js";

test("bundled catalog returns only compatible trusted providers", async () => {
  const catalog = createBundledCapabilityCatalog([
    { id: "sheets", capabilities: ["spreadsheet.analyze"], installation: { sourcePath: "bundled/sheets" }, platforms: ["windows"] },
    { id: "linux-only", capabilities: ["spreadsheet.analyze"], installation: { sourcePath: "bundled/linux" }, platforms: ["ubuntu-x64"] }
  ]);
  assert.deepEqual((await catalog.find("spreadsheet.analyze", { platform: "windows" })).map((entry) => entry.id), ["sheets"]);
  assert.equal((await catalog.find("spreadsheet.analyze", { platform: "macos-arm64" })).length, 0);
});

test("bundled catalog rejects untrusted entries", () => {
  const catalog = createBundledCapabilityCatalog();
  assert.throws(() => catalog.register({ id: "bad", trust: "third_party", capabilities: ["x"], installation: {} }), /only core or official/);
});
