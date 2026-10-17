/**
 * SCENE-SWITCH-GENERATION-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Switching scenes while a thread is generating must not loop selection updates.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { shouldRepairSelectedThread } from "./workspace-visibility.ts";

const CASE_ID = "SCENE-SWITCH-GENERATION-SMOKE-001";

function readUiSource() {
  const beside = fileURLToPath(new URL("../ui.tsx", import.meta.url));
  if (existsSync(beside)) return readFileSync(beside, "utf8");
  return readFileSync(fileURLToPath(new URL(
    "../../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx",
    import.meta.url
  )), "utf8");
}

test(`${CASE_ID} does not put the generating thread back while a scene switch is drafting`, () => {
  assert.equal(shouldRepairSelectedThread({
    isComposingNewThread: true,
    visibleThreadCount: 2,
    selectedThreadId: "",
    resolvedThreadId: "generating-thread"
  }), false);
});

test(`${CASE_ID} still repairs a hidden thread when the user is not drafting`, () => {
  assert.equal(shouldRepairSelectedThread({
    isComposingNewThread: false,
    visibleThreadCount: 2,
    selectedThreadId: "hidden-child",
    resolvedThreadId: "project-parent"
  }), true);
  assert.equal(shouldRepairSelectedThread({
    isComposingNewThread: false,
    visibleThreadCount: 1,
    selectedThreadId: "project-parent",
    resolvedThreadId: "project-parent"
  }), false);
});

test(`${CASE_ID} drops a foreign conversation instead of fighting selection repair`, () => {
  const modules = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const ui = readUiSource();
  const guard = modules.indexOf("if (!mappedThreadBelongsToWorkspace)");
  const activation = modules.indexOf("void api.activateWorkspaceThread", guard);
  const guardSource = modules.slice(guard, activation);
  assert.match(guardSource, /setSelectedBrainConversationId\(""\)/);
  assert.match(guardSource, /setSelectedThreadId\(""\)/);
  assert.match(guardSource, /setIsComposingNewThread\(true\)/);
  assert.match(ui, /shouldRepairSelectedThread/);
  assert.match(ui, /isComposingNewThread \? "compose" : "view"/);
  assert.match(ui, /\[isComposingNewThread, selectedThreadId, selectedWorkspaceId, safeWorkspaceCatalog\]/);
});
