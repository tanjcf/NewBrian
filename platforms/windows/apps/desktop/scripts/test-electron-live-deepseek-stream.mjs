import assert from "node:assert/strict";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9444);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
function evaluate(expression, timeoutMs = 30_000) {
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
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: {
      expression, returnByValue: true, awaitPromise: true
    } }));
  });
}
async function waitFor(label, expression, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(200);
  }
  const diagnostic = await evaluate(`JSON.stringify({ text: document.body?.innerText?.slice(-1000) || '' })`).catch(() => "");
  throw new Error(`Timed out waiting for ${label}: ${diagnostic}`);
}

await waitFor("authenticated workspace", `Boolean(document.querySelector('[data-testid="new-chat-button"]'))`, 120_000);
const threadTitle = `Live DeepSeek Stream ${Date.now()}`;
const prepared = await evaluate(`(async () => {
  const path = ${JSON.stringify("G:\\workrpase\\NewBrain")};
  let catalog = await window.newbrain.listWorkspaces();
  if (!catalog.some((item) => item.path === path)) {
    catalog = await window.newbrain.addWorkspace({ name: "NewBrain", path });
  }
  const workspace = catalog.find((item) => item.path === path);
  if (!workspace) return false;
  await window.newbrain.addWorkspaceThread({
    workspaceId: workspace.id,
    title: ${JSON.stringify(threadTitle)},
    summary: "Authorized real DeepSeek streaming verification",
    scope: "project"
  });
  return true;
})()`);
assert.equal(prepared, true, "Could not prepare the existing NewBrain project.");
socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } }));
await sleep(1_500);
await waitFor("prepared live task", `Boolean([...document.querySelectorAll('[data-testid="sidebar-task-row"], .thread-row')].find((item) => item.textContent?.includes(${JSON.stringify(threadTitle)})))`, 30_000);
await evaluate(`([...document.querySelectorAll('[data-testid="sidebar-task-row"], .thread-row')].find((item) => item.textContent?.includes(${JSON.stringify(threadTitle)})))?.click()`);
await waitFor("composer", `Boolean(document.querySelector('[data-testid="composer-input"]'))`, 30_000);
await waitFor("selected prepared task", `([...document.querySelectorAll('[data-testid="sidebar-task-row"], .thread-row')].find((item) => item.textContent?.includes(${JSON.stringify(threadTitle)})))?.classList.contains('active')`, 30_000);
const prompt = "请只回答：流式验证通过。不要调用任何工具。";
const filled = await evaluate(`(() => {
  const input = document.querySelector('[data-testid="composer-input"]');
  if (!(input instanceof HTMLTextAreaElement)) return false;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(prompt)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  window.__liveStream = {
    submittedAt: 0, firstAt: 0, samples: [], lengths: [],
    baselineAssistantCount: document.querySelectorAll('.assistant-block').length
  };
  window.__liveObserver?.disconnect?.();
  window.__liveObserver = new MutationObserver(() => {
    const blocks = [...document.querySelectorAll('.assistant-block')];
    if (blocks.length <= window.__liveStream.baselineAssistantCount) return;
    const text = blocks.at(-1)?.innerText?.trim() || '';
    if (!text) return;
    if (!window.__liveStream.firstAt) window.__liveStream.firstAt = performance.now();
    const last = window.__liveStream.samples.at(-1);
    if (text !== last) {
      window.__liveStream.samples.push(text);
      window.__liveStream.lengths.push(text.length);
    }
  });
  window.__liveObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  return true;
})()`);
assert.equal(filled, true);
await waitFor("enabled send", `!document.querySelector('[data-testid="composer-send-button"]')?.hasAttribute('disabled')`, 120_000);
await evaluate(`(() => {
  window.__liveStream.submittedAt = performance.now();
  document.querySelector('[data-testid="composer-send-button"]')?.click();
})()`);
await waitFor("visible submitted prompt", `([...document.querySelectorAll('.request-bubble')].at(-1)?.innerText || '').includes('流式验证')`, 30_000);
await waitFor("first assistant text", `window.__liveStream?.firstAt > 0`, 120_000);
await waitFor("completed model turn", `(() => {
  const send = document.querySelector('[data-testid="composer-send-button"]');
  const blocks = [...document.querySelectorAll('.assistant-block')];
  const text = blocks.length > window.__liveStream.baselineAssistantCount ? blocks.at(-1)?.innerText?.trim() || '' : '';
  return text && send && !send.hasAttribute('disabled') ? text : '';
})()`, 180_000);
const beforeReload = JSON.parse(await evaluate(`JSON.stringify({
  timing: window.__liveStream,
  finalText: [...document.querySelectorAll('.assistant-block')].at(-1)?.innerText?.trim() || '',
  reasoningVisible: Boolean(document.querySelector('[data-testid="reasoning-summary-live"], [data-testid="reasoning-summary"]')),
  userPromptVisible: [...document.querySelectorAll('.request-bubble')].some((item) => item.innerText.includes('流式验证'))
})`));
assert.equal(beforeReload.userPromptVisible, true);
assert.match(beforeReload.finalText, /流式验证通过/);
assert.ok(beforeReload.timing.firstAt >= beforeReload.timing.submittedAt);
assert.ok(beforeReload.timing.samples.length >= 1);

socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } }));
await sleep(1_500);
await waitFor("persisted answer after reload", `([...document.querySelectorAll('.assistant-block')].at(-1)?.innerText || '').includes('流式验证通过')`, 60_000);
const afterReload = JSON.parse(await evaluate(`JSON.stringify({
  finalText: [...document.querySelectorAll('.assistant-block')].at(-1)?.innerText?.trim() || '',
  userPromptVisible: [...document.querySelectorAll('.request-bubble')].some((item) => item.innerText.includes('流式验证'))
})`));
assert.equal(afterReload.userPromptVisible, true);
assert.match(afterReload.finalText, /流式验证通过/);
console.log(JSON.stringify({
  ok: true,
  provider: "DeepSeek",
  model: "deepseek-v4-pro",
  prompt,
  firstVisibleMs: Math.round(beforeReload.timing.firstAt - beforeReload.timing.submittedAt),
  distinctVisibleSamples: beforeReload.timing.samples.length,
  visibleLengths: beforeReload.timing.lengths,
  reasoningVisible: beforeReload.reasoningVisible,
  finalText: beforeReload.finalText,
  persistedAfterReload: afterReload.finalText === beforeReload.finalText,
  observedAt: new Date().toISOString()
}, null, 2));
socket.close();
session.close({ preserveWorkspace: true });
