import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Flow IPC exposes only narrow identifiers, definitions and values", () => {
  const ipc = readFileSync(new URL("./brain-workspace-ipc.ts", import.meta.url), "utf8");
  assert.match(ipc, /rejectUnexpectedKeys\(input, \["projectId", "id", "name", "definition"\]/);
  assert.match(ipc, /rejectUnexpectedKeys\(input, \["flowId", "values"\]/);
  assert.match(ipc, /validateFlowDefinition\(definition\)/);
  assert.match(ipc, /Flow values exceed the allowed size/);
  assert.doesNotMatch(ipc, /parseFlowStart[\s\S]{0,800}\b(?:command|executable|path|cwd)\b/u);
  assert.match(ipc, /"software\.inspect-scripts"/);
});

test("all desktop preloads expose typed Flow methods without raw IPC", () => {
  const paths = [
    "../../../../../../platforms/windows/apps/desktop/src/preload/index.ts",
    "../../../../../../platforms/macos/common/apps/desktop/src/preload/index.ts",
    "../../../../../../platforms/ubuntu/common/apps/desktop/src/preload/index.ts"
  ];
  for (const path of paths) {
    const preload = readFileSync(new URL(path, import.meta.url), "utf8");
    for (const method of ["saveBrainFlow", "getBrainFlow", "startBrainFlow", "getBrainFlowRun"]) assert.match(preload, new RegExp(method));
    assert.doesNotMatch(preload, /startBrainFlow:\s*\(input:\s*Record<string, unknown>/u);
  }
});
