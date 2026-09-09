import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9341);
const session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
function command(method, params = {}, timeoutMs = 30_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const listener = (event) => { const payload = JSON.parse(event.data); if (payload.id !== id) return; clearTimeout(timer); socket.removeEventListener("message", listener); if (payload.error || payload.result?.exceptionDetails) reject(new Error(payload.error?.message || payload.result?.exceptionDetails?.exception?.description || payload.result.exceptionDetails.text)); else resolve(payload.result); };
    socket.addEventListener("message", listener); socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
async function waitFor(expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 200)); }
  throw new Error(`Timed out waiting for ${expression}: ${await evaluate("document.body?.innerText?.slice(0, 1200)")}`);
}

const root = await mkdtemp(join(tmpdir(), "brain-game-ui-"));
await mkdir(join(root, "public"));
await writeFile(join(root, "package.json"), JSON.stringify({ name: "brain-e2e-game", scripts: { start: "node server.mjs" } }, null, 2));
await writeFile(join(root, "server.mjs"), `import { createServer } from "node:http"; createServer((_, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end("<!doctype html><title>BRAIN Game E2E</title><main data-testid=game-page>BRAIN 游戏试玩</main>"); }).listen(5173, "127.0.0.1");`);

const seeded = await evaluate(`(async () => {
  const path = ${JSON.stringify(root)};
  let catalog = await window.newbrain.listWorkspaces();
  if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name: "BRAIN Game E2E", path });
  const local = catalog.find((item) => item.path === path);
  if (!local) return { ok: false, reason: "workspace-missing" };
  let projects = await window.newbrain.listBrainProjects({ workspaceKey: "game" });
  let project = projects.find((item) => item.name === "BRAIN Game E2E");
  if (!project) project = await window.newbrain.createBrainProject({ name: "BRAIN Game E2E", primaryWorkspaceKey: "game", localWorkspaceId: local.id });
  else project = await window.newbrain.updateBrainProject({ projectId: project.id, localWorkspaceId: local.id });
  let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey: "game" });
  let conversation = conversations[0];
  if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey: "game", title: "游戏试玩验收" });
  localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({ version: 2, selectedWorkspaceKey: "game", catalogs: { game: { projectId: project.id, conversationId: conversation.id } } }));
  return { ok: true, projectId: project.id, conversationId: conversation.id };
})()`);
assert.equal(seeded?.ok, true, JSON.stringify(seeded));
await command("Page.reload", { ignoreCache: true });
await waitFor("Boolean(document.querySelector('.brain-conversation-list'))");
await waitFor(`Boolean([...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('游戏试玩验收')))`, 30_000);
await evaluate(`(() => { [...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('游戏试玩验收'))?.click(); return true; })()`);
await waitFor(`Boolean([...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '项目与文件'))`);
await evaluate(`(() => { [...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '项目与文件')?.click(); return true; })()`);
await waitFor("Boolean(document.querySelector('[data-testid=brain-game-workspace]'))");
await waitFor("document.querySelector('[data-testid=brain-game-engine]')?.textContent?.includes('Web 游戏')");
await waitFor("document.querySelector('[data-testid=brain-game-preview]')?.textContent?.includes('npm run start')");
await evaluate("[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('启动试玩'))?.click()");
await waitFor("document.querySelector('[data-testid=brain-game-preview-status]')?.textContent?.includes('可以试玩')", 45_000);
await evaluate("[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('打开试玩'))?.click()");
await new Promise((resolve) => setTimeout(resolve, 500));
await evaluate("[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('保存试玩截图'))?.click()");
await waitFor("Boolean(document.querySelector('[data-testid=brain-game-evidence]'))");
await evaluate("[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('停止试玩'))?.click()");
await waitFor("document.querySelector('[data-testid=brain-game-preview-status]')?.textContent?.includes('已停止') || document.querySelector('[data-testid=brain-game-preview-status]')?.textContent?.includes('已结束')", 30_000);
const observation = await evaluate(`(() => ({ engine: document.querySelector('[data-testid=brain-game-engine]')?.textContent || '', status: document.querySelector('[data-testid=brain-game-preview-status]')?.textContent || '', evidence: Boolean(document.querySelector('[data-testid=brain-game-evidence]')), error: document.body.innerText.includes('A JavaScript error occurred in the main process') }))()`);
assert.equal(observation.error, false, JSON.stringify(observation));
assert.match(observation.engine, /Web 游戏/); assert.equal(observation.evidence, true, JSON.stringify(observation));
console.log(JSON.stringify({ ok: true, caseId: "BRAIN-GAME-WORKSPACE-E2E", observation, fixtureRoot: root }, null, 2));
socket.close(); await session.close();
