import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9888);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
function command(method, params = {}, timeoutMs = 30_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out.`)), timeoutMs);
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails?.exception?.description || payload.result.exceptionDetails?.text));
        return;
      }
      resolve(payload.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result?.result?.value;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(label, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(150);
  }
  const diagnostics = await evaluate(`JSON.stringify({ title: document.title, body: document.body?.innerText?.slice(-1200) || '' })`).catch(() => "");
  throw new Error(`Timed out waiting for ${label}. Diagnostics: ${diagnostics}. Process: ${JSON.stringify(session.readProcessOutput?.() || {})}`);
}

assert.ok(session.workspacePath, "Thread recovery E2E requires an isolated workspace.");
const missingWorkspacePath = join(session.workspacePath, "缺失任务 工作区");
const healthyWorkspacePath = join(session.workspacePath, "正常任务 工作区");
mkdirSync(missingWorkspacePath, { recursive: true });
mkdirSync(healthyWorkspacePath, { recursive: true });

await waitFor("renderer bootstrap", `Boolean(document.querySelector('[data-testid="new-chat-button"]'))`);
const fixture = JSON.parse(await evaluate(`(async () => {
  let catalog = await window.newbrain.listWorkspaces();
  const ensureWorkspace = async (name, path) => {
    if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name, path });
    return catalog.find((item) => item.path === path);
  };
  let missingWorkspace = await ensureWorkspace('缺失任务工作区', ${JSON.stringify(missingWorkspacePath)});
  let healthyWorkspace = await ensureWorkspace('正常任务工作区', ${JSON.stringify(healthyWorkspacePath)});
  if (!missingWorkspace.threads.some((item) => item.title === '即将缺失的任务')) {
    catalog = await window.newbrain.addWorkspaceThread({ workspaceId: missingWorkspace.id, title: '即将缺失的任务', summary: '故障注入', scope: 'chat' });
  }
  missingWorkspace = catalog.find((item) => item.path === ${JSON.stringify(missingWorkspacePath)});
  if (!healthyWorkspace.threads.some((item) => item.title === '正常备用任务')) {
    catalog = await window.newbrain.addWorkspaceThread({ workspaceId: healthyWorkspace.id, title: '正常备用任务', summary: '恢复校验', scope: 'chat' });
  }
  healthyWorkspace = catalog.find((item) => item.path === ${JSON.stringify(healthyWorkspacePath)});
  const missingThread = missingWorkspace.threads.find((item) => item.title === '即将缺失的任务');
  const healthyThread = healthyWorkspace.threads.find((item) => item.title === '正常备用任务');
  localStorage.setItem('newbrain.lastSelectedWorkspaceId.v1', healthyWorkspace.id);
  localStorage.setItem('newbrain.lastSelectedThreadId.v1', healthyThread.id);
  return JSON.stringify({ missingWorkspaceId: missingWorkspace.id, missingThreadId: missingThread.id, healthyWorkspaceId: healthyWorkspace.id, healthyThreadId: healthyThread.id });
})()`));

await command("Page.reload", { ignoreCache: true });
const missingThreadKey = `${fixture.missingWorkspaceId}:${fixture.missingThreadId}`;
const healthyThreadKey = `${fixture.healthyWorkspaceId}:${fixture.healthyThreadId}`;
await waitFor("stale target task row", `Boolean(document.querySelector('[data-testid="sidebar-task-row"][data-thread-key=${JSON.stringify(missingThreadKey)}]'))`);

// Fault injection only: delete the durable task without applying the returned catalog,
// leaving the visible row stale so the normal user click exercises renderer recovery.
await evaluate(`window.newbrain.deleteWorkspaceThread({ workspaceId: ${JSON.stringify(fixture.missingWorkspaceId)}, threadId: ${JSON.stringify(fixture.missingThreadId)} }).then(() => true)`);
const clicked = await evaluate(`(() => {
  const row = document.querySelector('[data-testid="sidebar-task-row"][data-thread-key=${JSON.stringify(missingThreadKey)}]');
  if (!(row instanceof HTMLButtonElement)) return false;
  row.click();
  return true;
})()`);
assert.equal(clicked, true, "The stale task row could not be clicked.");

const recovery = JSON.parse(await waitFor("graceful missing-thread recovery", `(() => {
  const body = document.body?.innerText || '';
  const composer = document.querySelector('[data-testid="composer-input"]');
  if (!body.includes('原任务已不存在') || !(composer instanceof HTMLTextAreaElement)) return '';
  return JSON.stringify({
    title: document.title,
    body,
    composerVisible: getComputedStyle(composer).display !== 'none',
    rendererFailed: body.includes('Renderer failed to start')
  });
})()`));
assert.equal(recovery.rendererFailed, false, "A missing task still crashed the renderer.");
assert.equal(recovery.composerVisible, true, "The composer was not restored after the missing task.");

const healthyClicked = await evaluate(`(() => {
  const row = document.querySelector('[data-testid="sidebar-task-row"][data-thread-key=${JSON.stringify(healthyThreadKey)}]');
  if (!(row instanceof HTMLButtonElement)) return false;
  row.click();
  return true;
})()`);
assert.equal(healthyClicked, true, "The healthy fallback task is no longer selectable.");
await waitFor("healthy task activation", `document.querySelector('.thread-row.active')?.getAttribute('data-thread-key') === ${JSON.stringify(healthyThreadKey)}`);

socket.close();
session.close();
console.log(JSON.stringify({ ok: true, caseId: "THREAD-001", recoveredToComposer: true, healthyTaskOpened: true }, null, 2));
