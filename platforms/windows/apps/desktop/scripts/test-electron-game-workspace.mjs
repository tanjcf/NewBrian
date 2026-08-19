import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const session = await ensureElectronE2ESession(Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9333));
const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 0;
function command(method, params = {}, timeoutMs = 15_000) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      else resolve(payload.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
async function waitFor(expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const diagnostics = await evaluate(`JSON.stringify({ text: document.body?.innerText?.slice(0, 1200), selection: localStorage.getItem('brain.workspaceSelection.v2') })`).catch(() => "");
  throw new Error(`Timed out waiting for ${expression}: ${diagnostics}`);
}

const gameRoot = await mkdtemp(join(tmpdir(), "brain-game-ui-"));
await mkdir(join(gameRoot, "src", "scenes"), { recursive: true });
await writeFile(join(gameRoot, "package.json"), JSON.stringify({ name: "BRAIN 试玩验证", scripts: { dev: "node server.cjs" } }), "utf8");
await writeFile(join(gameRoot, "server.cjs"), "require('node:http').createServer((_request, response) => response.end('BRAIN_GAME_READY')).listen(5173, '127.0.0.1');", "utf8");
await writeFile(join(gameRoot, "src", "main.ts"), "export {};", "utf8");
await writeFile(join(gameRoot, "src", "scenes", "main.json"), "{}", "utf8");

const seeded = await evaluate(`(async () => {
  const path = ${JSON.stringify(gameRoot)};
  let catalog = await window.codecn.listWorkspaces();
  if (!catalog.some((item) => item.path === path)) catalog = await window.codecn.addWorkspace({ name: "BRAIN Game E2E", path });
  const local = catalog.find((item) => item.path === path);
  if (!local) return false;
  let projects = await window.codecn.listBrainProjects({ workspaceKey: "game" });
  let project = projects.find((item) => item.name === "BRAIN Game E2E");
  if (!project) project = await window.codecn.createBrainProject({ name: "BRAIN Game E2E", primaryWorkspaceKey: "game", localWorkspaceId: local.id });
  else project = await window.codecn.updateBrainProject({ projectId: project.id, localWorkspaceId: local.id });
  let conversations = await window.codecn.listBrainConversations({ projectId: project.id, workspaceKey: "game" });
  let conversation = conversations[0];
  if (!conversation) conversation = await window.codecn.createBrainConversation({ projectId: project.id, workspaceKey: "game", title: "试玩验证" });
  localStorage.setItem("brain.workspaceSelection.v2", JSON.stringify({ version: 2, selectedWorkspaceKey: "game", catalogs: { game: { projectId: project.id, conversationId: conversation.id } } }));
  location.reload();
  return true;
})()`);
assert.equal(seeded, true);
await waitFor(`Boolean([...document.querySelectorAll('.brain-conversation-list button')].find((button) => button.textContent?.includes('试玩验证')))`);
await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-conversation-list button')].find((item) => item.textContent?.includes('试玩验证')); button?.click(); return Boolean(button); })()`);
await waitFor(`document.querySelector('.brain-game-plugin')?.textContent?.includes('BRAIN 试玩验证')`);
const approvalKeys = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Milliseconds 800; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{LEFT}{ENTER}')"], { windowsHide: true });
await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-game-preview button')].find((item) => item.textContent?.trim() === '启动试玩'); button?.click(); return Boolean(button); })()`);
await new Promise((resolve, reject) => {
  approvalKeys.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Approval key helper exited ${code}`)));
  approvalKeys.once("error", reject);
});
await waitFor(`document.querySelector('.brain-game-preview')?.textContent?.includes('可以试玩')`, 20_000);
await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-game-preview button')].find((item) => item.textContent?.trim() === '打开试玩'); button?.click(); return Boolean(button); })()`);
await new Promise((resolve) => setTimeout(resolve, 800));
await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-game-preview button')].find((item) => item.textContent?.trim() === '保存试玩截图'); button?.click(); return Boolean(button); })()`);
await waitFor(`document.querySelector('.brain-game-preview')?.textContent?.includes('试玩证据已保存')`, 10_000);
const observation = await evaluate(`(() => {
  const panel = document.querySelector('.brain-game-plugin');
  const text = panel?.textContent || '';
  return {
    visible: Boolean(panel && panel.getBoundingClientRect().width > 300),
    hasStart: text.includes('启动试玩'),
    hasCommand: text.includes('npm run dev'),
    hasAssets: text.includes('项目资产'),
    ready: text.includes('可以试玩'),
    hasEvidence: text.includes('试玩证据已保存'),
    bodyHasError: document.body.innerText.includes('A JavaScript error occurred in the main process')
  };
})()`);
assert.deepEqual(observation, { visible: true, hasStart: false, hasCommand: true, hasAssets: true, ready: true, hasEvidence: true, bodyHasError: false });
const screenshot = await command("Page.captureScreenshot", { format: "png" });
const screenshotPath = join(tmpdir(), "brain-game-preview-workspace.png");
await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
await evaluate(`(() => { const button = [...document.querySelectorAll('.brain-game-preview button')].find((item) => item.textContent?.trim() === '停止试玩'); button?.click(); return Boolean(button); })()`);
await waitFor(`document.querySelector('.brain-game-preview')?.textContent?.includes('已停止')`, 10_000);
console.log(JSON.stringify({ ok: true, screenshotPath, observation }, null, 2));
socket.close();
await session.close();
