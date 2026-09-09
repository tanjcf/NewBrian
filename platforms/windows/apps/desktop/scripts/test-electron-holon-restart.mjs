import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectElectronInput } from "./electron-cdp-input.mjs";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";
import { ensureHolonWorkspace } from "./holon-e2e-workspace.mjs";

const port = 27_000 + (process.pid % 5_000);
const debugPort = 9342;
const server = spawn(process.execPath, [fileURLToPath(new URL("./holon-contract-model-server.mjs", import.meta.url))], {
  env: {
    ...process.env,
    NEWBRAIN_HOLON_TEST_PORT: String(port),
    NEWBRAIN_HOLON_RESTART_MODE: "1"
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "inherit"]
});
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Holon restart server did not start.")), 10_000);
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("READY")) { clearTimeout(timeout); resolve(); }
  });
  server.once("exit", (code) => reject(new Error(`Holon restart server exited: ${code}`)));
});

process.env.NEWBRAIN_MODEL_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.NEWBRAIN_E2E_MODEL_ID = "newbrain-e2e-model";
process.env.NEWBRAIN_E2E_AUTH_BYPASS = "1";
let workspacePath = "";
let firstSession;
let restartedSession;
let nativeEventCount = 0;
try {
  firstSession = await ensureElectronE2ESession(debugPort);
  workspacePath = firstSession.workspacePath ?? "";
  assert.ok(workspacePath);
  let cdp = await connectElectronInput(firstSession.pages, firstSession.processId);
  await ensureHolonWorkspace(cdp, "Holon Restart E2E", "Restart");
  await openHolon(cdp);
  await cdp.click({ selector: ".holon-pane button", text: "刷新并领取" });
  await cdp.waitFor("restart task claim", `document.querySelector('.holon-work-item')?.textContent?.includes('wi_e2e_restart')`);
  await cdp.click({ selector: ".holon-work-item button", text: "准备执行" });
  await cdp.waitFor("execution confirmation", `Boolean(document.querySelector('.holon-confirm'))`);
  await cdp.click({ selector: ".holon-confirm button", text: "确认执行", exact: true });
  await waitRemote((state) => state.responseCount === 1, 30_000);

  nativeEventCount += cdp.inputEvidence().nativeEventCount;
  cdp.close();
  firstSession.close({ preserveWorkspace: true });
  await waitForDebugPortDown(debugPort);

  process.env.NEWBRAIN_E2E_USE_LIVE_WORKSPACE = "1";
  process.env.NEWBRAIN_E2E_MODEL_CONFIG_PATH = join(workspacePath, "newbrain.config.json");
  process.env.NEWBRAIN_WORKSPACE_PATH = workspacePath;
  restartedSession = await ensureElectronE2ESession(debugPort);
  cdp = await connectElectronInput(restartedSession.pages, restartedSession.processId);
  await openHolon(cdp);
  await cdp.click({ selector: ".holon-pane button", text: "刷新并领取" });
  await cdp.waitFor("interrupted durable task", `document.querySelector('.holon-work-item')?.textContent?.includes('interrupted')`);
  assert.equal(await cdp.evaluate(`document.querySelector('.holon-work-item')?.textContent?.includes('恢复执行') || false`), true);
  assert.equal((await fetchState()).responseCount, 1);
  await cdp.click({ selector: ".holon-work-item button", text: "放弃任务" });
  await cdp.waitFor("discard after restart", `document.querySelector('.holon-work-item')?.textContent?.includes('cancelled')`);
  const finalState = await waitRemote((state) => state.cancelRequests.includes("wi_e2e_restart")
    && state.events.some((event) => event.work_item_id === "wi_e2e_restart" && event.event_type === "work_item.cancelled"), 30_000);
  assert.equal(finalState.responseCount, 1);
  const evidence = { ok: true, input: { driver: "windows-user32-sendinput", nativeEventCount: nativeEventCount + cdp.inputEvidence().nativeEventCount }, interrupted: true, explicitDiscard: true, duplicateExecutions: 0 };
  const evidencePath = fileURLToPath(new URL("../../../integration-artifacts/holon-newbrain/restart-recovery.json", import.meta.url));
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  cdp.close();
} finally {
  firstSession?.close({ preserveWorkspace: true });
  restartedSession?.close();
  server.kill();
  if (workspacePath) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try { rmSync(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* Isolated E2E residue only. */ }
  }
}

async function openHolon(cdp) {
  await cdp.waitFor("Holon navigation", `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Holon')`);
  await cdp.click({ selector: "button", text: "Holon", exact: true });
  await cdp.waitFor("Holon workspace", `Boolean(document.querySelector('.holon-workspace'))`);
}

async function fetchState() {
  return fetch(`http://127.0.0.1:${port}/__state`).then((response) => response.json());
}

async function waitRemote(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await fetchState();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for restart contract state.");
}

async function waitForDebugPortDown(debugPort) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${debugPort}/json`); }
    catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Electron did not stop before restart.");
}
