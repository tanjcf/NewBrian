import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidenceDir = fileURLToPath(new URL("../../../../integration-artifacts/usage-exception-feedback/", import.meta.url));
const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const releaseRoot = join(desktopRoot, "release");
await mkdir(evidenceDir, { recursive: true });

const msiPath = await resolveMsiPath();
const hash = createHash("sha256").update(await readFile(msiPath)).digest("hex");
const signatureStatus = await readSignatureStatus(msiPath);
const installRoot = join(tmpdir(), `newbrain-msi-usage-${process.pid}`);
await mkdir(installRoot, { recursive: true });
await extractMsi(msiPath, installRoot);
const exePath = await findExecutable(installRoot);
assert.ok(exePath, `Installed executable missing under ${installRoot}`);

const port = 19_500 + (process.pid % 1_500);
const debugPort = 26_000 + (process.pid % 1_500);
const workspace = await mkdtemp(join(tmpdir(), "newbrain-msi-usage-ws-"));
const stateRoot = join(workspace, ".newbrain");
await mkdir(stateRoot, { recursive: true });
await writeFile(join(workspace, "newbrain.config.json"), `${JSON.stringify({ llm: {
  provider: "newbrain", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "newbrain-e2e",
  wireApi: "responses", model: "newbrain-e2e-model", reviewModel: "newbrain-e2e-model",
  reasoningEffort: "medium", disableResponseStorage: true
} }, null, 2)}\n`);
await writeFile(join(stateRoot, "authorized-models.json"), `${JSON.stringify([{
  id: "newbrain-e2e-model", model: "newbrain-e2e-model", label: "E2E", provider: "newbrain"
}], null, 2)}\n`);
await writeFile(join(stateRoot, "desktop-auth.json"), `${JSON.stringify({
  mode: "desktop_token", access_token: `plain:${Buffer.from("msi-usage-user").toString("base64")}`,
  user: { id: "msi-usage-user", email: "msi-usage@example.test", role: "user" }
}, null, 2)}\n`);

const server = spawn(process.execPath, [fileURLToPath(new URL("./usage-exception-feedback-mock-server.mjs", import.meta.url))], {
  env: { ...process.env, NEWBRAIN_USAGE_FEEDBACK_PORT: String(port) }, windowsHide: true,
  stdio: ["ignore", "pipe", "inherit"]
});
await ready(server);

const child = spawn(exePath, [], {
  cwd: dirname(exePath),
  env: {
    ...process.env,
    NEWBRAIN_E2E_REMOTE_DEBUG_PORT: String(debugPort),
    NEWBRAIN_E2E_AUTH_BYPASS: "1",
    NEWBRAIN_WORKSPACE_PATH: workspace,
    NEWBRAIN_MODEL_BASE_URL: `http://127.0.0.1:${port}/v1`,
    NEWBRAIN_E2E_MODEL_ID: "newbrain-e2e-model"
  },
  stdio: "ignore",
  windowsHide: false
});

let cdp;
try {
  const pages = await waitPages(debugPort, child);
  cdp = await connect(pages);
  const projectPath = join(workspace, "project");
  await mkdir(projectPath, { recursive: true });
  await cdp.evaluate(`(async () => {
    let catalog = await window.newbrain.listWorkspaces();
    if (!catalog.some((item) => item.path === ${JSON.stringify(projectPath)})) {
      catalog = await window.newbrain.addWorkspace({ name: "MSI Usage Feedback", path: ${JSON.stringify(projectPath)} });
    }
    let workspaceItem = catalog.find((item) => item.path === ${JSON.stringify(projectPath)});
    if (!(workspaceItem?.threads || []).length) {
      catalog = await window.newbrain.addWorkspaceThread({ workspaceId: workspaceItem.id, title: "Usage Feedback", summary: "MSI", scope: "chat" });
      workspaceItem = catalog.find((item) => item.id === workspaceItem.id);
    }
    await window.newbrain.activateWorkspaceThread({ workspaceId: workspaceItem.id, threadId: workspaceItem.threads[0].id });
    return true;
  })()`);
  await cdp.reload();
  await cdp.waitFor("thread", `Boolean(document.querySelector('[data-testid="sidebar-task-row"]'))`);
  await cdp.evaluate(`document.querySelector('[data-testid="sidebar-task-row"]')?.click()`);
  await cdp.waitFor("composer", `Boolean(document.querySelector('.task-column:not(.new-chat-task) [data-testid="composer-input"]'))`);

  await submitCommand(cdp, "newbrain使用异常：生成文档后一直没有完成 password=secret");
  await cdp.waitFor("preview", `Boolean(document.querySelector('[data-testid="usage-exception-feedback-dialog"]'))`, 30_000);
  const preview = await cdp.evaluate(`(() => {
    const dialog = document.querySelector('[data-testid="usage-exception-feedback-dialog"]');
    return {
      title: dialog?.querySelector('h2')?.textContent,
      editable: dialog?.querySelectorAll('input, textarea, [contenteditable="true"]').length,
      buttons: [...dialog.querySelectorAll('button')].map((item) => item.textContent.trim())
    };
  })()`);
  assert.equal(preview.title, "文档生成任务无法完成");
  assert.equal(preview.editable, 0);
  assert.deepEqual(preview.buttons, ["取消", "确认提交"]);
  await cdp.clickText("取消");
  await cdp.waitFor("cancelled", `!document.querySelector('[data-testid="usage-exception-feedback-dialog"]')`);
  assert.equal((await remoteState(port)).uploads.length, 0);

  await submitCommand(cdp, "newbrain使用异常：生成文档后一直没有完成 password=secret");
  await cdp.waitFor("confirm preview", `Boolean(document.querySelector('[data-testid="usage-exception-feedback-dialog"]'))`, 30_000);
  await cdp.clickText("确认提交");
  await cdp.waitFor("submitted", `document.body.innerText.includes('异常已提交，编号') || document.body.innerText.includes('异常已保存，编号')`, 20_000);
  await waitRemote(port, (value) => value.uploads.length === 1, 20_000);
  const final = await remoteState(port);
  assert.equal(final.chatRequests, 0);
  assert.equal(final.uploads[0].body.kind, "user_reported_usage_exception");

  const manifest = {
    ok: true,
    msiPath,
    sha256: hash,
    signatureStatus,
    installRoot,
    exePath,
    preview,
    uploads: final.uploads.length,
    chatRequests: final.chatRequests
  };
  await writeFile(join(evidenceDir, "msi-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(evidenceDir, "msi-runtime.txt"), `${JSON.stringify(manifest)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
} finally {
  cdp?.close();
  child.kill();
  server.kill();
}

async function resolveMsiPath() {
  const preferred = process.env.NEWBRAIN_USAGE_FEEDBACK_MSI_PATH?.trim();
  if (preferred) {
    await access(preferred);
    return preferred;
  }
  const entries = await readdir(releaseRoot).catch(() => []);
  const msi = entries
    .filter((name) => name.toLowerCase().endsWith(".msi"))
    .sort()
    .at(-1);
  if (!msi) throw new Error(`No MSI found under ${releaseRoot}. Run package-win-msi.ps1 first.`);
  return join(releaseRoot, msi);
}

async function extractMsi(msi, targetDir) {
  await new Promise((resolve, reject) => {
    const child = spawn("msiexec.exe", ["/a", msi, "/qn", `TARGETDIR=${targetDir}`], {
      windowsHide: true,
      stdio: "ignore"
    });
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`msiexec extract failed: ${code}`)));
  });
}

async function findExecutable(root) {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (/^newbrain\.exe$/i.test(entry.name) || /^NewBrain\.exe$/i.test(entry.name)) return full;
    }
  }
  return null;
}

async function readSignatureStatus(msi) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-Command",
      `(Get-AuthenticodeSignature -LiteralPath '${msi.replace(/'/g, "''")}').Status`
    ], { windowsHide: true });
    return String(stdout || "").trim() || "Unknown";
  } catch {
    return "Unknown";
  }
}

function ready(server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock server timeout")), 10_000);
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("READY")) { clearTimeout(timer); resolve(); } });
    server.once("exit", (code) => reject(new Error(`mock exited ${code}`)));
  });
}

async function waitPages(debugPort, child) {
  const end = Date.now() + 45_000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`packaged app exited early: ${child.exitCode}`);
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
      if (pages.some((item) => item.type === "page" && item.webSocketDebuggerUrl)) return pages;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Packaged app debug endpoint not ready on ${debugPort}`);
}

async function remoteState(portNumber) {
  return fetch(`http://127.0.0.1:${portNumber}/__state`).then((response) => response.json());
}

async function waitRemote(portNumber, predicate, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await remoteState(portNumber);
    if (predicate(value)) return value;
    await sleep(100);
  }
  throw new Error("Timed out waiting for packaged upload state.");
}

async function submitCommand(driver, text) {
  const scope = ".task-column:not(.new-chat-task)";
  await driver.evaluate(`(() => { const input = document.querySelector('${scope} [data-testid="composer-input"]'); input.focus(); input.select(); return true; })()`);
  await driver.typeText(text);
  await driver.waitFor("draft", `document.querySelector('${scope} [data-testid="composer-input"]')?.value === ${JSON.stringify(text)}`);
  const send = `document.querySelector('${scope} [data-testid="composer-input"]')?.closest('.composer-card')?.querySelector('[data-testid="composer-send-button"]')`;
  await driver.waitFor("send", `Boolean(${send}) && !(${send}).disabled && !(${send}).classList.contains('stop-btn')`);
  await driver.clickExpression(send);
}

async function connect(pages) {
  const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  assert.ok(page);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const evaluate = (expression, timeout = 20_000) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`CDP timed out: ${expression.slice(0, 80)}`)), timeout);
    const listener = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== requestId) return;
      clearTimeout(timer);
      socket.removeEventListener("message", listener);
      if (payload.error || payload.result?.exceptionDetails) {
        reject(new Error(payload.error?.message || payload.result.exceptionDetails.exception?.description || payload.result.exceptionDetails.text));
      } else resolve(payload.result?.result?.value);
    };
    socket.addEventListener("message", listener);
    socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  return {
    evaluate,
    reload: async () => { socket.send(JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } })); await sleep(1_500); },
    waitFor: async (label, expression, timeout = 10_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100); }
      throw new Error(`Timed out waiting for ${label}`);
    },
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
