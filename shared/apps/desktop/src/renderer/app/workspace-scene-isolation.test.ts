import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { resolveSceneExecutionWorkspace } from "./workspace-visibility.ts";

const workspaces = [
  { id: "game-project", brainWorkspaceKey: "game" },
  { id: "video-project", brainWorkspaceKey: "video" }
] as any;

test("does not fall back to the active game project from the video scene", () => {
  assert.equal(resolveSceneExecutionWorkspace(workspaces, "video", "", "game-project"), undefined);
});

test("prefers the scene-bound project and accepts only same-scene active projects", () => {
  assert.equal(resolveSceneExecutionWorkspace(workspaces, "video", "video-project", "game-project")?.id, "video-project");
  assert.equal(resolveSceneExecutionWorkspace(workspaces, "video", "", "video-project")?.id, "video-project");
});
