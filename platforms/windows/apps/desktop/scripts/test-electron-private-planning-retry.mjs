import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startPrivatePlanningRetryModelServer } from "./private-planning-retry-model-server.mjs";

const server = await startPrivatePlanningRetryModelServer();
process.env.NEWBRAIN_E2E_FORCE_FRESH = "1";
process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT = String(9650 + Math.floor(Math.random() * 200));
process.env.NEWBRAIN_MODEL_BASE_URL = server.baseUrl;
process.env.NEWBRAIN_E2E_MODEL_ID = "newbrain-retry-e2e";
const { ensureElectronE2ESession } = await import("./electron-e2e-session.mjs");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const session = await ensureElectronE2ESession(Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT));
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
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}
async function waitFor(label, expression, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}: ${await evaluate("document.body?.innerText?.slice(-1200) || ''")}`);
}

try {
  await waitFor("workspace", `Boolean(document.querySelector('[data-testid="composer-input"]'))`, 120_000);
  const submitted = await evaluate(`(() => {
    const input = document.querySelector('[data-testid="composer-input"]');
    if (!(input instanceof HTMLTextAreaElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '你叫什么名字');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  assert.equal(submitted, true);
  await waitFor("enabled send", `!document.querySelector('[data-testid="composer-send-button"]')?.hasAttribute('disabled')`);
  await evaluate(`document.querySelector('[data-testid="composer-send-button"]')?.click()`);
  await waitFor("visible retried answer", `([...document.querySelectorAll('.assistant-block')].at(-1)?.innerText || '').includes('我是 NewBrain')`, 120_000);
  assert.equal(server.getResponseCount(), 2, "The desktop runtime must retry exactly once.");

  const visibleText = await evaluate(`([...document.querySelectorAll('.assistant-block')].at(-1)?.innerText || '').trim()`);
  assert.match(visibleText, /我是 NewBrain/);
  assert.doesNotMatch(visibleText, /The user asks my name/);
  const governmentLink = JSON.parse(await evaluate(`(() => {
    const link = [...document.querySelectorAll('.assistant-block a')].find((item) => item.textContent?.includes('www.gov.cn'));
    return JSON.stringify({
      found: Boolean(link),
      href: link?.getAttribute('href') || '',
      localFilePath: link?.getAttribute('data-local-file-path') || ''
    });
  })()`));
  assert.deepEqual(governmentLink, { found: true, href: "https://www.gov.cn/", localFilePath: "" });
  socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } }));
  await sleep(1_500);
  await waitFor("persisted answer after reload", `([...document.querySelectorAll('.assistant-block')].at(-1)?.innerText || '').includes('我是 NewBrain')`);

  const stateRoot = join(session.workspacePath, ".newbrain");
  const rolloutPath = readdirSync(stateRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".rollout.jsonl"))
    .map((entry) => join(entry.parentPath, entry.name))
    .find((path) => readFileSync(path, "utf8").includes("我是 NewBrain"));
  assert.ok(rolloutPath, "The visible answer must be persisted in the canonical rollout.");
  const durableDump = readFileSync(rolloutPath, "utf8");
  assert.doesNotMatch(durableDump, /\"role\":\"assistant\"[^\n]*\"content\":\"\"/);
  console.log(JSON.stringify({ ok: true, modelResponses: server.getResponseCount(), visibleText, governmentLink, persistedAfterReload: true, rolloutPath }, null, 2));
} finally {
  socket.close();
  session.close({ preserveWorkspace: true });
  await server.close();
}
