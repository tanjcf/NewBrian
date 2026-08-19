import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  rememberBrainWorkspaceCatalog,
  restoreBrainWorkspaceSelection,
  selectBrainWorkspace
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./workspace-selection.ts";

test("defines six workspace families with video and music as separate media modes", async () => {
  const protocol = await import(
    new URL("../../../../../packages/protocol/src/workspace-types.ts", import.meta.url).href
  ) as typeof import("../../../../../packages/protocol/src/workspace-types.js");
  assert.equal(protocol.brainWorkspaceFamilies.length, 6);
  assert.deepEqual(protocol.brainWorkspaceFamilies.find((family) => family.familyKey === "media")?.modeKeys, ["video", "music"]);
  assert.deepEqual(protocol.brainWorkspaceModes.map((mode) => mode.workspaceKey), [
    "quant", "game", "video", "music", "data", "software", "document"
  ]);
});

test("migrates the legacy selected workspace without assigning another workspace catalog", () => {
  const restored = restoreBrainWorkspaceSelection({ legacyWorkspaceKey: "music" });
  assert.equal(restored.migrated, true);
  assert.equal(restored.selection.selectedWorkspaceKey, "music");
  assert.deepEqual(restored.selection.catalogs, {});
});

test("persists independent project and conversation selections for every workspace", () => {
  let selection = restoreBrainWorkspaceSelection({}).selection;
  selection = rememberBrainWorkspaceCatalog(selection, "software", { projectId: "software-project", conversationId: "software-chat" });
  selection = rememberBrainWorkspaceCatalog(selection, "quant", { projectId: "quant-project", conversationId: "quant-chat" });
  selection = selectBrainWorkspace(selection, "quant");
  const restored = restoreBrainWorkspaceSelection({ serialized: JSON.stringify(selection) }).selection;

  assert.equal(restored.selectedWorkspaceKey, "quant");
  assert.deepEqual(restored.catalogs.software, { projectId: "software-project", conversationId: "software-chat" });
  assert.deepEqual(restored.catalogs.quant, { projectId: "quant-project", conversationId: "quant-chat" });
});

test("falls back to an available workspace while retaining unavailable catalog history", () => {
  const serialized = JSON.stringify({
    version: 2,
    selectedWorkspaceKey: "video",
    catalogs: { video: { projectId: "video-project", conversationId: "video-chat" } }
  });
  const restored = restoreBrainWorkspaceSelection({ serialized, availableWorkspaceKeys: ["software", "document"] });
  assert.equal(restored.selection.selectedWorkspaceKey, "software");
  assert.deepEqual(restored.selection.catalogs.video, { projectId: "video-project", conversationId: "video-chat" });
});

test("recovers from corrupt persisted selection without trusting invalid workspace keys", () => {
  const corrupt = restoreBrainWorkspaceSelection({ serialized: "{broken", legacyWorkspaceKey: "unknown" });
  assert.equal(corrupt.selection.selectedWorkspaceKey, "software");
  assert.deepEqual(corrupt.selection.catalogs, {});
  assert.equal(corrupt.migrated, true);
});

test("places the switcher before navigation and keeps the conversation surface outside it", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const switcher = source.indexOf('className="brain-workspace-switcher"');
  const navigation = source.indexOf('className="feature-nav"', switcher);
  const conversation = source.indexOf("function renderBrainChatModule");
  assert.ok(switcher >= 0 && navigation > switcher);
  assert.ok(conversation >= 0);
  const switcherEnd = source.indexOf('className="feature-nav"', switcher);
  assert.equal(source.slice(switcher, switcherEnd).includes("renderBrainChatModule"), false);
});

test("renders explicit loading unavailable migration and empty catalog states", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /正在初始化工作台目录/);
  assert.match(source, /工作台目录暂不可用/);
  assert.match(source, /正在迁移上次工作台位置/);
  assert.match(source, /还没有项目/);
  assert.match(source, /暂无对话/);
});
