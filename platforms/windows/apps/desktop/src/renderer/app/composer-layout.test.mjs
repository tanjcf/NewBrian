import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../ui.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("./WorkspaceModules.tsx", import.meta.url), "utf8");
const desktopCoreSource = readFileSync(new URL("./useDesktopCore.tsx", import.meta.url), "utf8");

test("outline adjustments use a labeled multiline editor instead of a compressed single-line input", () => {
  assert.match(workspaceSource, /<label htmlFor="goal-custom-adjustment-input">\{isIntakeQuestion \? "补充信息" : "自定义调整意见"\}<\/label>/);
  assert.match(workspaceSource, /<textarea[\s\S]*data-testid="goal-custom-adjustment-input"[\s\S]*rows=\{5\}/);
  assert.match(styles, /\.goal-question-custom textarea\s*\{[^}]*min-height:\s*104px;[^}]*resize:\s*vertical;/s);
  assert.match(styles, /\.goal-question-custom button\s*\{[^}]*justify-self:\s*end;/s);
});

test("active goal control stays visible and matches the flat skill control", () => {
  assert.match(workspaceSource, /data-testid="composer-goal-button"[\s\S]*?className="composer-goal-button"[\s\S]*?<SidebarIcon name="target" \/>[\s\S]*?<span>目标<\/span>/);
  assert.doesNotMatch(workspaceSource, /className="composer-feature-capsule"[\s\S]*?<span aria-hidden="true">◎<\/span><span>目标<\/span>/);
  assert.match(styles, /\.composer-modern-controls \.composer-goal-button,[\s\S]*?\.composer-modern-controls \.composer-skill-button\s*\{[^}]*border-radius:\s*0\s*!important;[^}]*font-size:\s*13px\s*!important;/s);
  assert.match(styles, /\.composer-modern-controls \.composer-goal-button:hover,[\s\S]*?background:\s*transparent\s*!important;/s);
});

test("active plan control stays visible and matches the flat goal and skill controls", () => {
  assert.match(workspaceSource, /data-testid="composer-plan-button"[\s\S]*?className="composer-plan-button"[\s\S]*?<SidebarIcon name="plan" \/>[\s\S]*?<span>计划<\/span>/);
  assert.doesNotMatch(workspaceSource, /className="composer-feature-capsule"[\s\S]*?<span aria-hidden="true">☷<\/span><span>计划<\/span>/);
  assert.match(styles, /\.composer-modern-controls \.composer-goal-button,[\s\S]*?\.composer-modern-controls \.composer-plan-button,[\s\S]*?\.composer-modern-controls \.composer-skill-button\s*\{[^}]*border-radius:\s*0\s*!important;[^}]*font-size:\s*13px\s*!important;/s);
  assert.match(styles, /\.composer-modern-controls \.composer-plan-button:hover,[\s\S]*?background:\s*transparent\s*!important;/s);
});

test("new-chat add menu opens below the centered composer and scrolls inside the viewport", () => {
  assert.match(styles, /\.new-chat-composer \.composer-modern-controls \.composer-add-menu\s*\{[^}]*top:\s*calc\(100% \+ 10px\)\s*!important;[^}]*bottom:\s*auto\s*!important;[^}]*max-height:\s*min\(430px, 40vh\)\s*!important;[^}]*overflow-y:\s*auto\s*!important;/s);
});

test("new-chat model/reasoning menu portals to document.body with fixed viewport placement", () => {
  assert.match(workspaceSource, /positionComposerPickerMenu/);
  assert.match(workspaceSource, /composer-reasoning-menu-fixed/);
  assert.match(workspaceSource, /preferBelow:\s*isNewChatMode/);
  assert.match(workspaceSource, /data-testid="composer-reasoning-menu"/);
  assert.ok(
    workspaceSource.includes("composer-reasoning-menu-fixed")
      && workspaceSource.includes("document.body")
      && workspaceSource.includes("createPortal(")
  );
  assert.match(styles, /\.composer-reasoning-menu\.composer-reasoning-menu-fixed\s*\{[^}]*position:\s*fixed\s*!important;[^}]*overflow-y:\s*auto\s*!important;[^}]*z-index:\s*10050\s*!important;/s);
  assert.match(
    styles,
    /\.composer-reasoning-menu\.composer-reasoning-menu-fixed\s*>\s*button[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s*!important;/
  );
  assert.match(
    styles,
    /\.composer-reasoning-menu\.composer-reasoning-menu-fixed\s+\.composer-model-submenu[\s\S]*?overflow-y:\s*auto\s*!important;/
  );
});

test("delegated-agent collaboration uses a compact status strip and a separate details panel", () => {
  assert.match(workspaceSource, /className={`delegated-agent-strip/);
  assert.match(workspaceSource, /className="delegated-agent-panel"/);
  assert.match(workspaceSource, /setDelegatedAgentDetailsOpen\(false\).*\[selectedThreadKey\]/s);
  assert.doesNotMatch(workspaceSource, /<section className="approval-card" aria-label="子 Agent 协作状态">/);
  assert.match(
    styles,
    /\.composer-card:has\(> \.delegated-agent-strip\):not\(:has\(\.composer-image-strip\)\):not\(:has\(\.composer-context-chips\)\):not\(:has\(\.composer-context-fields\)\):not\(:has\(\.composer-queued-draft\)\):not\(\.composer-card--expanded\)\s*\{[^}]*grid-template-rows:\s*32px 56px 42px;/s
  );
  assert.match(
    styles,
    /\.composer-card:has\(> \.delegated-agent-strip\):is\([\s\S]*:has\(\.composer-image-strip\)[\s\S]*\)\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s
  );
  assert.match(
    styles,
    /\.composer-card:has\(> \.delegated-agent-strip\):is\([\s\S]*\) > \.composer-tools\s*\{[^}]*flex:\s*0 0 42px;/s
  );
  assert.match(styles, /\.delegated-agent-panel\s*\{[^}]*position:\s*absolute;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.delegated-agent-panel__list\s*\{[^}]*overflow-y:\s*auto;/s);
});

test("queued composer drafts stay scoped to their owning thread", () => {
  assert.match(appSource, /threadId:\s*currentThread\?\.id \|\| currentThreadId/);
  assert.match(appSource, /enqueueComposerDraft\(queuedComposerDraftsRef\.current, nextDraft\)/);
  assert.match(appSource, /selectedThreadIdRef\.current !== threadId\) return;[\s\S]*?takeNextComposerQueueItem\(queuedComposerDraftsRef\.current, threadId\)/);
  assert.match(workspaceSource, /composerQueueForThread\(composerQueue, selectedThread\?\.id\)/);
  assert.match(workspaceSource, /\{selectedThreadQueue\.length \? \(/);
});

test("a failed or stopped turn pauses the queue instead of auto-sending", () => {
  assert.match(appSource, /if \(!awaitingApproval && !requestFailed\) \{\s*dispatchNextQueuedDraft\(targetThreadId\);/);
  assert.match(workspaceSource, /data-testid="composer-queue-resume"[\s\S]*?onClick=\{resumeComposerQueue\}/);
});

test("an empty project starts in new-task mode and never activates an empty thread id", () => {
  const restoreSelection = desktopCoreSource.slice(
    desktopCoreSource.indexOf("if (catalog[0])"),
    desktopCoreSource.indexOf("} catch (error)", desktopCoreSource.indexOf("if (catalog[0])"))
  );
  assert.match(restoreSelection, /if \(restoredThread\)[\s\S]*?setSelectedThreadId\(restoredThread\.id\);[\s\S]*?else[\s\S]*?setSelectedThreadId\(""\);[\s\S]*?setIsComposingNewThread\(true\);/);
  const modelFinally = appSource.slice(
    appSource.indexOf("if (!awaitingApproval) {", appSource.indexOf("} finally {")),
    appSource.indexOf("dispatchNextQueuedDraft(targetThreadId)", appSource.indexOf("} finally {"))
  );
  assert.equal((modelFinally.match(/if \(targetThreadId && selectedThreadIdRef\.current === targetThreadId\)/g) ?? []).length, 2);
  const removeProjectFlow = workspaceSource.slice(
    workspaceSource.indexOf("const nextCatalog = await api.removeWorkspace"),
    workspaceSource.indexOf("} catch (error)", workspaceSource.indexOf("const nextCatalog = await api.removeWorkspace"))
  );
  assert.match(removeProjectFlow, /if \(selectedWorkspace\?\.id === workspace\.id\)[\s\S]*?const fallbackThreadId = fallback\?\.threads\[0\]\?\.id \?\? "";[\s\S]*?setSelectedWorkspaceId\(fallback\?\.id \?\? ""\);[\s\S]*?setSelectedThreadId\(fallbackThreadId\);[\s\S]*?setIsComposingNewThread\(!fallbackThreadId\);/);
});

test("sidebar project creation works while collapsed and chat actions hide off hover", () => {
  assert.match(
    workspaceSource,
    /ref=\{addWorkspaceButtonRef\}[\s\S]*?className=\{showAddWorkspacePanel \? "active" : ""\}[\s\S]*?onClick=\{\(\) => \{[\s\S]*?setProjectsCollapsed\(false\);[\s\S]*?setShowAddWorkspacePanel\(\(current\) => !current\);[\s\S]*?\}\}/
  );
  assert.match(
    styles,
    /\.codex-sidebar \.sidebar-task-actions \.sidebar-organize-button,\s*\.codex-sidebar \.sidebar-task-actions \.chat-add-button\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s
  );
  assert.match(
    styles,
    /\.codex-sidebar \.chat-subsection-head:hover \.sidebar-task-actions > button,\s*\.codex-sidebar \.sidebar-task-actions > button:focus-visible\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s
  );
});

test("project and chat add buttons use the same dimensions", () => {
  assert.match(
    styles,
    /\.codex-sidebar \.project-subsection-head > button:not\(\.project-subsection-toggle\),\s*\.codex-sidebar \.sidebar-task-actions \.chat-add-button\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*font-size:\s*22px;[^}]*line-height:\s*1;/s
  );
});

test("a stale send-now request continues as the next turn without restarting the app", () => {
  const sendStart = workspaceSource.indexOf("const sendQueuedComposerItemNow = async");
  const sendSource = workspaceSource.slice(sendStart, workspaceSource.indexOf("const resumeComposerQueue", sendStart));
  assert.match(sendSource, /result\.code === "request_not_active"/);
  assert.match(sendSource, /releaseInactiveModelRequest\?\.\(requestId, threadId\)/);
  assert.match(sendSource, /if \(!requestId\)[\s\S]*?askModel\(item\)/);
  assert.match(sendSource, /guideModelRequest\(\{ requestId, message, attachments, delivery: "steer" \}\)/);
});

test("queued items render as a list with send-now, edit and remove actions", () => {
  assert.match(workspaceSource, /className="composer-queue-list"/);
  assert.match(workspaceSource, /aria-label="立即发送"[\s\S]*?sendQueuedComposerItemNow\(item\)/);
  assert.match(workspaceSource, /aria-label="编辑排队消息"[\s\S]*?editQueuedComposerItem\(item\)/);
  assert.match(workspaceSource, /aria-label="删除排队消息"[\s\S]*?removeQueuedComposerItem\(item\)/);
  assert.doesNotMatch(workspaceSource, /↪ 引用/);
  assert.match(workspaceSource, /Append onto whatever the user already typed/);
  assert.match(styles, /\.composer-queue\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*100%;/s);
  assert.match(styles, /\.composer-queue-list\s*\{[^}]*max-height:\s*144px;[^}]*overflow-y:\s*auto;/s);
  assert.match(workspaceSource, /composer-card--expanded/);
  assert.match(styles, /\.composer-card\.composer-card--expanded/);
});

test("send-now leaves the queue only after a successful dispatch", () => {
  const sendStart = workspaceSource.indexOf("const sendQueuedComposerItemNow = async");
  const sendSource = workspaceSource.slice(sendStart, workspaceSource.indexOf("const resumeComposerQueue", sendStart));
  assert.match(sendSource, /requeueComposerItemFirst\(readComposerQueue\(\), item\)/);
  assert.match(sendSource, /已保持排队/);
  assert.doesNotMatch(sendSource, /combineComposerQuote/);
});

test("document previews open beside the mounted conversation and close without navigation", () => {
  const previewHandler = workspaceSource.slice(
    workspaceSource.indexOf("const openLocalFilePreview"),
    workspaceSource.indexOf("const openE2EFilePreview")
  );
  assert.match(previewHandler, /setPreviewPlacement\("side"\)/);
  assert.doesNotMatch(previewHandler, /setPreviewPlacement\("center"\)/);
  assert.match(workspaceSource, /\{previewPlacement === "side" && activeFeature === "new-chat" \? renderPreviewModule\("side"\) : null\}/);
  assert.match(workspaceSource, /setPreviewPlacement\("hidden"\); setSearchFilePreview\(null\)/);
  assert.match(workspaceSource, /artifactTabs\.map/);
  assert.match(workspaceSource, /closeArtifactTab/);
  assert.match(readFileSync(new URL("../ui.tsx", import.meta.url), "utf8"), /previewPlacement === "side" && searchFilePreview \? " artifact-workbench"/);
  assert.match(styles, /\.workspace-frame\.artifact-workbench/);
  assert.match(styles, /\.artifact-tab-strip/);
  assert.match(styles, /\.workspace-pdf-toolbar/);
  assert.match(workspaceSource, /new TextLayer/);
  assert.match(styles, /\.workspace-artifact-pdf-text-layer/);
  assert.match(workspaceSource, /WorkspaceArtifactViewerHost/);
  const viewerRegistry = readFileSync(new URL("./artifact-viewer-registry.tsx", import.meta.url), "utf8");
  assert.match(viewerRegistry, /viewerRegistry\.set\("slides", BuiltinSlidesFileViewer\)/);
  assert.match(viewerRegistry, /newbrain-resource:\/\//);
  // BRAIN project panel open → side slot; otherwise Office still may center.
  assert.match(previewHandler, /useProjectPanelSlot/);
  assert.match(previewHandler, /docx\|pdf\|pptx\|xlsx/);
  assert.match(styles, /\.workspace-artifact-pptx/);
});

test("file changes use Codex-style progressive disclosure and preserve per-thread expansion", () => {
  assert.match(workspaceSource, /expandedFileChangeGroups/);
  assert.match(workspaceSource, /const groupKey = `\$\{selectedThread\?\.id \|\| "thread"\}:\$\{turnId\}`/);
  assert.match(workspaceSource, /className="assistant-file-context-summary"/);
  assert.match(workspaceSource, /previewMode === "workspace" \? searchFilePreview\?\.name \|\| selectedWorkspace\?\.name \|\| "项目"/);
  assert.match(workspaceSource, /<a[\s\S]*className="assistant-file-link"[\s\S]*href=\{file\.filePath\}[\s\S]*data-local-file-path=\{file\.filePath\}/);
  assert.match(workspaceSource, /className="assistant-file-diff-toggle"/);
  assert.match(workspaceSource, /data-testid="assistant-inline-diff"/);
  assert.match(workspaceSource, /api\.getReviewChanges/);
  assert.match(workspaceSource, /className="assistant-file-link"[\s\S]*openLocalFilePreview\(file\.filePath\)/);
  assert.doesNotMatch(workspaceSource.slice(
    workspaceSource.indexOf("wasAskingModelRef.current && !isAskingModel"),
    workspaceSource.indexOf("const historicalPatchActivities")
  ), /setExpandedFileChangeGroups|setExpandedFileDiffs/);
  assert.match(styles, /\.assistant-file-context-summary\s*\{/);
  assert.match(styles, /\.assistant-inline-diff-row\.add\s*\{/);
  assert.match(styles, /\.assistant-inline-diff-row\.del\s*\{/);
});

test("execution details remain transient and collapse when a model turn completes", () => {
  assert.match(workspaceSource, /wasAskingModelRef\.current && !isAskingModel/);
  assert.match(workspaceSource, /setExpandedAssistantTurns\(new Set\(\)\)/);
  assert.match(workspaceSource, /data-testid="reasoning-summary-live"/);
  assert.match(workspaceSource, /data-testid="reasoning-process-list"/);
  assert.match(workspaceSource, /sanitizeVisibleModelContent\(turn\.assistant\.content\)/);
});

test("the active turn keeps the user prompt visible and expands live reasoning commands", () => {
  assert.match(workspaceSource, /conversation-turn\$\{isLiveTurn \? " current" : ""\}/);
  assert.match(styles, /\.conversation-turn\.current\s*\{[^}]*content-visibility:\s*visible;/s);
  assert.match(workspaceSource, /manuallyCollapsedActivityGroupsRef/);
  assert.match(workspaceSource, /setExpandedActivityGroups\(\(current\)[\s\S]*liveGroupKey/);
  assert.match(workspaceSource, /setExpandedCommandRuns\(\(current\)[\s\S]*runKeys/);
  assert.match(workspaceSource, /data-testid="reasoning-summary-live"/);
  assert.match(styles, /\.answer-group\.streaming \.assistant-live-progress\s*\{[^}]*order:\s*1;/s);
  assert.match(styles, /\.answer-group\.streaming \.assistant-block\s*\{[^}]*order:\s*2;/s);
  assert.match(workspaceSource, /sanitizeVisibleModelContent\(activeStreamContent/);
});

test("streaming conversation sticks to the main task scroller without nested live scroll", () => {
  assert.match(workspaceSource, /stickToBottomRef/);
  assert.match(workspaceSource, /data-testid="task-scroll"/);
  assert.match(workspaceSource, /data-testid="chat-jump-latest"/);
  assert.match(workspaceSource, /activeStreamContent\.length/);
  assert.match(workspaceSource, /activeReasoningSummary\.length/);
  assert.match(workspaceSource, /ResizeObserver/);
  assert.doesNotMatch(workspaceSource, /if \(isAskingModel \|\| !latestAssistant/);
  assert.match(styles, /\.assistant-reasoning-summary\.live\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s);
  assert.match(styles, /\.chat-jump-latest\s*\{/);
});

test("local task history remains canonical when remote response storage is disabled", () => {
  assert.match(appSource, /Remote response storage is a provider privacy setting/);
  assert.match(appSource, /if \(selectedThreadIdRef\.current === targetThreadId\) \{\s*\/\/[\s\S]*syncSnapshot\(canonicalSnapshot, targetThreadId\);\s*\}/);
  assert.doesNotMatch(appSource, /desktopPreferences\.configuration\.saveResponses\) \{\s*syncSnapshot\(canonicalSnapshot/);
  assert.doesNotMatch(appSource, /Keep the non-persisted response visible for this session/);
});

test("command approval uses a layered card with one-shot wording and collapsed commands", () => {
  assert.match(workspaceSource, /"批准并继续"/);
  assert.match(workspaceSource, /仅批准本次操作/);
  assert.match(workspaceSource, /approval-command-toggle/);
  assert.doesNotMatch(workspaceSource, /"运行命令"/);
  assert.match(styles, /\.approval-command-preview\s*\{[^}]*-webkit-line-clamp:\s*3;/s);
  assert.match(styles, /\.approval-request-actions\s*\{[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /\.composer-card > \.composer-approval-banner\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*calc\(100% \+ 10px\);/s);
  assert.match(styles, /\.composer-card:has\(> \.composer-approval-banner\)[^{]*\{[^}]*overflow:\s*visible\s*!important;/s);
  assert.match(styles, /\.task-column \.composer-card > \.composer-approval-banner\s*\{[^}]*top:\s*auto\s*!important;[^}]*bottom:\s*calc\(100% \+ 10px\)\s*!important;[^}]*margin:\s*0\s*!important;/s);
  assert.doesNotMatch(styles, /\.composer-card:has\(> \.composer-approval-banner\) > :not\(\.composer-approval-banner\)\s*\{[^}]*display:\s*none/s);
});

test("approved commands expose live model output and remain cancellable", () => {
  assert.match(workspaceSource, /data-testid="approval-live-output"/);
  assert.match(workspaceSource, /activeReasoningSummary/);
  assert.match(workspaceSource, /activeStreamContent/);
  assert.match(workspaceSource, /visibleAssistantActivities/);
  assert.match(workspaceSource, /cancelCurrentModelRequest/);
  assert.match(styles, /\.approval-live-output\s*\{/);
});

test("reasoning starts empty and only displays model-provided summary deltas", () => {
  assert.match(appSource, /const initialReasoningSummary = ""/);
  assert.doesNotMatch(appSource, /Analyzing the request, goals, constraints, and current context/);
});

test("new asks scope live activities to the active request without discarding history", () => {
  assert.match(appSource, /requestActivitiesRef\.current\.set\(streamRequestId, \[\]\)/);
  assert.match(appSource, /Always retain the event on its request bucket/);
  assert.match(appSource, /mergeAssistantActivityItems\(/);
  assert.match(workspaceSource, /resolveActiveReasoningRequestId\(/);
  assert.match(workspaceSource, /activity\.requestId === activeReasoningRequestId/);
  assert.match(workspaceSource, /selectedThreadOwnsLiveApproval/);
  assert.doesNotMatch(
    workspaceSource,
    /activeThreadRequestIds\[selectedThread\.id\] \|\| Object\.values\(activeThreadRequestIds/
  );
  assert.match(workspaceSource, /const isLiveTurn = isAskingModel && index === conversationTurns\.length - 1/);
  assert.match(workspaceSource, /!isLiveTurn && \(/);
  assert.match(workspaceSource, /index === conversationTurns\.length - 1 && effectiveApproval/);
  assert.match(workspaceSource, /data-testid="conversation-approval-dialog"/);
  assert.match(workspaceSource, /resolveEffectiveApproval\(/);
});

test("composer model menu exposes Auto as a selectable route", () => {
  assert.match(workspaceSource, /\{ id: "auto", label: "Auto" \}/);
  assert.match(workspaceSource, /modelConfig\.model\.toLowerCase\(\) === "auto"/);
});

test("BRAIN conversation composer never uses new-chat absolute dock", () => {
  assert.match(
    workspaceSource,
    /composer-area\$\{isNewChatMode && !isBrainConversationSelection \? " new-chat-composer" : ""\}\$\{isBrainConversationSelection \? " brain-chat-composer" : ""\}/
  );
  assert.match(workspaceSource, /setIsComposingNewThread\(false\);[\s\S]*selectedBrainConversationId, selectedBrainProjectId, brainConversations, setIsComposingNewThread/);
  assert.match(
    styles,
    /\.brain-chat-composer-slot \.composer-area\.new-chat-composer\s*\{[^}]*position:\s*static;[^}]*transform:\s*none;/s
  );
});

test("live thinking panel prints Chinese process text in the marked reasoning area", () => {
  assert.match(workspaceSource, /function buildLiveReasoningProcess/);
  assert.match(workspaceSource, /data-testid="reasoning-summary-live"/);
  assert.match(workspaceSource, /Analyzing the request, goals, constraints, and current context/);
  assert.match(workspaceSource, /buildLiveReasoningProcess\(/);
});

test("sidebar account footer keeps update and settings buttons visible", () => {
  assert.match(workspaceSource, /className="sidebar-account-actions"/);
  assert.match(workspaceSource, /className="sidebar-account-update"/);
  assert.match(workspaceSource, /className="sidebar-account-settings"/);
  assert.match(
    styles,
    /\.codex-sidebar \.sidebar-account-card\s*\{[^}]*grid-template-columns:\s*36px minmax\(0,\s*1fr\) auto;/s
  );
  assert.match(
    styles,
    /\.sidebar-account-meta strong,\s*\.sidebar-account-meta span,\s*\.sidebar-account-meta em\s*\{[^}]*text-overflow:\s*ellipsis;/s
  );
  assert.match(
    styles,
    /\.sidebar-account-actions\s*\{[^}]*flex-shrink:\s*0;/s
  );
});
