import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceSource = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../ui.tsx", import.meta.url), "utf8");

test("project files live only in the right preview sidebar", () => {
  assert.doesNotMatch(workspaceSource, /className="left-section tree-section"/);
  assert.match(uiSource, /if \(previewMode === "files"\)[\s\S]*side-files-view/);
  assert.match(uiSource, /onOpenFile=\{openWorkspaceFile\}/);
  assert.match(workspaceSource, /renderPreviewPanel\(openLocalFilePreview\)/);
  assert.match(uiSource, /function handleTogglePreviewPanel\(\)[\s\S]*setPreviewMode\("files"\)[\s\S]*setPreviewPlacement\("side"\)/);
});
