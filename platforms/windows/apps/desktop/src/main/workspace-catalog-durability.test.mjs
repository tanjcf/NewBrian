import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const e2eSource = readFileSync(new URL("../../scripts/electron-e2e-session.mjs", import.meta.url), "utf8");

test("workspace catalog uses transient-safe reads, atomic writes, and crash sidecar recovery", () => {
  assert.match(mainSource, /readTextWithTransientRetry\(workspaceCatalogPath\)/);
  assert.match(mainSource, /recoverDurableText\(workspaceCatalogPath\)/);
  assert.match(mainSource, /restoreTextFile\(workspaceCatalogPath,/);
  assert.match(mainSource, /writeTextAtomically\(workspaceCatalogPath,/);
  assert.doesNotMatch(mainSource, /fs\.writeFile\(workspaceCatalogPath,/);
});

test("Electron E2E sessions cannot reuse the production workspace store", () => {
  assert.match(e2eSource, /mkdtempSync\(join\(tmpdir\(\), "newbrain-e2e-"\)\)/);
  assert.match(e2eSource, /NEWBRAIN_WORKSPACE_PATH: isolatedWorkspacePath/);
  assert.match(e2eSource, /child\.once\("exit", removeIsolatedWorkspace\)/);
});

test("removing the final project persists an empty catalog", () => {
  const removeWorkspaceSource = mainSource.slice(
    mainSource.indexOf("async function removeWorkspace"),
    mainSource.indexOf("async function getWorkspaceHeaderStatus")
  );
  assert.doesNotMatch(removeWorkspaceSource, /At least one project must remain/);
  assert.match(removeWorkspaceSource, /writeWorkspaceCatalog\([\s\S]*?filter\(\(workspace\) => workspace\.id !== input\.workspaceId\)/);
});
