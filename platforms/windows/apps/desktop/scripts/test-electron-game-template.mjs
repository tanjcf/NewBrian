import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9348);
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
      if (payload.error || payload.result?.exceptionDetails) reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      else resolve(payload.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
async function waitFor(expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 200)); }
  throw new Error(`Timed out waiting for ${expression}`);
}

const root = await mkdtemp(join(tmpdir(), "brain-game-template-ui-"));
await mkdir(join(root, "public"), { recursive: true });

const seeded = await evaluate(`(async () => {
  const path = ${JSON.stringify(root)};
  let catalog = await window.newbrain.listWorkspaces();
  if (!catalog.some((item) => item.path === path)) catalog = await window.newbrain.addWorkspace({ name: "BRAIN Game Template E2E", path, brainWorkspaceKey: "game" });
  const local = catalog.find((item) => item.path === path);
  if (!local) return { ok: false, reason: "workspace-missing" };
  let projects = await window.newbrain.listBrainProjects({ workspaceKey: "game" });
  let project = projects.find((item) => item.name === "BRAIN Game Template E2E");
  if (!project) project = await window.newbrain.createBrainProject({ name: "BRAIN Game Template E2E", primaryWorkspaceKey: "game", localWorkspaceId: local.id });
  else project = await window.newbrain.updateBrainProject({ projectId: project.id, localWorkspaceId: local.id });
  let conversations = await window.newbrain.listBrainConversations({ projectId: project.id, workspaceKey: "game" });
  let conversation = conversations[0];
  if (!conversation) conversation = await window.newbrain.createBrainConversation({ projectId: project.id, workspaceKey: "game", title: "模板验收" });
  localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({ version: 2, selectedWorkspaceKey: "game", catalogs: { game: { projectId: project.id, conversationId: conversation.id } } }));
  return { ok: true, projectId: project.id };
})()`);
assert.equal(seeded?.ok, true, JSON.stringify(seeded));

const created = await evaluate(`(async () => {
  const result = await window.newbrain.createBrainGameWebTemplate({ projectId: ${JSON.stringify(seeded.projectId)} });
  const inspection = await window.newbrain.inspectBrainGameProject({ projectId: ${JSON.stringify(seeded.projectId)} });
  return { result, engine: inspection.engine, preview: inspection.preview.supported };
})()`);
assert.equal(created.engine, "web");
assert.equal(created.preview, true);

console.log(JSON.stringify({ ok: true, caseId: "BRAIN-GAME-TEMPLATE-E2E", created, fixtureRoot: root }, null, 2));
socket.close(); await session.close();
