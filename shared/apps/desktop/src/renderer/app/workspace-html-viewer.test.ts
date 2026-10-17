import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("HTML artifact viewer defaults to sandboxed preview with source toggle", () => {
  const viewer = readFileSync(new URL("./workspace-html-viewer.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(viewer, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(viewer, /预览/);
  assert.match(viewer, /源码/);
  assert.match(viewer, /setMode\("preview"\)/);
  assert.match(viewer, /referrerPolicy="no-referrer"/);
  assert.match(workspace, /searchFilePreview\.kind === "html"/);
  assert.match(workspace, /WorkspaceHtmlViewer/);
  assert.match(workspace, /setHtmlPreviewRefreshToken/);
  assert.match(viewer, /workspace-artifact-html-stage/);
  assert.match(viewer, /DocumentMarkingLayer/);
  assert.match(workspace, /kind === "html"[\s\S]{0,700}marking=\{\{/);
});
