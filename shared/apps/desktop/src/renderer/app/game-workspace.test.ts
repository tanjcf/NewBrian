import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("game workspace uses the bounded inspection API and never executes a shell directly", () => {
  const source = readFileSync(new URL("./GameWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /inspectBrainGameProject/);
  assert.match(source, /startBrainGamePreview/);
  assert.match(source, /getBrainGamePreviewStatus/);
  assert.match(source, /stopBrainGamePreview/);
  assert.match(source, /openBrowserPreview/);
  assert.match(source, /captureBrowserPreview/);
  assert.match(source, /启动前会显示系统确认框/);
  assert.doesNotMatch(source, /queueShellCommand|child_process|ipcRenderer/);
  assert.doesNotMatch(source, /startBrainGamePreview\(\{[^}]*command/u);
});

test("game inspection stays owner scoped and is exposed on every desktop target", () => {
  const ipc = readFileSync(new URL("../../main/brain-workspace-ipc.ts", import.meta.url), "utf8");
  assert.match(ipc, /listProjects\(\{ ownerId: owner, workspaceKey: "game"/);
  assert.match(ipc, /resolveWorkspaceRoot\(project\.localWorkspaceId\)/);
  assert.match(ipc, /gameProjectInspect/);

  const generatedPreload = new URL("../../preload/index.ts", import.meta.url);
  const preloadPaths = existsSync(generatedPreload) ? ["../../preload/index.ts"] : [
    "../../../../../../platforms/windows/apps/desktop/src/preload/index.ts",
    "../../../../../../platforms/macos/common/apps/desktop/src/preload/index.ts",
    "../../../../../../platforms/ubuntu/common/apps/desktop/src/preload/index.ts"
  ];
  for (const path of preloadPaths) {
    const preload = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(preload, /inspectBrainGameProject/);
    assert.match(preload, /brainWorkspaceIpcChannels\.gameProjectInspect/);
    assert.match(preload, /startBrainGamePreview/);
    assert.match(preload, /getBrainGamePreviewStatus/);
    assert.match(preload, /stopBrainGamePreview/);
  }
});

test("game preview IPC rejects renderer supplied commands and paths", () => {
  const ipc = readFileSync(new URL("../../main/brain-workspace-ipc.ts", import.meta.url), "utf8");
  assert.match(ipc, /rejectUnexpectedKeys\(input, \["projectId", "conversationId"\]/);
  assert.match(ipc, /confirmGamePreview/);
  assert.match(ipc, /reconcileInterruptedGamePreviews/);
});
