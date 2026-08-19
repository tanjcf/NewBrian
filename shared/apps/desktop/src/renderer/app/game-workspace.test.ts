import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("game workspace uses the bounded inspection API and never executes a shell directly", () => {
  const source = readFileSync(new URL("./GameWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /inspectBrainGameProject/);
  assert.match(source, /生成试玩请求/);
  assert.match(source, /不会绕过审批直接执行命令/);
  assert.doesNotMatch(source, /queueShellCommand|child_process|ipcRenderer/);
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
  }
});
