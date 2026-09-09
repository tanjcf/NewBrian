import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9342);
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
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result?.exceptionDetails?.exception?.description || payload.result.exceptionDetails.text));
      } else resolve(payload.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
async function waitFor(expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${expression}: ${await evaluate("document.body?.innerText?.slice(0, 1200)")}`);
}

const root = await mkdtemp(join(tmpdir(), "brain-game-level-"));
await mkdir(join(root, "Content", "Levels"), { recursive: true });
await writeFile(join(root, "package.json"), JSON.stringify({ name: "brain-e2e-game-level", private: true }, null, 2));

const seeded = await evaluate(`(async () => {
  const path = ${JSON.stringify(root)};
  let catalog = await window.newbrain.listWorkspaces();
  if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name: "BRAIN Level Editor E2E", path });
  const local = catalog.find((item) => item.path === path);
  if (!local) return { ok: false, reason: "workspace-missing" };
  let projects = await window.newbrain.listBrainProjects({ workspaceKey: "game" });
  let project = projects.find((item) => item.name === "BRAIN Level Editor E2E");
  if (!project) project = await window.newbrain.createBrainProject({ name: "BRAIN Level Editor E2E", primaryWorkspaceKey: "game", localWorkspaceId: local.id });
  else project = await window.newbrain.updateBrainProject({ projectId: project.id, localWorkspaceId: local.id });
  let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey: "game" });
  let conversation = conversations[0];
  if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey: "game", title: "关卡编辑验收" });
  localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({ version: 2, selectedWorkspaceKey: "game", catalogs: { game: { projectId: project.id, conversationId: conversation.id } } }));
  return { ok: true, projectId: project.id, conversationId: conversation.id, workspaceId: local.id };
})()`);
assert.equal(seeded?.ok, true, JSON.stringify(seeded));
await command("Page.reload", { ignoreCache: true });
await waitFor("Boolean(document.querySelector('[data-testid=brain-game-level-editor]')) || Boolean(document.body?.innerText?.includes('关卡列表'))", 30_000);
await waitFor(`Boolean([...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '关卡'))`);
await evaluate(`(() => { [...document.querySelectorAll('.brain-resource-scene-nav button')].find((item) => item.textContent?.trim() === '关卡')?.click(); return true; })()`);
await waitFor("Boolean(document.querySelector('[data-testid=brain-game-level-editor]'))");
await waitFor("Boolean(document.querySelector('[data-testid=brain-game-level-empty]')) || document.body.innerText.includes('尚无关卡')");
assert.equal(await evaluate("!document.body.innerText.includes('山门解谜')"), true, "must not show demo levels");

await waitFor("document.querySelector('button.level-add')?.disabled === false", 15_000);
const addRect = await evaluate("(() => { const button = [...document.querySelectorAll('button.level-add')].find((item) => item.offsetWidth > 0 && item.offsetHeight > 0 && !item.disabled); if (!button) return null; const rect = button.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()");
assert.ok(addRect, "visible enabled level add button was not found");
await command("Input.dispatchMouseEvent", { type: "mousePressed", x: addRect.x, y: addRect.y, button: "left", clickCount: 1 });
await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: addRect.x, y: addRect.y, button: "left", clickCount: 1 });
await waitFor("document.body.innerText.includes('LVL_New_1') || document.body.innerText.includes('新关卡')", 15_000);

await evaluate("[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('保存关卡状态'))?.click()");
await waitFor("document.body.innerText.includes('已保存 · sha256') || document.querySelector('.brain-level-toolbar .proj')?.textContent?.includes('已落盘')", 45_000);

await evaluate("[...document.querySelectorAll('button')].find((item) => item.textContent?.includes('✦ 敌人'))?.click()");
await waitFor("document.querySelector('.brain-level-toolbar .proj')?.textContent?.includes('已落盘') || document.body.innerText.includes('已写入工程')", 45_000);

const observation = await evaluate(`(async () => {
  const projectId = ${JSON.stringify(seeded.projectId)};
  const loaded = await window.newbrain.getBrainGameLevelEditor({ projectId });
  return {
    editorVisible: Boolean(document.querySelector('[data-testid=brain-game-level-editor]')),
    persisted: Boolean(loaded?.persisted),
    actorCount: Array.isArray(loaded?.state?.levels?.[0]?.actors) ? loaded.state.levels[0].actors.length : 0,
    status: document.querySelector('.brain-level-toolbar')?.nextElementSibling?.textContent || document.body.innerText.slice(0, 400),
    error: document.body.innerText.includes('A JavaScript error occurred in the main process')
  };
})()`);

assert.equal(observation.error, false, JSON.stringify(observation));
assert.equal(observation.editorVisible, true, JSON.stringify(observation));
assert.equal(observation.persisted, true, JSON.stringify(observation));
assert.ok(observation.actorCount >= 1, JSON.stringify(observation));

await access(join(root, ".brain-game", "level-editor.json"));

console.log(JSON.stringify({
  ok: true,
  caseId: "BRAIN-GAME-LEVEL-EDITOR-E2E",
  observation,
  fixtureRoot: root
}, null, 2));

socket.close();
await session.close();
