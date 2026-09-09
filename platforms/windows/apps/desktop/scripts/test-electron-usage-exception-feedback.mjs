import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 19_000 + (process.pid % 2_000);
const debugPort = 24_000 + (process.pid % 2_000);
const evidenceDir = fileURLToPath(new URL("../../../../integration-artifacts/usage-exception-feedback/", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "newbrain-usage-feedback-e2e-"));
const stateRoot = join(root, ".newbrain");
await mkdir(stateRoot, { recursive: true });
await mkdir(evidenceDir, { recursive: true });
await writeFile(join(root, "newbrain.config.json"), `${JSON.stringify({ llm: {
  provider: "newbrain", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "newbrain-e2e",
  wireApi: "responses", model: "newbrain-e2e-model", reviewModel: "newbrain-e2e-model",
  reasoningEffort: "medium", disableResponseStorage: true
} }, null, 2)}\n`);
await writeFile(join(stateRoot, "authorized-models.json"), `${JSON.stringify([{
  id: "newbrain-e2e-model", model: "newbrain-e2e-model", label: "E2E", provider: "newbrain"
}], null, 2)}\n`);
await writeFile(join(stateRoot, "desktop-auth.json"), `${JSON.stringify({
  mode: "desktop_token", access_token: `plain:${Buffer.from("usage-feedback-user").toString("base64")}`,
  user: { id: "usage-feedback-user", email: "usage@example.test", role: "user" }
}, null, 2)}\n`);

const server = spawn(process.execPath, [fileURLToPath(new URL("./usage-exception-feedback-mock-server.mjs", import.meta.url))], {
  env: { ...process.env, NEWBRAIN_USAGE_FEEDBACK_PORT: String(port) }, windowsHide: true,
  stdio: ["ignore", "pipe", "inherit"]
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Usage feedback mock server did not start.")), 10_000);
  server.stdout.on("data", (chunk) => { if (String(chunk).includes("READY")) { clearTimeout(timer); resolve(); } });
  server.once("exit", (code) => reject(new Error(`Mock server exited early: ${code}`)));
});

Object.assign(process.env, {
  NEWBRAIN_E2E_FORCE_FRESH: "1", NEWBRAIN_E2E_USE_LIVE_WORKSPACE: "1",
  NEWBRAIN_E2E_MODEL_CONFIG_PATH: join(root, "newbrain.config.json"), NEWBRAIN_MODEL_BASE_URL: `http://127.0.0.1:${port}/v1`,
  NEWBRAIN_E2E_MODEL_ID: "newbrain-e2e-model", NEWBRAIN_E2E_AUTH_BYPASS: "1"
});

let session;
let cdp;
try {
  session = await ensureElectronE2ESession(debugPort);
  cdp = await connect(session);
  const workspacePath = join(root, "project");
  await mkdir(workspacePath, { recursive: true });
  const target = await cdp.evaluate(`(async () => {
    let catalog = await window.newbrain.listWorkspaces();
    if (!catalog.some((item) => item.path === ${JSON.stringify(workspacePath)})) {
      catalog = await window.newbrain.addWorkspace({ name: "Usage Feedback E2E", path: ${JSON.stringify(workspacePath)} });
    }
    let workspace = catalog.find((item) => item.path === ${JSON.stringify(workspacePath)});
    if (!(workspace?.threads || []).length) {
      catalog = await window.newbrain.addWorkspaceThread({ workspaceId: workspace.id, title: "Usage Feedback", summary: "E2E", scope: "chat" });
      workspace = catalog.find((item) => item.id === workspace.id);
    }
    const thread = workspace.threads[0];
    await window.newbrain.activateWorkspaceThread({ workspaceId: workspace.id, threadId: thread.id });
    return { workspaceId: workspace.id, threadId: thread.id };
  })()`);
  assert.ok(target.workspaceId && target.threadId);
  await cdp.reload();
  await cdp.waitFor("seeded thread", `Boolean(document.querySelector('[data-testid="sidebar-task-row"]'))`);
  await cdp.evaluate(`document.querySelector('[data-testid="sidebar-task-row"]')?.click()`);
  await cdp.waitFor("existing thread composer", `Boolean(document.querySelector('.task-column:not(.new-chat-task) [data-testid="composer-input"]'))`);

  await submitCommand(cdp, "newbrain使用异常：生成文档后一直没有完成 password=secret");
  await cdp.waitFor("feedback preview", `Boolean(document.querySelector('[data-testid="usage-exception-feedback-dialog"]'))`, 30_000);
  const preview = await cdp.evaluate(`(() => { const dialog = document.querySelector('[data-testid="usage-exception-feedback-dialog"]'); return {
    title: dialog?.querySelector('h2')?.textContent, editable: dialog?.querySelectorAll('input, textarea, [contenteditable="true"]').length,
    buttons: [...dialog.querySelectorAll('button')].map((item) => item.textContent.trim()), text: dialog.textContent
  }; })()`);
  assert.equal(preview.title, "文档生成任务无法完成");
  assert.equal(preview.editable, 0);
  assert.deepEqual(preview.buttons, ["取消", "确认提交"]);
  assert.doesNotMatch(preview.text, /password=secret/);
  assert.equal((await remoteState()).chatRequests, 0);
  await cdp.screenshot(join(evidenceDir, "preview.png"));

  await cdp.clickText("取消");
  await cdp.waitFor("cancelled preview", `!document.querySelector('[data-testid="usage-exception-feedback-dialog"]')`);
  assert.equal((await remoteState()).uploads.length, 0);
  assert.match(await cdp.evaluate(`document.querySelector('.task-column:not(.new-chat-task) [data-testid="composer-input"]')?.value || ''`), /^newbrain使用异常/);
  await cdp.screenshot(join(evidenceDir, "cancel.png"));

  await submitCommand(cdp, "newbrain使用异常：生成文档后一直没有完成 password=secret");
  await cdp.waitFor("online preview", `Boolean(document.querySelector('[data-testid="usage-exception-feedback-dialog"]'))`, 30_000);
  await cdp.clickText("确认提交");
  await cdp.waitFor("online submitted status", `document.body.innerText.includes('异常已提交，编号')`, 20_000);
  await waitRemote((value) => value.uploads.length === 1, 20_000);
  const onlineStatus = await cdp.evaluate(`document.body.innerText`);
  assert.match(onlineStatus, /异常已提交，编号：/);
  assert.doesNotMatch(JSON.stringify((await remoteState()).uploads[0].body), /password=secret/);
  await cdp.screenshot(join(evidenceDir, "confirmed-id.png"));

  await submitCommand(cdp, "newbrain使用异常：生成文档后一直没有完成 password=secret");
  await cdp.waitFor("offline preview", `Boolean(document.querySelector('[data-testid="usage-exception-feedback-dialog"]'))`, 30_000);
  await fetch(`http://127.0.0.1:${port}/__offline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offline: true }) });
  await cdp.clickText("确认提交");
  await cdp.waitFor("queued status", `document.body.innerText.includes('联网或登录后会自动提交')`, 20_000);
  const pendingRoot = join(stateRoot, "error-reports", "pending");
  assert.equal((await readdir(pendingRoot)).length, 1);
  const pending = JSON.parse(await readFile(join(pendingRoot, (await readdir(pendingRoot))[0]), "utf8"));
  assert.equal(pending.kind, "user_reported_usage_exception");
  assert.equal(pending.message, "文档生成任务无法完成");
  assert.doesNotMatch(JSON.stringify(pending), /password=secret/);

  cdp.close(); cdp = null;
  session.close({ preserveWorkspace: true }); session = null;
  await waitForProcessExit(debugPort);
  await fetch(`http://127.0.0.1:${port}/__offline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offline: false }) });
  session = await ensureElectronE2ESession(debugPort + 1);
  cdp = await connect(session);
  await waitRemote((value) => value.uploads.length === 2, 20_000);
  assert.equal((await readdir(pendingRoot)).length, 0);
  assert.equal((await readdir(join(stateRoot, "error-reports", "sent"))).length, 2);
  await cdp.screenshot(join(evidenceDir, "retry-after-restart.png"));
  const final = await remoteState();
  assert.equal(final.uploads.length, 2);
  assert.match(final.uploads[0].authorization, /^Bearer /);
  assert.equal(final.uploads[0].body.kind, "user_reported_usage_exception");
  assert.equal(final.chatRequests, 0);
  const summary = {
    ok: true,
    preview: preview.title,
    onlineUploads: 1,
    queued: pending.id,
    uploadsAfterRestart: final.uploads.length,
    screenshots: ["preview.png", "cancel.png", "confirmed-id.png", "retry-after-restart.png"]
  };
  await writeFile(join(evidenceDir, "electron-runtime.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const renderer = await cdp?.evaluate(`({ feedbackIpc: window.__feedbackIpc, values: [...document.querySelectorAll('[data-testid="composer-input"]')].map((item) => item.value), buttons: [...document.querySelectorAll('[data-testid="composer-send-button"]')].map((item) => { const key = Object.keys(item).find((name) => name.startsWith('__reactProps')); const rect = item.getBoundingClientRect(); return { disabled: item.disabled, rect: [rect.x, rect.y, rect.width, rect.height], reactOnClick: typeof item[key]?.onClick }; }), errors: [...document.querySelectorAll('[class*="error"]')].map((item) => item.textContent).filter(Boolean), statuses: [...document.querySelectorAll('[class*="status"]')].map((item) => item.textContent).filter(Boolean) })`).catch(() => null);
  process.stderr.write(`${JSON.stringify({ remote: await remoteState().catch(() => null), renderer, root, error: String(error) }, null, 2)}\n`);
  throw error;
} finally {
  cdp?.close();
  session?.close();
  server.kill();
}

async function submitCommand(driver, text) {
  const scope = ".task-column:not(.new-chat-task)";
  await driver.evaluate(`(() => { const input = document.querySelector('${scope} [data-testid="composer-input"]'); input.focus(); input.select(); return true; })()`);
  await driver.typeText(text);
  await driver.waitFor("feedback command draft", `document.querySelector('${scope} [data-testid="composer-input"]')?.value === ${JSON.stringify(text)}`);
  const send = `document.querySelector('${scope} [data-testid="composer-input"]')?.closest('.composer-card')?.querySelector('[data-testid="composer-send-button"]')`;
  await driver.waitFor("enabled send button", `Boolean(${send}) && !(${send}).disabled && !(${send}).classList.contains('stop-btn')`);
  await driver.clickExpression(send);
}
async function remoteState() { return fetch(`http://127.0.0.1:${port}/__state`).then((response) => response.json()); }
async function waitRemote(predicate, timeout = 10_000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await remoteState(); if (predicate(value)) return value; await sleep(100); } throw new Error("Timed out waiting for mock server state."); }
async function waitForProcessExit(portNumber) { const end = Date.now() + 15_000; while (Date.now() < end) { try { await fetch(`http://127.0.0.1:${portNumber}/json`); } catch { return; } await sleep(100); } throw new Error("Electron did not exit before restart."); }

async function connect(currentSession) {
  const page = currentSession.pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  assert.ok(page, "No Electron renderer page was found.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const command = (method, params = {}, timeout = 20_000) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), timeout);
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== requestId) return;
      clearTimeout(timer);
      socket.removeEventListener("message", listener);
      if (payload.error) reject(new Error(payload.error.message || String(payload.error)));
      else resolve(payload.result);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = (expression, timeout = 20_000) => command("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true
  }, timeout).then((result) => {
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result?.result?.value;
  });
  return {
    evaluate,
    screenshot: async (filePath) => {
      await mkdir(dirname(filePath), { recursive: true });
      await evaluate(`document.readyState === 'complete'`);
      const metrics = await evaluate(`({ width: Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0, 1280), height: Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 720) })`);
      await command("Emulation.setDeviceMetricsOverride", {
        width: Math.max(Number(metrics?.width) || 1280, 800),
        height: Math.max(Number(metrics?.height) || 720, 600),
        deviceScaleFactor: 1,
        mobile: false
      });
      await sleep(200);
      const shot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(filePath, Buffer.from(shot.data, "base64"));
    },
    reload: async () => { socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } })); await sleep(1_500); },
    waitFor: async (label, expression, timeout = 10_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timed out waiting for ${label}: ${await evaluate("document.body.innerText.slice(0, 1000)").catch(() => "")}`); },
    clickText: (text) => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('button not found'); button.click(); return true; })()`),
    typeText: async (text) => {
      for (const character of text) {
        socket.send(JSON.stringify({ id: ++id, method: "Input.dispatchKeyEvent", params: { type: "char", key: character, text: character, unmodifiedText: character } }));
      }
      await sleep(200);
    },
    clickExpression: async (expression) => {
      const point = await evaluate(`(() => { const item = ${expression}; item.scrollIntoView({ block: 'center' }); const rect = item.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
      socket.send(JSON.stringify({ id: ++id, method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 } }));
      await sleep(50);
      socket.send(JSON.stringify({ id: ++id, method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 } }));
    },
    close: () => socket.close()
  };
}
