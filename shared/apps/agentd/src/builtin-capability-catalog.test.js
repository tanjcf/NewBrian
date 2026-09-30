import test from "node:test";
import assert from "node:assert/strict";
import { createBuiltinCapabilityCatalog } from "./builtin-capability-catalog.js";

test("builtin catalog contains real spreadsheet capabilities", async () => {
  const catalog = createBuiltinCapabilityCatalog([
    { name: "spreadsheet.inspect" },
    { name: "spreadsheet.analyze" },
    { name: "spreadsheet.update" }
  ]);
  const entries = await catalog.find("spreadsheet.analyze", { platform: "windows" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].trust, "core");
  assert.equal(entries[0].installation.type, "bundled");
});
