import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  rememberBrainWorkspaceCatalog,
  restoreBrainWorkspaceSelection,
  selectBrainWorkspace
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./workspace-selection.ts";

test("defines seven workspace families with video and music as separate media modes", async () => {
  const protocol = await import(
    new URL("../../../../../packages/protocol/src/workspace-types.ts", import.meta.url).href
  ) as typeof import("../../../../../packages/protocol/src/workspace-types.js");
  assert.equal(protocol.brainWorkspaceFamilies.length, 7);
  assert.deepEqual(protocol.brainWorkspaceFamilies.find((family) => family.familyKey === "media")?.modeKeys, ["video", "music"]);
  assert.deepEqual(protocol.brainWorkspaceModes.map((mode) => mode.workspaceKey), [
    "quant", "game", "video", "music", "data", "software", "document", "explore"
  ]);
});

test("migrates the legacy selected workspace without assigning another workspace catalog", () => {
  const restored = restoreBrainWorkspaceSelection({ legacyWorkspaceKey: "music" });
  assert.equal(restored.migrated, true);
  assert.equal(restored.selection.selectedWorkspaceKey, "music");
  assert.deepEqual(restored.selection.catalogs, {});
});

test("defaults a fresh Brain profile to the scene learning workspace", () => {
  const restored = restoreBrainWorkspaceSelection({});
  assert.equal(restored.selection.selectedWorkspaceKey, "explore");
  assert.deepEqual(restored.selection.catalogs, {});
});

test("switchBrainWorkspace restores sidebar selection from target scene catalog", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /setSelectedSidebarRow\(`brain-conversation:\$\{nextCatalog\.conversationId\}`\)/);
  assert.match(source, /setSelectedSidebarRow\(`brain-project:\$\{nextCatalog\.projectId\}`\)/);
  assert.doesNotMatch(source, /switchBrainWorkspace[\s\S]*setBrainConversations\(\[\]\)/);
});

test("switchBrainWorkspace persists the outgoing scene catalog before restoring the target scene", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /rememberBrainWorkspaceCatalog\(current, current\.selectedWorkspaceKey,/);
  assert.match(source, /nextCatalog = next\.catalogs\[workspaceKey\]/);
  assert.doesNotMatch(source, /rememberBrainWorkspaceCatalog\(current, selectedBrainWorkspaceKey,/);
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

test("keeps the same selection reference when the catalog values are unchanged", () => {
  let selection = restoreBrainWorkspaceSelection({}).selection;
  selection = rememberBrainWorkspaceCatalog(selection, "quant", { projectId: "p1", conversationId: "c1" });
  const again = rememberBrainWorkspaceCatalog(selection, "quant", { projectId: "p1", conversationId: "c1" });
  assert.equal(again, selection);
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
  assert.equal(corrupt.selection.selectedWorkspaceKey, "explore");
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

test("uses the Claude Code projects-section as the scene-bound left catalog", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /projects-section/);
  assert.doesNotMatch(source, /brain-projects-section/);
  assert.doesNotMatch(source, /legacy-workspace-section/);
  assert.match(source, /filterWorkspaceCatalogByScene/);
  assert.match(source, /crossSceneRecentProjects|data-testid="brain-recent-projects"/);
  assert.match(source, /data-testid="new-chat-button"/);
  assert.match(source, /setNewThreadScope\("project"\)/);
  assert.match(source, /brainWorkspaceKey:\s*selectedBrainWorkspaceKey/);
  assert.match(source, /新建空白项目/);
  assert.match(source, /暂无聊天/);
  assert.match(source, /brain-project-list/);
  assert.match(source, /brain-conversation-list/);
});

test("keeps quant conversation in the center and renders market tools in the right resource panel", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const workspaceRenderer = source.slice(source.indexOf("function renderWorkspaceModules"));
  const resourcePanel = source.slice(source.indexOf("function renderBrainResourcePanel"), source.indexOf("function renderChatModule"));

  assert.match(workspaceRenderer, /isBrainConversationSelection\s*\?\s*renderBrainChatModule\(\)/);
  assert.match(workspaceRenderer, /activeFeature === "new-chat" && previewPlacement !== "side" \? renderBrainResourcePanel\(\)/);
  assert.doesNotMatch(workspaceRenderer, /selectedBrainWorkspaceKey === "quant"\s*\?\s*<QuantWorkspace/);
  assert.match(resourcePanel, /selectedBrainWorkspaceKey === "quant"/);
  assert.match(resourcePanel, /<QuantWorkspace[^>]+compact/);
  assert.match(resourcePanel, /brain-resource-resize-handle/);
});

test("switching scenes restores the right-hand scene panel instead of the generic files side preview", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const switchFn = source.slice(source.indexOf("const switchBrainWorkspace"), source.indexOf("useEffect(() => {\n    const sceneProjects"));
  assert.match(switchFn, /setPreviewPlacement\("hidden"\)/);
  assert.match(switchFn, /setPreviewMode\("empty"\)/);
  assert.match(switchFn, /setSearchFilePreview\(null\)/);
  assert.match(source, /resolveCatalogBrainWorkspaceKey\(selectedWorkspace\) !== selectedBrainWorkspaceKey/);
});

test("matches the approved prototype with separate global and workspace capability navigation", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const resourcePanel = source.slice(source.indexOf("function renderBrainResourcePanel"), source.indexOf("function renderChatModule"));

  assert.match(resourcePanel, /brain-resource-global-nav/);
  assert.match(resourcePanel, /brain-resource-scene-nav/);
  for (const label of [
    "行情", "组合", "策略", "雷达", "项目与文件", "游戏策划", "脚本", "时间线",
    "歌词", "混音", "数据导入", "决策 Flow", "终端", "部署", "大纲", "审校与导出"
  ]) assert.ok(source.includes(`label: "${label}"`), `missing prototype capability: ${label}`);
});

test("never substitutes fabricated market bars when the provider is empty or unavailable", () => {
  const source = readFileSync(new URL("./QuantWorkspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fallbackBars|演示数据.*显示/);
  assert.match(source, /setBars\(\[\]\)/);
  assert.match(source, /暂无行情数据/);
  assert.match(source, /暂无真实行情，不能生成模拟成交/);
});

test("game level editor never seeds demo maps or fake AI success", () => {
  const source = readFileSync(new URL("./GameLevelEditor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /山门解谜|L_Trial_Phase|Enemy_Patrol_A|石狐 Boss/);
  assert.doesNotMatch(source, /前端占位|演示草稿|已写入 AI\/|AI 资产可用/);
  assert.match(source, /brain-game-level-empty/);
  assert.match(source, /不会预置/);
  assert.match(source, /不会伪造空/);
  assert.match(source, /refuseAiPlaceholder/);
});

test("quant prototype views are backed by persisted activity and controllable radar records", () => {
  const source = readFileSync(new URL("./QuantWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /getQuantActivity/);
  assert.match(source, /runQuantSkillSimulation/);
  assert.match(source, /立即用 Skill 自动模拟/);
  assert.match(source, /Skill 自动模拟组合/);
  assert.match(source, /手动成交记录/);
  assert.match(source, /QuantMarketChart/);
  assert.match(source, /setQuantStrategyScheduleEnabled/);
  assert.match(source, /listQuantStrategyRuns/);
  assert.match(source, /查看记录/);
});

test("data workspace separates prototype tabs instead of repeating one composite panel", () => {
  const source = readFileSync(new URL("./DataWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /activeView/);
  for (const view of ["import", "table", "clean", "analysis", "chart"]) {
    assert.ok(source.includes(`activeView === "${view}"`), `missing data view: ${view}`);
  }
  assert.match(source, /数据质量检查/);
  assert.match(source, /重复行/);
});

test("media workspaces separate asset timeline and export surfaces", () => {
  const video = readFileSync(new URL("./VideoWorkspace.tsx", import.meta.url), "utf8");
  const music = readFileSync(new URL("./MusicWorkspace.tsx", import.meta.url), "utf8");
  for (const view of ["media", "timeline", "export"]) assert.ok(video.includes(`activeView === "${view}"`));
  for (const view of ["audio", "tracks", "export"]) assert.ok(music.includes(`activeView === "${view}"`));
});

test("document workspace exposes real structure annotation and revision surfaces", () => {
  const source = readFileSync(new URL("./DocumentWorkspace.tsx", import.meta.url), "utf8");
  for (const view of ["project", "outline", "body", "references", "slides", "review"]) {
    assert.ok(source.includes(`activeView === "${view}"`), `missing document view: ${view}`);
  }
  assert.match(source, /availableAnchors/);
  assert.match(source, /changeSets/);
  assert.match(source, /onExportChangeSet/);
});

test("document capability keys route files to the shared panel and citation to the references view", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(tabKey === "files"\)\s*\{\s*setBrainResourceTab\("files"\)/s);
  assert.match(source, /const documentView = brainSceneTab === "citation" \? "references" : brainSceneTab/);
});

test("game planning tabs use a persisted project-scoped editor instead of pending placeholders", () => {
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const editor = readFileSync(new URL("./WorkspaceSectionEditor.tsx", import.meta.url), "utf8");
  for (const section of ["design", "world", "level", "combat"]) {
    assert.match(workspace, new RegExp(`${section}: \\{ title:`));
  }
  assert.match(workspace, /<WorkspaceSectionEditor/);
  assert.match(editor, /getBrainWorkspaceSection/);
  assert.match(editor, /saveBrainWorkspaceSection/);
  assert.match(editor, /expectedRevision/);
  assert.match(editor, /BRAIN_WORKSPACE_SECTION_CONFLICT/);
});

test("video writing and music writing tabs reuse the persisted scene editor", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  for (const section of ["script", "storyboard", "caption", "lyrics", "arrangement", "mix"]) {
    assert.match(source, new RegExp(`${section}: \\{ title:`));
  }
  assert.match(source, /workspaceKey="video"/);
  assert.match(source, /workspaceKey="music"/);
});

test("software scene mounts real SoftwareWorkspace and FlowWorkspace instead of ExecShell demo", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /key: "terminal", label: "终端"/);
  assert.match(source, /key: "deploy", label: "部署"/);
  assert.match(source, /<SoftwareWorkspace/);
  assert.match(source, /brainSceneTab === "flow" return <FlowWorkspace/);
  assert.doesNotMatch(source, /<SoftwareExecShell/);
  assert.doesNotMatch(source, /<DocumentPreviewShell/);
});
