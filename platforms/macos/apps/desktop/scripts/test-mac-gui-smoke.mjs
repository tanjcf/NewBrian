#!/usr/bin/env node
/**
 * macOS GUI smoke:
 * 1. Launch Electron with Finder-like PATH (proves login-shell PATH recovery)
 * 2. Wait for CDP renderer
 * 3. Exercise core UI (sidebar / new chat)
 * 4. Assert startup debug log contains resolved system PATH with Homebrew/user bins
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const debugPort = Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9355);
const finderLikePath = "/usr/bin:/bin:/usr/sbin:/sbin";

// Keep parent PATH intact so node_modules/.bin/electron can spawn.
// Inject Finder-like PATH only into the Electron child process.
process.env.SHELL = process.env.SHELL || "/bin/zsh";
process.env.CODECN_E2E_FORCE_FRESH = "1";
process.env.CODECN_E2E_AUTH_BYPASS = "1";
process.env.CODECN_E2E_REMOTE_DEBUG_PORT = String(debugPort);
process.env.CODECN_E2E_CHILD_PATH = finderLikePath;
process.env.CODECN_E2E_USE_PACKAGED = process.env.CODECN_E2E_USE_PACKAGED || "1";

const session = await ensureElectronE2ESession(debugPort);
assert.equal(session.started, true, "Expected a freshly started Electron session.");
assert.ok(session.workspacePath, "Isolated workspace path missing.");

const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
assert.ok(page, "No debuggable Electron renderer page was found.");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
await new Promise((resolve) => setTimeout(resolve, 2_000));

let nextId = 0;
function evaluate(expression, timeoutMs = 20_000) {
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
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true }
    }));
  });
}

async function waitFor(label, expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const diagnostics = await evaluate(
    `JSON.stringify({ title: document.title, text: document.body?.innerText?.slice(0, 800) })`
  ).catch(() => "");
  throw new Error(`Timed out waiting for ${label}. Renderer diagnostics: ${diagnostics}`);
}

// Dismiss login/agreement overlays when present.
await evaluate(`(() => {
  const backToApp = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('返回应用'));
  if (backToApp instanceof HTMLButtonElement) backToApp.click();
  const skip = [...document.querySelectorAll('button')].find((button) => /跳过|稍后|进入应用/.test(button.textContent || ''));
  if (skip instanceof HTMLButtonElement) skip.click();
  return true;
})()`);

await waitFor("workspace sidebar / new chat", `Boolean(document.querySelector('[data-testid="new-chat-button"]'))`, 25_000);

const uiSnapshot = JSON.parse(await evaluate(`JSON.stringify({
  title: document.title,
  hasNewChat: Boolean(document.querySelector('[data-testid="new-chat-button"]')),
  hasComposer: Boolean(document.querySelector('textarea, [contenteditable="true"], [data-testid="composer-input"]')),
  hasSidebar: Boolean(document.querySelector('.sidebar, [data-testid="workspace-sidebar"], aside')),
  bodySample: (document.body?.innerText || '').slice(0, 240)
})`));

assert.equal(uiSnapshot.hasNewChat, true, `New chat control missing: ${JSON.stringify(uiSnapshot)}`);
assert.ok(
  uiSnapshot.hasComposer || uiSnapshot.hasSidebar,
  `Core chrome missing: ${JSON.stringify(uiSnapshot)}`
);

await evaluate(`document.querySelector('[data-testid="new-chat-button"]')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 1_000));

const afterNewChat = await evaluate(`Boolean(document.querySelector('[data-testid="new-chat-button"]'))`);
assert.equal(afterNewChat, true, "UI became unavailable after clicking new chat.");

// Main-process PATH recovery evidence from startup debug log.
const debugLogPath = join(session.workspacePath, "tmp-desktop-debug.log");
assert.ok(existsSync(debugLogPath), `Missing debug log at ${debugLogPath}`);
const debugLog = readFileSync(debugLogPath, "utf8");
const pathLine = debugLog.split(/\r?\n/).reverse().find((line) => line.includes("system PATH resolved"));
assert.ok(pathLine, `Debug log missing system PATH line. Tail:\n${debugLog.slice(-1200)}`);
assert.match(pathLine, /system PATH resolved entries=\d+/);
assert.ok(
  /\/opt\/homebrew\/bin|\/usr\/local\/bin|\/\.nvm\/|miniconda|\.bun/.test(pathLine),
  `Resolved PATH still looks like Finder defaults.\n${pathLine}`
);
assert.doesNotMatch(
  pathLine,
  /path=\/usr\/bin:\/bin:\/usr\/sbin:\/sbin$/,
  "Resolved PATH was not expanded beyond Finder defaults."
);

const report = {
  ok: true,
  debugPort,
  workspacePath: session.workspacePath,
  ui: uiSnapshot,
  pathEvidence: pathLine.slice(0, 500)
};
console.log(JSON.stringify(report, null, 2));
console.log("mac GUI smoke passed.");

socket.close();
session.close({ preserveWorkspace: process.env.CODECN_E2E_PRESERVE_WORKSPACE === "1" });
process.exit(0);
