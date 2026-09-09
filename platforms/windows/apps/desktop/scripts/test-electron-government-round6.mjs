import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "..", "..", "tmp", "e2e-evidence", "GOV-UI-MULTI-001");
const evidenceDirectory = resolve(root, "round-6"); mkdirSync(evidenceDirectory, { recursive: true });
const manifestPath = resolve(evidenceDirectory, "pre-restart.json");
const readRound = (round) => JSON.parse(readFileSync(resolve(root, `round-${round}`, `round-${round}.json`), "utf8"));
const hashFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

if (process.argv.includes("--prepare")) {
  const round1 = readRound(1); const round2 = readRound(2); const round3 = readRound(3); const round4 = readRound(4); const round5 = readRound(5);
  const paths = [round5.artifacts.firstPdf.path, round5.artifacts.secondPdf.path, round5.artifacts.secondDocx.path];
  const manifest = {
    targetThreadId: round5.state.goal.goal.threadId,
    expectedUsers: [
      round1.userMessages.at(-1),
      round2.state.messages.filter((message) => message.role === "user").at(-1)?.content,
      round3.confirmed,
      round4.request,
      round5.request
    ],
    files: paths.map((path) => ({ path, hash: hashFile(path), mtimeMs: statSync(path).mtimeMs, size: statSync(path).size }))
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PREPARED", manifestPath, targetThreadId: manifest.targetThreadId }, null, 2));
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const port = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9555);
let page = null;
for (let attempt = 0; attempt < 45 && !page; attempt += 1) {
  try { page = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())).find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl); } catch {}
  if (!page) await new Promise((ok) => setTimeout(ok, 1_000));
}
assert.ok(page, "No visible NewBrain renderer became available after restart.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { socket.addEventListener("open", ok, { once: true }); socket.addEventListener("error", fail, { once: true }); });
let nextId = 0;
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((ok, fail) => {
    const timeout = setTimeout(() => fail(new Error(`${method} timed out.`)), 30_000);
    const onMessage = (event) => { const payload = JSON.parse(event.data); if (payload.id !== id) return; clearTimeout(timeout); socket.removeEventListener("message", onMessage); if (payload.error || payload.result?.exceptionDetails) return fail(new Error(payload.error?.message || payload.result.exceptionDetails.text)); ok(payload.result); };
    socket.addEventListener("message", onMessage); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) { return (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value; }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let activated = false;
for (let attempt = 0; attempt < 45 && !activated; attempt += 1) {
  activated = await evaluate(`(() => { const expand = [...document.querySelectorAll('button.thread-row.muted')].find((e) => /展开显示/u.test(e.textContent || '')); if (expand instanceof HTMLButtonElement) expand.click(); const row = [...document.querySelectorAll('[data-testid="sidebar-project-task-row"]')].find((e) => e.getAttribute('data-thread-key')?.includes(${JSON.stringify(manifest.targetThreadId)})); if (!(row instanceof HTMLButtonElement)) return false; row.click(); return true; })()`);
  if (!activated) await sleep(1_000);
}
assert.equal(activated, true, "Workspace thread was not found after restart."); await sleep(2_000);
let state = null;
for (let attempt = 0; attempt < 45; attempt += 1) {
  state = await evaluate(`(async () => ({ messages: (await window.newbrain.getSnapshot()).messages || [], goal: await window.newbrain.getGoalExecution(), localFiles: [...document.querySelectorAll('[data-local-file-path]')].map((e) => decodeURIComponent(e.getAttribute('data-local-file-path') || '')), body: document.body.innerText, reasoningCount: [...document.querySelectorAll('[data-testid*="reasoning"], .reasoning-summary')].length, activityCount: [...document.querySelectorAll('[data-testid*="activity"], [data-testid*="step"], [data-testid*="tool"]')].length, composerDisabled: document.querySelector('[data-testid="composer-input"]')?.hasAttribute('disabled') ?? true }))()`);
  if (state.messages.filter((message) => message.role === "user").length >= manifest.expectedUsers.length && state.body.includes("本轮使用 Skill：政务写作")) break;
  await sleep(1_000);
}
const users = state.messages.filter((message) => message.role === "user").map((message) => message.content);
const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(resolve(evidenceDirectory, "round-6.png"), Buffer.from(screenshot.data, "base64"));
writeFileSync(resolve(evidenceDirectory, "round-6.json"), `${JSON.stringify({ status: "CAPTURED_BEFORE_ASSERTIONS", manifest, state }, null, 2)}\n`);
assert.deepEqual(users, manifest.expectedUsers, "The recovered thread does not contain exactly the five expected user turns in order.");
assert.equal(state.goal?.goal?.threadId, manifest.targetThreadId); assert.equal(state.goal?.goal?.status, "complete");
assert.equal(state.composerDisabled, false, "Composer did not recover after restart.");
assert.match(state.body, /政务写作/u, "Government-writing Skill record is not visible after recovery.");
assert.doesNotMatch(state.body, /Workspace thread was not found|Renderer failed to start/u);
for (const file of manifest.files) {
  assert.ok(existsSync(file.path)); assert.equal(hashFile(file.path), file.hash, `${file.path} changed after restart.`); assert.equal(statSync(file.path).mtimeMs, file.mtimeMs, `${file.path} was regenerated after restart.`);
  assert.ok(state.localFiles.some((shown) => file.path.endsWith(shown) || shown.endsWith(file.path.split(/[\\/]/).at(-1))), `${file.path} has no recovered UI link.`);
}
const clicks = await evaluate(`(() => { const names = ${JSON.stringify(manifest.files.map((file) => file.path.split(/[\/\\]/).at(-1)))}; return names.map((name) => { const element = [...document.querySelectorAll('[data-local-file-path]')].find((e) => decodeURIComponent(e.getAttribute('data-local-file-path') || '').endsWith(name)); if (!(element instanceof HTMLElement)) return false; element.click(); return true; }); })()`);
assert.deepEqual(clicks, [true, true, true], "Not all three recovered artifact links were clickable."); await sleep(1_000);
state = await evaluate(`(async () => ({ body: document.body.innerText, goal: await window.newbrain.getGoalExecution(), messages: (await window.newbrain.getSnapshot()).messages || [] }))()`);
assert.doesNotMatch(state.body, /Workspace thread was not found|Renderer failed to start/u);
writeFileSync(resolve(evidenceDirectory, "round-6.json"), `${JSON.stringify({ status: "PASS", manifest, state, clicks }, null, 2)}\n`);
console.log(JSON.stringify({ caseId: "GOV-UI-MULTI-001", round: 6, status: "PASS", evidenceDirectory, files: manifest.files }, null, 2));
socket.close();
