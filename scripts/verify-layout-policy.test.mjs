import assert from "node:assert/strict";
import test from "node:test";
import { validateMaterializedApplicationEntries } from "./verify-layout-policy.mjs";

const completeApplication = [
  "apps/agentd/src/index.js",
  "apps/desktop/src/main/index.ts",
  "apps/desktop/src/preload/index.ts",
  "apps/desktop/src/renderer/index.tsx"
];

test("rejects a supported target whose generated application has no runtime entries", () => {
  assert.throws(
    () => validateMaterializedApplicationEntries("ubuntu-x64", [
      "apps/desktop/package.json",
      "apps/desktop/electron.vite.config.ts"
    ]),
    /ubuntu-x64.*apps\/agentd\/src\/index\.js/u
  );
});

test("accepts a target only when agentd and all desktop process entries exist", () => {
  assert.doesNotThrow(() => validateMaterializedApplicationEntries("ubuntu-x64", completeApplication));
});
