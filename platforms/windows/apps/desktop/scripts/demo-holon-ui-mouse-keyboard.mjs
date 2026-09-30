import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9350);
const evidenceDir = join(process.cwd(), "..", "..", "integration-artifacts", "holon-ui-demo", String(Date.now()));
mkdirSync(evidenceDir, { recursive: true });
const modelPort = 22_000 + (process.pid % 5_000);
const modelServer = spawn(process.execPath, [new URL("./holon-contract-model-server.mjs", import.meta.url).pathname.slice(1)], { env: { ...process.env, NEWBRAIN_HOLON_TEST_PORT: String(modelPort), NEWBRAIN_HOLON_GAME_MODE: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Holon model server did not start")), 10_000);
  modelServer.stdout.on("data", (chunk) => { if (String(chunk).includes("READY")) { clearTimeout(timer); resolve(); } });
  modelServer.once("exit", (code) => reject(new Error(`Holon model server exited: ${code}`)));
});
process.env.NEWBRAIN_MODEL_BASE_URL = `http://127.0.0.1:${modelPort}/v1`;
process.env.NEWBRAIN_E2E_MODEL_ID = "newbrain-e2e-model";
process.env.NEWBRAIN_E2E_AUTH_BYPASS = "1";
let session = await ensureElectronE2ESession(debugPort);
const page = session.pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
assert.ok(page, "No visible Electron renderer page found.");
let socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20_000);
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timer); socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) reject(new Error(payload.error?.message || payload.result.exceptionDetails.text));
      else resolve(payload.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return result?.result?.value;
}
async function screenshot(name) {
  const result = await command("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(evidenceDir, `${name}.png`), Buffer.from(result.data, "base64"));
}
async function clickText(text) {
  const box = await evaluate(`(() => { const node = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().includes(${JSON.stringify(text)})); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  assert.ok(box, `Visible button not found: ${text}`);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: box.x, y: box.y });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: box.x, y: box.y });
}
async function typeText(selector, value) {
  const box = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 }; })()`);
  assert.ok(box, `Visible input not found: ${selector}`);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: box.x, y: box.y });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: box.x, y: box.y });
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", modifiers: 2 });
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft" });
  await command("Input.insertText", { text: value });
}
async function waitFor(expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 200)); }
  throw new Error(`Timed out: ${expression}`);
}
function powershell(script) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || `PowerShell exited ${result.status}`);
  return result.stdout.trim();
}
function sendKeys(windowTitle, keys) {
  powershell(`Add-Type -AssemblyName System.Windows.Forms; $w=New-Object -ComObject WScript.Shell; if(-not $w.AppActivate('${windowTitle.replaceAll("'", "''")}')){exit 2}; Start-Sleep -Milliseconds 150; [Windows.Forms.SendKeys]::SendWait('${keys.replaceAll("'", "''")}')`);
}
function readWindowText(windowTitle) {
  return powershell(`Add-Type -AssemblyName UIAutomationClient; $root=[Windows.Automation.AutomationElement]::RootElement; $window=$root.FindFirst([Windows.Automation.TreeScope]::Children,(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'${windowTitle.replaceAll("'", "''")}'))); if($null -eq $window){exit 3}; ($window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition) | ForEach-Object {$_.Current.Name} | Where-Object {$_}) -join [Environment]::NewLine`);
}
function captureDesktop(path) {
  powershell(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object Drawing.Bitmap($b.Width,$b.Height); $g=[Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); $bmp.Save('${path.replaceAll("'", "''")}',[Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`);
}
async function waitForDebugPortDown(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${port}/json`); }
    catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Electron debug port ${port} did not close.`);
}

try {
  await waitFor("Boolean(window.newbrain?.listWorkspaces)");
  const workspacePath = await evaluate(`(async () => { let items = await window.newbrain.listWorkspaces(); if (!items.length) items = await window.newbrain.createBlankWorkspace({ name: "Holon UI Demo" }); const workspace = items[0]; if (!workspace.threads?.length) items = await window.newbrain.addWorkspaceThread({ workspaceId: workspace.id, title: "Holon UI Demo", summary: "", scope: "project" }); const active = items.find((item) => item.id === workspace.id) || items[0]; await window.newbrain.activateWorkspaceThread({ workspaceId: active.id, threadId: active.threads[0].id }); setTimeout(() => location.reload(), 0); return active.path; })()`);
  assert.ok(workspacePath, "The test workspace did not expose its canonical path.");
  await waitFor(`[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Holon')`);
  await screenshot("01-before-holon");
  await clickText("Holon");
  await waitFor(`Boolean(document.querySelector('.holon-workspace'))`);
  await screenshot("02-holon-visible");
  await clickText("刷新并领取");
  await waitFor(`Boolean(document.querySelector('.holon-work-item'))`);
  await screenshot("03-task-claimed");
  await clickText("准备执行");
  await waitFor(`Boolean(document.querySelector('.holon-confirm'))`);
  await screenshot("04-confirm-visible");
  await clickText("确认执行");
  await waitFor(`Boolean(document.querySelector('[data-testid="approval-dialog"]'))`, 30_000);
  await screenshot("05-approval-visible");
  await clickText("批准并继续");
  const gamePath = join(workspacePath, "outputs", "holon-snake", "HolonSnake.ps1");
  await waitFor(`!document.querySelector('[data-testid="approval-dialog"]')`, 30_000);
  const fileDeadline = Date.now() + 30_000;
  while (!existsSync(gamePath) && Date.now() < fileDeadline) await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(existsSync(gamePath), true, "Holon reported progress but did not create the desktop game.");
  const game = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", gamePath], { cwd: workspacePath, windowsHide: false });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  assert.equal(game.exitCode, null, "Holon Snake desktop process exited before interaction.");
  assert.match(readWindowText("Holon Snake"), /Score: 0/);
  sendKeys("Holon Snake", "{RIGHT}");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.match(readWindowText("Holon Snake"), /Score: 10/);
  sendKeys("Holon Snake", " ");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.match(readWindowText("Holon Snake"), /Paused/);
  sendKeys("Holon Snake", " ");
  sendKeys("Holon Snake", "r");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.match(readWindowText("Holon Snake"), /Score: 0/);
  captureDesktop(join(evidenceDir, "06-game-keyboard-verified.png"));
  sendKeys("Holon Snake", "%{F4}");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.notEqual(game.exitCode, null, "Holon Snake did not close after Alt+F4.");
  await screenshot("07-holon-completed");
  const stateRoot = session.workspacePath;
  assert.ok(stateRoot, "The isolated NewBrain state root is unavailable for restart proof.");
  socket.close();
  session.close({ preserveWorkspace: true });
  await waitForDebugPortDown(debugPort);
  process.env.NEWBRAIN_E2E_USE_LIVE_WORKSPACE = "1";
  process.env.NEWBRAIN_E2E_MODEL_CONFIG_PATH = join(stateRoot, "newbrain.config.json");
  process.env.NEWBRAIN_WORKSPACE_PATH = stateRoot;
  const restartPort = debugPort + 1;
  session = await ensureElectronE2ESession(restartPort);
  const restartedPage = session.pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  assert.ok(restartedPage, "Restarted Electron renderer page was not found.");
  socket = new WebSocket(restartedPage.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  await waitFor("Boolean(window.newbrain?.listWorkspaces)");
  await waitFor(`window.newbrain.listWorkspaces().then((items) => items.some((item) => item.name === 'Holon UI Demo' && item.threads?.length > 0))`);
  assert.equal(existsSync(gamePath), true, "Desktop game artifact disappeared after NewBrain restart.");
  await screenshot("08-after-newbrain-restart");
  const result = { status: "PASS", evidenceDir, completed: ["visible Holon navigation", "mouse task claim", "mouse execution confirmation", "visible approval", "mouse approval", "desktop game launch", "keyboard movement", "keyboard pause", "keyboard restart", "desktop game close", "NewBrain restart", "workspace and artifact recovery"], artifacts: [gamePath, join(workspacePath, "outputs", "holon-snake", "README.txt")] };
  writeFileSync(join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} catch (error) {
  const remoteState = await fetch(`http://127.0.0.1:${modelPort}/__state`).then((response) => response.json()).catch(() => null);
  const uiState = await evaluate(`(() => ({ body: document.body.innerText.slice(0, 8000), approvalVisible: Boolean(document.querySelector('[data-testid="approval-dialog"]')), workItem: document.querySelector('.holon-work-item')?.innerText || '' }))()`).catch(() => null);
  const result = { status: "FAIL", evidenceDir, error: error instanceof Error ? error.message : String(error), remoteState, uiState };
  await screenshot("failure").catch(() => undefined);
  writeFileSync(join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  socket.close(); session.close(); modelServer.kill();
}
