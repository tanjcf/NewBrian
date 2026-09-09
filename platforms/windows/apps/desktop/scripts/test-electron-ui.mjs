import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9333);
const session = await ensureElectronE2ESession(debugPort);
const pages = session.pages;
const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
if (!session.started) {
  socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } }));
  await new Promise((resolve) => setTimeout(resolve, 1_500));
} else {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

let nextId = 0;
function evaluate(expression, timeoutMs = 15_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP evaluation ${id} timed out.`)), timeoutMs);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
        return;
      }
      resolve(payload.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true }
    }));
  });
}

if (session.started && session.workspacePath) {
  const testWorkspacePath = join(session.workspacePath, ".newbrain", "projects", "test");
  await mkdir(testWorkspacePath, { recursive: true });
  await writeFile(join(testWorkspacePath, "final-artifact.txt"), "DEEPSEEK_FILE_FINAL_OK\n", "utf8");
  const seeded = await evaluate(`(async () => {
    const workspacePath = ${JSON.stringify(testWorkspacePath)};
    let catalog = await window.newbrain.listWorkspaces();
    if (!catalog.some((item) => item.path === workspacePath)) {
      catalog = await window.newbrain.addWorkspace({ name: "NewBrain File Preview E2E", path: workspacePath });
    }
    const workspace = catalog.find((item) => item.path === workspacePath);
    if (!workspace) return false;
    if (!(workspace.threads || []).some((thread) => thread.title === "Sidebar Project E2E")) {
      catalog = await window.newbrain.addWorkspaceThread({ workspaceId: workspace.id, title: "Sidebar Project E2E", summary: "project sidebar task", scope: "project" });
    }
    const refreshed = catalog.find((item) => item.id === workspace.id);
    if (!(refreshed?.threads || []).some((thread) => thread.title === "Sidebar Chat E2E")) {
      await window.newbrain.addWorkspaceThread({ workspaceId: workspace.id, title: "Sidebar Chat E2E", summary: "projectless sidebar task", scope: "chat" });
    }
    return true;
  })()`);
  assert.equal(seeded, true, "Failed to seed the isolated file-preview workspace.");
  socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } }));
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

async function waitFor(label, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const diagnostics = await evaluate(`JSON.stringify({ title: document.title, text: document.body?.innerText?.slice(0, 500), html: document.body?.innerHTML?.slice(0, 500) })`).catch(() => "");
  throw new Error(`Timed out waiting for ${label}. Renderer diagnostics: ${diagnostics}`);
}

await evaluate(`(() => {
  const backToApp = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('返回应用'));
  if (backToApp instanceof HTMLButtonElement) backToApp.click();
  return true;
})()`);
await waitFor("workspace sidebar", `Boolean(document.querySelector('[data-testid="new-chat-button"]'))`, 10_000);
assert.equal(await evaluate(`Boolean(document.querySelector('.sidebar-organize-button'))`), true, "Codex-style sidebar organize control is unavailable.");
await evaluate(`document.querySelector('.sidebar-organize-button')?.click()`);
await waitFor("sidebar organize menu", `Boolean(document.querySelector('.sidebar-organize-menu'))`, 5_000);
assert.equal(await evaluate(`(() => {
  const button = [...document.querySelectorAll('.sidebar-organize-menu button')].find((item) => item.textContent?.trim() === '单列表');
  button?.click();
  return Boolean(button);
})()`), true, "Single-list sidebar mode is unavailable.");
const unifiedSidebar = JSON.parse(await waitFor("unified task list", `(() => {
  const projectHeader = document.querySelector('.projects-section > .project-subsection-head:first-child');
  const rows = [...document.querySelectorAll('[data-testid="sidebar-task-row"]')];
  const keys = rows.map((row) => row.getAttribute('data-thread-key')).filter(Boolean);
  return rows.length > 0 ? JSON.stringify({
    projectHeaderDisplay: projectHeader ? getComputedStyle(projectHeader).display : '',
    rowCount: rows.length,
    uniqueCount: new Set(keys).size,
    hasProjectContext: rows.some((row) => Boolean(row.querySelector('.thread-title small')))
  }) : '';
})()`, 5_000));
assert.equal(unifiedSidebar.projectHeaderDisplay, "none", "Single-list mode still renders the project grouping section.");
assert.equal(unifiedSidebar.rowCount, unifiedSidebar.uniqueCount, "A task is duplicated in the unified sidebar list.");
assert.equal(unifiedSidebar.hasProjectContext, true, "Unified task rows do not identify their project context.");
await evaluate(`(() => {
  document.querySelector('.sidebar-organize-button')?.click();
  const button = [...document.querySelectorAll('.sidebar-organize-menu button')].find((item) => item.textContent?.trim() === '按项目');
  button?.click();
})()`);
await evaluate(`(() => {
  document.querySelector('.preview-expanded-header .side-panel-tab')?.click();
  const activeThread = document.querySelector('.thread-row.active') || document.querySelector('.thread-row');
  if (activeThread instanceof HTMLButtonElement) activeThread.click();
  return true;
})()`);
await waitFor("active task column", `Boolean(document.querySelector('.task-column:not(.new-chat-task)'))`, 10_000);
await evaluate(`(() => {
  if (!document.querySelector('.composer-add-menu')) {
    document.querySelector('[data-testid="composer-add-button"]')?.click();
  }
  return true;
})()`);
await new Promise((resolve) => setTimeout(resolve, 250));

const report = JSON.parse(await evaluate(`(() => {
  const rect = (element) => element?.getBoundingClientRect();
  const task = rect(document.querySelector('.task-column:not(.new-chat-task)'));
  const conversation = rect(document.querySelector('.conversation-history'));
  const composer = rect(document.querySelector('.composer-card'));
  const goalCard = rect(document.querySelector('.goal-runtime-panel, .goal-question-card'));
  const goalElement = document.querySelector('.goal-question-card');
  const goalAncestors = goalElement ? [...function* () { let current = goalElement.parentElement; while (current) { yield current; current = current.parentElement; } }()].slice(0, 8).map((element) => ({ className: element.className, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflowY: getComputedStyle(element).overflowY })) : [];
  const goalOptions = [...document.querySelectorAll('[data-testid^="goal-option-"]')].map((element) => ({
    text: element.textContent?.trim().slice(0, 80) || '',
    disabled: element.hasAttribute('disabled')
  }));
  const liveReasoning = document.querySelector('[data-testid="reasoning-summary-live"]')?.textContent?.trim() || '';
  const addMenu = document.querySelector('.composer-add-menu');
  const goalRuntimeInsideAddMenu = Boolean(addMenu?.querySelector('.goal-execution-summary, [data-testid="goal-runtime-panel"], [data-testid="goal-question-card"]'));
  const approvalDialog = document.querySelector('[data-testid="approval-dialog"]');
  const approvalBounds = rect(approvalDialog);
  const approvalBorderedAncestors = approvalDialog ? [...document.querySelectorAll('.composer-card, .approval-request-banner, .approval-command-preview')]
    .filter((element) => element === approvalDialog || element.contains(approvalDialog) || approvalDialog.contains(element))
    .filter((element) => {
      const style = getComputedStyle(element);
      return parseFloat(style.borderTopWidth || '0') > 0 && style.display !== 'none';
    }).length : 0;
  const requestBubbles = [...document.querySelectorAll('.request-bubble')].map((element) => {
    const bounds = rect(element);
    return {
      text: element.textContent?.trim().slice(0, 80) || '',
      left: bounds.left,
      right: bounds.right,
      width: bounds.width,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    };
  });
  return JSON.stringify({
    viewportWidth: innerWidth,
    task: task && { left: task.left, right: task.right, width: task.width },
    conversation: conversation && { left: conversation.left, right: conversation.right, width: conversation.width },
    composer: composer && { left: composer.left, right: composer.right, top: composer.top, width: composer.width },
    goalCard: goalCard && { left: goalCard.left, right: goalCard.right, bottom: goalCard.bottom },
    goalAncestors,
    goalOptions,
    liveReasoning,
    addMenuVisible: Boolean(addMenu),
    goalRuntimeInsideAddMenu,
    approvalDialog: approvalBounds && { width: approvalBounds.width, height: approvalBounds.height, borderedContainers: approvalBorderedAncestors },
    requestBubbles
  });
})()`));

console.log(JSON.stringify({ observed: true, ...report }, null, 2));

assert.ok(report.task, "The active task column is not visible.");
assert.ok(report.conversation, "The conversation history is not visible.");
assert.ok(report.composer, "The composer is not visible.");
assert.ok(
  report.conversation.width / report.task.width >= 0.72,
  `Conversation axis uses only ${Math.round(report.conversation.width / report.task.width * 100)}% of the task column.`
);
assert.ok(
  Math.abs(report.conversation.left - report.composer.left) <= 12 &&
    Math.abs(report.conversation.right - report.composer.right) <= 12,
  "Conversation and composer axes are not aligned."
);
for (const bubble of report.requestBubbles) {
  assert.ok(bubble.left >= report.conversation.left - 1, `User message overflows left: ${bubble.text}`);
  assert.ok(bubble.right <= report.conversation.right + 1, `User message overflows right: ${bubble.text}`);
  assert.ok(bubble.scrollWidth <= bubble.clientWidth + 1, `User message has clipped horizontal content: ${bubble.text}`);
}
if (report.goalCard) {
  assert.ok(report.goalCard.bottom <= report.composer.top, "Goal/question card overlaps the composer.");
  assert.ok(report.goalCard.left >= report.conversation.left - 1, "Goal/question card overflows left.");
  assert.ok(report.goalCard.right <= report.conversation.right + 1, "Goal/question card overflows right.");
}
for (const option of report.goalOptions) assert.equal(option.disabled, false, `Goal option is not selectable: ${option.text}`);
assert.equal(report.addMenuVisible, true, "Composer add menu did not open for the menu isolation check.");
assert.equal(report.goalRuntimeInsideAddMenu, false, "Goal runtime context is incorrectly rendered inside the add menu.");
if (report.approvalDialog) assert.equal(report.approvalDialog.borderedContainers, 1, "Approval UI renders as nested bordered cards instead of one dialog.");

assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="e2e-open-file-preview"]'))`), true, "The internal file-preview action is unavailable.");
await evaluate(`document.querySelector('[data-testid="e2e-open-file-preview"]')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 500));
const filePreview = JSON.parse(await waitFor("single internal file preview", `(() => {
  const previews = [...document.querySelectorAll('.search-file-preview')];
  const text = previews[0]?.innerText || '';
  return previews.length === 1 && text.includes('DEEPSEEK_FILE_FINAL_OK')
    ? JSON.stringify({ count: previews.length, text })
    : '';
})()`, 10_000));
assert.equal(filePreview.count, 1, "A local file click opened duplicate preview containers.");
assert.match(filePreview.text, /final-artifact\.txt/);
assert.match(filePreview.text, /DEEPSEEK_FILE_FINAL_OK/);

socket.close();
session.close();
console.log(JSON.stringify({ ok: true }, null, 2));
