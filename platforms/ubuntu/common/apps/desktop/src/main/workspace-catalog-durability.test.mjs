import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("workspace catalog uses transient-safe reads, atomic writes, and crash sidecar recovery", () => {
  assert.match(mainSource, /readTextWithTransientRetry\(workspaceCatalogPath\)/);
  assert.match(mainSource, /recoverDurableText\(workspaceCatalogPath\)/);
  assert.match(mainSource, /restoreTextFile\(workspaceCatalogPath,/);
  assert.match(mainSource, /writeTextAtomically\(workspaceCatalogPath,/);
  assert.doesNotMatch(mainSource, /fs\.writeFile\(workspaceCatalogPath,/);
});
