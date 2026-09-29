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

test("prefers durable desktop preference over localStorage for the last scene", () => {
  const serialized = JSON.stringify({
    version: 2,
    selectedWorkspaceKey: "explore",
    catalogs: { quant: { projectId: "q1", conversationId: "c1" } }
  });
  const restored = restoreBrainWorkspaceSelection({
    serialized,
    preferredWorkspaceKey: "quant"
  });
  assert.equal(restored.selection.selectedWorkspaceKey, "quant");
  assert.deepEqual(restored.selection.catalogs.quant, { projectId: "q1", conversationId: "c1" });
});

test("ignores invalid preferred workspace keys", () => {
  const restored = restoreBrainWorkspaceSelection({
    preferredWorkspaceKey: "not-a-scene",
    legacyWorkspaceKey: "music"
  });
  assert.equal(restored.selection.selectedWorkspaceKey, "music");
});

test("switchBrainWorkspace restores sidebar selection from target scene catalog", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /setSelectedSidebarRow\(`brain-conversation:\$\{nextCatalog\.conversationId\}`\)/);
  assert.match(source, /setSelectedSidebarRow\(`brain-project:\$\{nextCatalog\.projectId\}`\)/);
  assert.doesNotMatch(source, /switchBrainWorkspace[\s\S]*setBrainConversations\(\[\]\)/);
});

test("scene switching clears outgoing composer Skill and never submits into another scene", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const switchSource = source.slice(source.indexOf("const switchBrainWorkspace"), source.indexOf("useEffect(() => {\n    // Standalone / INTERNAL_CHAT"));
  const submitSource = source.slice(source.indexOf("function submitComposerRequest"), source.indexOf("function renderBrainChatModule"));
  assert.match(switchSource, /setSelectedComposerSkill\(null\)/);
  assert.match(switchSource, /setSelectedComposerTools\(\[\]\)/);
  assert.match(switchSource, /setSelectedThreadId\(""\)/);
  assert.match(submitSource, /resolveSceneExecutionWorkspace/);
  assert.match(submitSource, /forceStandaloneChat:\s*true/);
  assert.match(submitSource, /wantsStandaloneChat/);
  assert.match(submitSource, /inProjectConversationContext/);
  assert.match(submitSource, /forceProjectThread:\s*true/);
  assert.match(submitSource, /独立聊天|INTERNAL_CHAT|forceStandaloneChat/);
  assert.doesNotMatch(submitSource, /本次请求未发送/);
  assert.match(submitSource, /请再次发送/);
  assert.doesNotMatch(source, /boundWorkspaceId \|\| activeWorkspaceId/);
});

test("project BRAIN conversations keep project-scoped composer routing on send", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const submitSource = source.slice(source.indexOf("function submitComposerRequest"), source.indexOf("function renderBrainChatModule"));
  assert.match(submitSource, /isBrainConversationSelection[\s\S]*forceProjectThread:\s*true/);
  assert.match(submitSource, /!inProjectConversationContext[\s\S]*wantsStandaloneChat/);
  assert.match(source, /setNewThreadScope\("project"\);[\s\S]*setChatUsesProject\?\.\(true\);[\s\S]*brain-conversation:/);
});

test("sidebar thread clicks force disk hydration for legacy rows", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const renderSidebarTaskEntry = source.slice(
    source.indexOf("function renderSidebarTaskEntry"),
    source.indexOf("function renderSidebarModule")
  );
  const projectThreadClick = source.slice(
    source.indexOf("data-testid=\"sidebar-project-task-row\""),
    source.indexOf("data-testid=\"sidebar-project-task-row\"") + 1800
  );
  assert.match(renderSidebarTaskEntry, /selectWorkspaceThread\(workspace\.id, thread\.id, \{ force: true \}\)/);
  assert.match(projectThreadClick, /selectWorkspaceThread\(workspace\.id, thread\.id, \{ force: true \}\)/);
  assert.match(source, /LEGACY_SIDEBAR_ROW_STORAGE_KEY/);
  assert.match(source, /resolveLegacySidebarRowForThread/);
});

test("sidebar chat rows use chat: selection prefix and stay on thread history", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const renderSidebarTaskEntry = source.slice(
    source.indexOf("function renderSidebarTaskEntry"),
    source.indexOf("function renderSidebarModule")
  );
  assert.match(renderSidebarTaskEntry, /setSelectedSidebarRow\(`chat:\$\{workspace\.id\}:\$\{thread\.id\}`\)/);
  assert.match(renderSidebarTaskEntry, /setIsComposingNewThread\(false\)/);
  assert.doesNotMatch(renderSidebarTaskEntry, /setSelectedSidebarRow\(`task:/);
  assert.match(source, /selectedSidebarRow\?\.startsWith\("project-thread:"\) \|\| selectedSidebarRow\?\.startsWith\("chat:"\)/);
  assert.match(source, /sidebarRow\.startsWith\("chat:"\)/);
});

test("binds document project selection to local workspace without hijacking project-thread rows", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /bindBrainProjectToWorkspace\(/);
  assert.match(source, /resolveBrainProjectForWorkspace/);
  assert.match(source, /shouldSyncBrainConversationThread/);
  assert.match(source, /String\(selectedSidebarRow \|\| ""\)\.startsWith\("project:"\)/);
  assert.match(source, /setSelectedSidebarRow\(`project:\$\{workspace\.id\}`\)/);
});

test("never activates a conversation thread that belongs to the outgoing project", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /mappedThreadBelongsToWorkspace/);
  assert.match(source, /selectedWorkspace\?\.threads\?\.some/);
  assert.match(source, /delete next\[selectedBrainConversationId\]/);
  const guard = source.indexOf("if (!mappedThreadBelongsToWorkspace)");
  const activation = source.indexOf("void api.activateWorkspaceThread", guard);
  assert.ok(guard >= 0 && activation > guard);
});

test("approval UI ownership stays on the owning thread and clears stale catalog per thread", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /resolveSelectedThreadOwnsLiveApproval/);
  assert.match(source, /resolvePendingApprovalThreadKey/);
  assert.match(source, /clearStaleThreadApprovalInCatalog/);
  assert.doesNotMatch(source, /pendingApprovalThreadKey = snapshot\?\.approval \? selectedThreadKey/);
  assert.doesNotMatch(source, /selectedThreadOwnsLiveApproval = Boolean\(\s*isAskingModel/);
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
  assert.match(source, /sceneChatWorkspaces/);
  assert.match(source, /filterWorkspaceCatalogByScene/);
  assert.match(source, /orderSidebarProjects/);
  assert.match(source, /crossSceneRecentProjects|data-testid="brain-recent-projects"/);
  assert.match(source, /data-testid="new-chat-button"/);
  const startNewChatSource = source.slice(source.indexOf("function startNewChat"), source.indexOf("function renderSidebarTaskEntry"));
  assert.match(startNewChatSource, /setNewThreadScope\("chat"\)/);
  assert.match(startNewChatSource, /setChatUsesProject\?\.\(false\)/);
  assert.doesNotMatch(startNewChatSource, /setNewThreadScope\("project"\)/);
  assert.match(source, /setNewThreadScope\("project"\)/);
  assert.match(source, /brainWorkspaceKey:\s*selectedBrainWorkspaceKey/);
  assert.match(source, /新建空白项目/);
  assert.match(source, /暂无聊天/);
  assert.match(source, /project-hover-actions/);
  assert.match(source, /project-list/);
});

test("keeps quant conversation in the center and renders market tools in the right resource panel", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const workspaceRenderer = source.slice(source.indexOf("function renderWorkspaceModules"));
  const resourcePanel = source.slice(source.indexOf("function renderBrainResourcePanel"), source.indexOf("function renderChatModule"));

  assert.match(workspaceRenderer, /brainToolsSide \? renderBrainResourcePanel\("side"\)/);
  assert.match(workspaceRenderer, /brainToolsCentered/);
  assert.match(workspaceRenderer, /renderBrainResourcePanel\("center"\)/);
  assert.doesNotMatch(workspaceRenderer, /selectedBrainWorkspaceKey === "quant"\s*\?\s*<QuantWorkspace/);
  assert.match(resourcePanel, /selectedBrainWorkspaceKey === "quant"/);
  assert.match(resourcePanel, /<QuantWorkspace[^>]+compact/);
  assert.match(resourcePanel, /brain-resource-resize-handle/);
  assert.match(resourcePanel, /展开预览|还原布局/);
  assert.match(resourcePanel, /隐藏侧栏/);
  assert.match(resourcePanel, /SidebarIcon name=\{isCenter \? "minimize" : "maximize"\}/);
  assert.match(resourcePanel, /panel-right/);
  assert.match(source, /brain-tools-restore-toggle|显示工具侧栏/);
  assert.match(source, /data-testid="brain-tools-restore-toggle"/);
  assert.match(workspaceRenderer, /brainResourcePlacement === "hidden"[\s\S]*?brain-tools-restore-toggle/);
  assert.doesNotMatch(source, /brain-resource-restore-rail/);

  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  // Collapsed Tools residual must sit on workspace-frame so empty home / no-project / hidden new-chat topbar still show it.
  assert.match(styles, /\.workspace-frame\s*>\s*\.brain-tools-restore-toggle\s*\{[^}]*position:\s*absolute/s);
});

test("expanding the right Tools panel hides the left sidebar like open-file artifact-workbench", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const resourcePanel = source.slice(source.indexOf("function renderBrainResourcePanel"), source.indexOf("function renderChatModule"));

  // Shared expand toggle for every scene (center ↔ side).
  assert.match(resourcePanel, /current === "center"[\s\S]*?return "side"/);
  assert.match(resourcePanel, /title=\{isCenter \? "还原布局" : "展开预览"\}/);
  assert.match(resourcePanel, /aria-pressed=\{isCenter\}/);
  assert.match(resourcePanel, /expand-sidebar/);
  assert.match(resourcePanel, /SidebarIcon name=\{isCenter \? "minimize" : "maximize"\}/);

  // Expand must keep chat rendered beside Tools (not replace mainModule with the panel).
  assert.match(source, /brainToolsCentered \? renderBrainResourcePanel\("center"\)/);
  assert.doesNotMatch(source, /const mainModule = brainToolsCentered\s*\?\s*renderBrainResourcePanel\("center"\)/);

  // Open-file workbench already hides the left menu and keeps chat.
  assert.match(styles, /\.workspace-frame\.artifact-workbench\s*>\s*\.codex-sidebar\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(styles, /\.workspace-frame\.artifact-workbench[\s\S]*?grid-template-columns:\s*clamp\(340px,\s*31vw,\s*460px\)\s*minmax\(560px,\s*1fr\)\s*!important/);

  // Tools expand (.center): hide left nav only; chat + Tools two-column like open-file.
  assert.match(styles, /\.workspace-frame:has\(\s*>\s*\.brain-resource-panel\.center\s*\)\s*>\s*\.codex-sidebar\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(styles, /\.workspace-frame:has\(\s*>\s*\.brain-resource-panel\.center\s*\)[\s\S]*?grid-template-columns:\s*clamp\(340px,\s*31vw,\s*460px\)\s*minmax\(560px,\s*1fr\)\s*!important/);
  assert.match(styles, /\.workspace-frame:has\(\s*>\s*\.brain-resource-panel\.center\s*\)\s*>\s*\.task-column/);
  assert.doesNotMatch(styles, /\.workspace-frame:has\(\s*>\s*\.brain-resource-panel\.center\s*\)\s*>\s*\.brain-resource-panel\.center\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
});

test("center file preview keeps the chat column instead of replacing it", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const workspaceRenderer = source.slice(source.indexOf("function renderWorkspaceModules"));

  assert.doesNotMatch(workspaceRenderer, /const mainModule = previewPlacement === "center"/);
  assert.match(workspaceRenderer, /showCenterPreview \? renderPreviewModule\("center"\)/);
  assert.match(workspaceRenderer, /renderChatModule\(\)/);
  assert.match(styles, /\.workspace-frame\.preview-centered:has\(> \.preview-center-module\)/);
  assert.match(styles, /\.workspace-frame\.preview-centered:has\(> \.preview-center-module\) > \.task-column/);
  assert.match(styles, /\.workspace-frame\.preview-centered:has\(> \.preview-center-module\) > \.preview-center-module/);
});

test("startup hydrates persisted sidebar thread rows before brain conversation sync", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /legacySidebarRowHydratedRef/);
  assert.match(source, /shouldPreferSidebarRowThreadRestore/);
  assert.match(source, /resolveSidebarRowThreadTarget/);
  assert.match(source, /parseLegacyConversationThreadId\(selectedBrainConversationId\)/);
});

test("remembers the last scene via desktop preferences and does not wipe restore when workspace list is empty", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /preferredWorkspaceKey:\s*desktopPreferences\?\.brain\?\.selectedWorkspaceKey/);
  assert.match(source, /saveDesktopPreferences\(\{[\s\S]*selectedWorkspaceKey:\s*key/);
  assert.match(source, /if \(!enabled\.length\) return;/);
  assert.match(source, /selectedBrainWorkspaceKeyRef/);
});

test("switching scenes restores the right-hand scene panel instead of the generic files side preview", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const switchFn = source.slice(source.indexOf("const switchBrainWorkspace"), source.indexOf("useEffect(() => {\n    // Standalone / INTERNAL_CHAT"));
  assert.match(switchFn, /setPreviewPlacement\("hidden"\)/);
  assert.match(switchFn, /setPreviewMode\("empty"\)/);
  assert.match(switchFn, /setSearchFilePreview\(null\)/);
  assert.match(source, /resolveCatalogBrainWorkspaceKey\(selectedWorkspace\) !== selectedBrainWorkspaceKey/);
  assert.match(source, /INTERNAL_CHAT_WORKSPACE_ID/);
  assert.match(source, /isComposingNewThread && newThreadScope === "chat" && !chatUsesProject/);
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

test("explore scene restores original NewBrain right panel without fake scene tools", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const tabsBlock = source.slice(source.indexOf("const brainWorkspaceCapabilityTabs"), source.indexOf("import { WorkspaceHtmlViewer"));
  const resourcePanel = source.slice(source.indexOf("function renderBrainResourcePanel"), source.indexOf("function renderChatModule"));

  assert.match(tabsBlock, /explore:\s*\[\s*\]/);
  assert.doesNotMatch(tabsBlock, /label:\s*"场景知识"/);
  assert.doesNotMatch(tabsBlock, /label:\s*"可用工具"/);
  assert.match(resourcePanel, /capabilityTabs\.length \?/);
  assert.match(resourcePanel, /selectedBrainWorkspaceKey === "explore"[\s\S]*?return null/);
  assert.match(resourcePanel, /文件 <em>\{brainFiles\.length\}<\/em>/);
  assert.match(resourcePanel, /产物 <em>\{brainArtifacts\.length\}<\/em>/);
  assert.match(resourcePanel, /任务 <em>\{brainTasks\.length\}<\/em>/);
});

test("opening files while BRAIN project panel is visible uses the right-hand project slot", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const openPreview = source.slice(source.indexOf("const openLocalFilePreview = useCallback"), source.indexOf("}, [api, brainResourcePlacement, reportFilePreviewIssue"));
  assert.match(openPreview, /useProjectPanelSlot/);
  assert.match(openPreview, /brainResourcePlacement !== "hidden"/);
  assert.match(openPreview, /useProjectPanelSlot\s*\?\s*"side"/);
  assert.match(source, /brainToolsSide = activeFeature === "new-chat" && brainResourcePlacement === "side" && previewPlacement !== "side"/);
  assert.match(source, /previewPlacement === "side" && activeFeature === "new-chat" \? renderPreviewModule\("side"\)/);
  // Search must not force Office docs back into the chat column after openLocalFilePreview.
  const selectSearch = source.slice(source.indexOf("function selectSearchTarget"), source.indexOf("function renderSearchDialogLegacy"));
  assert.doesNotMatch(selectSearch, /setPreviewPlacement\("center"\)/);
});

test("markdown files open as a scrollable rendered preview", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const markdownBlock = source.slice(source.indexOf("isMarkdownPreviewFile(searchFilePreview)"), source.indexOf("workspace-artifact-text-shell"));
  assert.match(source, /function isMarkdownPreviewFile/);
  assert.match(markdownBlock, /data-testid="workspace-markdown-preview"/);
  assert.match(markdownBlock, /<MarkdownMessage/);
  assert.doesNotMatch(markdownBlock, /preview-line/);
  assert.match(styles, /\.workspace-artifact-markdown[\s\S]*overflow:\s*auto/);
  assert.match(styles, /\.workspace-artifact-text-shell,\s*\n\.workspace-artifact-markdown[\s\S]*overflow:\s*auto/);
});

test("pptx board thumbnails render scaled slide content previews", () => {
  const source = readFileSync(new URL("./artifact-viewer-registry.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(source, /function PptxSlideThumb/);
  assert.match(source, /renderThumbnailToContainer/);
  assert.match(source, /pptx-thumb-preview/);
  assert.match(styles, /\.pptx-thumb-preview[\s\S]*pointer-events:\s*none/);
});

test("pptx artifact creation auto-opens Tools preview and force-reloads as slides grow", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const notify = source.slice(source.indexOf("onDataWorkspaceUpdated"), source.indexOf("setDocumentAnnotationCandidate(null)"));
  assert.match(notify, /artifact\\.create\|document\\.create_/);
  assert.match(notify, /forceReload:\s*true/);
  assert.match(notify, /setBrainSceneTab\("preview"\)/);
  assert.match(source, /location\?\.forceReload/);
  assert.match(readFileSync(new URL("./document-annotation-policy.ts", import.meta.url), "utf8"), /isPptxEditableShapeAnchor/);
});

test("docx preview fills the side panel and scrolls instead of using a fixed-height iframe", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const docxBlock = source.slice(source.indexOf('searchFilePreview.kind === "docx"'), source.indexOf('searchFilePreview.kind === "pptx"'));
  assert.match(docxBlock, /workspace-artifact-docx-shell/);
  assert.match(docxBlock, /data-testid="workspace-docx-viewer"/);
  assert.match(docxBlock, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(docxBlock, /<iframe[\s\S]*workspace-artifact-docx/);
  assert.match(styles, /\.workspace-artifact-docx-shell[\s\S]*flex:\s*1\s*1\s*auto/);
  assert.match(styles, /\.workspace-artifact-docx[\s\S]*overflow:\s*auto/);
});

test("audio preview uses the built-in music player plugin and display-name artifact routing", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const openPreview = source.slice(source.indexOf("const openLocalFilePreview = useCallback"), source.indexOf("}, [api, brainResourcePlacement, reportFilePreviewIssue"));
  assert.match(openPreview, /isWorkspaceArtifactPreviewPath\(requestPath, displayName\)/);
  assert.match(openPreview, /displayName \|\| openPath/);
  assert.match(source, /displayName: file\.logicalName/);
  const audioBlock = source.slice(source.indexOf('searchFilePreview.kind === "audio"'), source.indexOf('searchFilePreview.kind === "spreadsheet"'));
  assert.match(audioBlock, /WorkspaceArtifactViewerHost preview=\{searchFilePreview\}/);
  assert.doesNotMatch(audioBlock, /<audio controls preload="metadata"/);
  assert.match(readFileSync(new URL("./artifact-viewer-registry.tsx", import.meta.url), "utf8"), /viewerRegistry\.set\("music"/);
  assert.match(styles, /\.workspace-artifact-music[\s\S]*> audio/);
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

test("document capability keys route files to the shared panel", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(tabKey === "files"\)\s*\{\s*setBrainResourceTab\("files"\)/s);
  assert.match(source, /const documentView = brainSceneTab === "files" \? "project" : "review"/);
});

test("game planning tabs use persisted editors instead of pending placeholders", () => {
  const workspace = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  const editor = readFileSync(new URL("./WorkspaceSectionEditor.tsx", import.meta.url), "utf8");
  assert.match(workspace, /brainSceneTab === "level"\) return <GameLevelEditor/);
  assert.match(workspace, /brainSceneTab === "design"[\s\S]*?<WorkspaceSectionEditor/);
  assert.match(workspace, /world: \{ title: "角色与世界观"/);
  assert.match(workspace, /combat: \{ title: "战斗设计"/);
  assert.match(workspace, /<GameDesignPanel/);
  assert.match(editor, /getBrainWorkspaceSection/);
  assert.match(editor, /saveBrainWorkspaceSection/);
  assert.match(editor, /expectedRevision/);
  assert.match(editor, /BRAIN_WORKSPACE_SECTION_CONFLICT/);
});

test("video and music scenes mount pipeline shells instead of legacy section editors", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /<VideoPipelineShell/);
  assert.match(source, /<MusicDawShell/);
  assert.match(source, /refreshToken=\{dataWorkspaceRefreshToken\}/);
  assert.match(source, /reason\.startsWith\("music:"\)/);
  assert.match(source, /key: "script", label: "脚本"/);
  assert.match(source, /key: "tracks", label: "本镜音视频轨"/);
  assert.match(source, /key: "gen", label: "生成"/);
  assert.match(source, /key: "slice", label: "标记切片"/);
});

test("software scene mounts real SoftwareWorkspace and FlowWorkspace instead of ExecShell demo", () => {
  const source = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
  assert.match(source, /key: "terminal", label: "终端"/);
  assert.match(source, /key: "deploy", label: "部署"/);
  assert.match(source, /<SoftwareWorkspace/);
  assert.match(source, /brainSceneTab === "flow"\) return <FlowWorkspace/);
  assert.doesNotMatch(source, /<SoftwareExecShell/);
  assert.doesNotMatch(source, /<DocumentPreviewShell/);
});
