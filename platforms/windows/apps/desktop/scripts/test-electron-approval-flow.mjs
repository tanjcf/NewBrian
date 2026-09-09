import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
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

let nextId = 0;
function evaluate(expression, timeoutMs = 10_000) {
  const id = ++nextId;
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true, awaitPromise: true }
  }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP evaluation ${id} timed out.`)), timeoutMs);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails?.exception?.description || payload.result.exceptionDetails?.text));
        return;
      }
      resolve(payload.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
  });
}

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
async function waitFor(label, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const e2eWorkspacePath = resolve(process.cwd(), "../../..");
const seeded = await evaluate(`(async () => {
  const workspacePath = ${JSON.stringify(e2eWorkspacePath)};
  let catalog = await window.newbrain.listWorkspaces();
  let workspace = catalog.find((item) => item.path === workspacePath);
  if (!workspace) {
    catalog = await window.newbrain.addWorkspace({ name: "NewBrain E2E", path: workspacePath });
    workspace = catalog.find((item) => item.path === workspacePath);
  }
  if (!workspace) throw new Error("Unable to seed the E2E workspace.");
  if (!workspace.threads?.length) {
    catalog = await window.newbrain.addWorkspaceThread({
      workspaceId: workspace.id,
      title: "Approval E2E",
      summary: "Self-contained Electron approval verification",
      scope: "project"
    });
    workspace = catalog.find((item) => item.id === workspace.id);
  }
  const thread = workspace?.threads?.[0];
  if (!thread) throw new Error("Unable to seed the E2E thread.");
  await window.newbrain.activateWorkspaceThread({ workspaceId: workspace.id, threadId: thread.id });
  return true;
})()`);
assert.equal(seeded, true);

await waitFor("approval test trigger", `Boolean(document.querySelector('[data-testid="e2e-request-shell-approval"]'))`, 20_000);
await evaluate(`(() => {
  document.querySelector('.preview-expanded-header .side-panel-tab')?.click();
  const activeThread = document.querySelector('.thread-row.active');
  if (activeThread instanceof HTMLButtonElement) activeThread.click();
  return true;
})()`);
await sleep(300);
const previousPreferences = await evaluate(`window.newbrain.getDesktopPreferences()`);
await evaluate(`(async () => {
  const preferences = await window.newbrain.getDesktopPreferences();
  await window.newbrain.saveDesktopPreferences({
    ...preferences,
    configuration: { ...preferences.configuration, requireApprovalForShell: true }
  });
  document.querySelector('[data-testid="e2e-request-shell-approval"]')?.click();
  return true;
})()`);

const approval = JSON.parse(await waitFor("single approval dialog", `(() => {
  const dialogs = [...document.querySelectorAll('[data-testid="approval-dialog"]')];
  if (dialogs.length !== 1) return '';
  const dialog = dialogs[0];
  const borderedContainers = [...document.querySelectorAll('.composer-card, .approval-request-banner')]
    .filter((element) => element === dialog || element.contains(dialog) || dialog.contains(element))
    .filter((element) => parseFloat(getComputedStyle(element).borderTopWidth || '0') > 0).length;
  return JSON.stringify({
    count: dialogs.length,
    borderedContainers,
    text: dialog.textContent || ''
  });
})()`));
assert.equal(approval.count, 1);
assert.equal(approval.borderedContainers, 1, "Approval controls are split across nested bordered containers.");
assert.match(approval.text, /批准并继续/);

await evaluate(`document.querySelector('[data-testid="approval-approve-button"]')?.click()`);
await waitFor("approval completion", `!document.querySelector('[data-testid="approval-dialog"]')`, 30_000);
const result = JSON.parse(await waitFor("approved command output", `(async () => {
  try {
    const snapshot = await window.newbrain.getSnapshot();
    const catalog = await window.newbrain.listWorkspaces();
    const workspace = catalog.find((item) => item.path === snapshot.session?.workspacePath);
    if (!workspace) return '';
    const file = await window.newbrain.readWorkspaceFile({ workspaceId: workspace.id, filePath: 'approval-e2e.txt' });
    return String(file?.content || '').includes('APPROVAL_E2E_OK')
      ? JSON.stringify({ content: file.content, workspacePath: snapshot.session.workspacePath })
      : '';
  } catch { return ''; }
})()`, 20_000));
assert.match(result.content, /APPROVAL_E2E_OK/);
await unlink(join(result.workspacePath, "approval-e2e.txt")).catch(() => {});

await evaluate(`window.newbrain.saveDesktopPreferences(${JSON.stringify(previousPreferences)})`);
socket.close();
session.close();
console.log(JSON.stringify({ ok: true, approvalContainers: approval.borderedContainers, commandExecuted: true }, null, 2));
