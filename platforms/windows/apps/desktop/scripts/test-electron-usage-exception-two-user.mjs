import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 32_500 + (process.pid % 4_000);
const debugPortBase = 25_000 + (process.pid % 2_000);
const evidenceDir = fileURLToPath(new URL("../../../../integration-artifacts/usage-exception-feedback/", import.meta.url));
await mkdir(evidenceDir, { recursive: true });

const server = spawn(process.execPath, [fileURLToPath(new URL("./usage-exception-feedback-two-user-mock-server.mjs", import.meta.url))], {
  env: { ...process.env, NEWBRAIN_USAGE_FEEDBACK_TWO_USER_PORT: String(port) }, windowsHide: true,
  stdio: ["ignore", "pipe", "inherit"]
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Two-user mock server did not start.")), 10_000);
  server.stdout.on("data", (chunk) => { if (String(chunk).includes("READY")) { clearTimeout(timer); resolve(); } });
  server.once("exit", (code) => reject(new Error(`Two-user mock server exited early: ${code}`)));
});

let sessionA;
let sessionB;
let cdpA;
let cdpB;
try {
  ({ session: sessionA, cdp: cdpA } = await openUser("usage-user-a", debugPortBase));
  await submitAndConfirm(cdpA, "Usage Feedback User A");
  cdpA.close(); sessionA.close(); cdpA = null; sessionA = null;
  await sleep(1_000);

  ({ session: sessionB, cdp: cdpB } = await openUser("usage-user-b", debugPortBase + 1));
  await submitAndConfirm(cdpB, "Usage Feedback User B");

  const admin = await fetch(`http://127.0.0.1:${port}/api/admin/desktop-error-reports?status=OPEN&limit=25`)
    .then((response) => response.json());
  assert.equal(admin.length, 2);
  assert.equal(new Set(admin.map((item) => item.userEmail)).size, 2);
  assert.equal(new Set(admin.map((item) => item.fingerprint)).size, 1);
  for (const row of admin) {
    assert.equal(row.kind, "user_reported_usage_exception");
    assert.equal(row.totalOccurrences, 2);
    assert.equal(row.affectedUsers, 2);
    assert.ok(row.versionDistribution);
  }
  const remote = await fetch(`http://127.0.0.1:${port}/__state`).then((response) => response.json());
  assert.equal(remote.chatRequests, 0);
  assert.equal(remote.uploads.length, 2);
  assert.equal(remote.aggregate.sharedFingerprintCount, 1);

  const springAttempt = await trySpringAdmin();
  const evidence = {
    ok: true,
    users: admin.map((item) => ({ id: item.id, email: item.userEmail, fingerprint: item.fingerprint, occurrences: item.occurrences })),
    aggregate: {
      totalOccurrences: admin[0].totalOccurrences,
      affectedUsers: admin[0].affectedUsers,
      versionDistribution: admin[0].versionDistribution
    },
    springAdmin: springAttempt
  };
  await writeFile(join(evidenceDir, "two-user-mock.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  if (springAttempt.status === "PASS") {
    await writeFile(join(evidenceDir, "two-user-spring-admin.json"), `${JSON.stringify(springAttempt, null, 2)}\n`, "utf8");
  } else {
    await writeFile(join(evidenceDir, "two-user-spring-admin.json"), `${JSON.stringify({
      status: springAttempt.status,
      reason: springAttempt.reason
    }, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  cdpA?.close();
  cdpB?.close();
  sessionA?.close();
  sessionB?.close();
  server.kill();
}

async function openUser(userId, debugPort) {
  const root = await mkdtemp(join(tmpdir(), `newbrain-usage-two-user-${userId}-`));
  const stateRoot = join(root, ".newbrain");
  await mkdir(stateRoot, { recursive: true });
  await writeFile(join(root, "newbrain.config.json"), `${JSON.stringify({ llm: {
    provider: "newbrain", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "newbrain-e2e",
    wireApi: "responses", model: "newbrain-e2e-model", reviewModel: "newbrain-e2e-model",
    reasoningEffort: "medium", disableResponseStorage: true
  } }, null, 2)}\n`);
  await writeFile(join(stateRoot, "authorized-models.json"), `${JSON.stringify([{
    id: "newbrain-e2e-model", model: "newbrain-e2e-model", label: "E2E", provider: "newbrain"
  }], null, 2)}\n`);
  await writeFile(join(stateRoot, "desktop-auth.json"), `${JSON.stringify({
    mode: "desktop_token",
    access_token: `plain:${Buffer.from(userId).toString("base64")}`,
    user: { id: userId, email: `${userId}@example.test`, role: "user" }
  }, null, 2)}\n`);
  Object.assign(process.env, {
    NEWBRAIN_E2E_FORCE_FRESH: "1",
    NEWBRAIN_E2E_USE_LIVE_WORKSPACE: "1",
    NEWBRAIN_E2E_MODEL_CONFIG_PATH: join(root, "newbrain.config.json"),
    NEWBRAIN_MODEL_BASE_URL: `http://127.0.0.1:${port}/v1`,
    NEWBRAIN_E2E_MODEL_ID: "newbrain-e2e-model",
    NEWBRAIN_E2E_AUTH_BYPASS: "1",
    NEWBRAIN_E2E_AUTH_TOKEN: userId
  });
  const session = await ensureElectronE2ESession(debugPort);
  return { session, cdp: await connect(session), root };
}

async function submitAndConfirm(cdp, workspaceName) {
  const workspacePath = join(tmpdir(), `usage-feedback-${workspaceName.replace(/\s+/g, "-").toLowerCase()}-${process.pid}`);
  await mkdir(workspacePath, { recursive: true });
  await cdp.evaluate(`(async () => {
    let catalog = await window.newbrain.listWorkspaces();
    if (!catalog.some((item) => item.path === ${JSON.stringify(workspacePath)})) {
      catalog = await window.newbrain.addWorkspace({ name: ${JSON.stringify(workspaceName)}, path: ${JSON.stringify(workspacePath)} });
    }
    let workspace = catalog.find((item) => item.path === ${JSON.stringify(workspacePath)});
    if (!(workspace?.threads || []).length) {
      catalog = await window.newbrain.addWorkspaceThread({ workspaceId: workspace.id, title: "Usage Feedback", summary: "E2E", scope: "chat" });
      workspace = catalog.find((item) => item.id === workspace.id);
    }
    const thread = workspace.threads[0];
    await window.newbrain.activateWorkspaceThread({ workspaceId: workspace.id, threadId: thread.id });
    return true;
  })()`);
  await cdp.reload();
  await cdp.waitFor("seeded thread", `Boolean(document.querySelector('[data-testid="sidebar-task-row"]'))`);
  await cdp.evaluate(`document.querySelector('[data-testid="sidebar-task-row"]')?.click()`);
  await cdp.waitFor("composer", `Boolean(document.querySelector('.task-column:not(.new-chat-task) [data-testid="composer-input"]'))`);
  await submitCommand(cdp, "newbrain使用异常：生成文档后一直没有完成");
  await cdp.waitFor("preview", `Boolean(document.querySelector('[data-testid="usage-exception-feedback-dialog"]'))`, 30_000);
  await cdp.clickText("确认提交");
  await cdp.waitFor("submitted", `document.body.innerText.includes('异常已提交，编号') || document.body.innerText.includes('异常已保存，编号')`, 20_000);
}

async function trySpringAdmin() {
  const base = process.env.NEWBRAIN_SPRING_ADMIN_BASE_URL?.trim();
  if (!base) {
    return { status: "BLOCKED", reason: "NEWBRAIN_SPRING_ADMIN_BASE_URL unset; mock two-user aggregate verified instead." };
  }
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/admin/desktop-error-reports?status=OPEN&limit=25`, {
      headers: process.env.NEWBRAIN_SPRING_ADMIN_TOKEN
        ? { Authorization: `Bearer ${process.env.NEWBRAIN_SPRING_ADMIN_TOKEN}` }
        : {}
    });
    if (!response.ok) {
      return { status: "BLOCKED", reason: `admin list HTTP ${response.status}` };
    }
    const rows = await response.json();
    const usage = (Array.isArray(rows) ? rows : []).filter((item) => item.kind === "user_reported_usage_exception");
    if (usage.length < 2) {
      return { status: "BLOCKED", reason: "fewer than two usage-exception tickets in live admin list" };
    }
    return {
      status: "PASS",
      count: usage.length,
      sample: usage.slice(0, 2).map((item) => ({
        id: item.id,
        fingerprint: item.fingerprint,
        totalOccurrences: item.totalOccurrences,
        affectedUsers: item.affectedUsers
      }))
    };
  } catch (error) {
    return { status: "BLOCKED", reason: String(error) };
  }
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

async function connect(currentSession) {
  const page = currentSession.pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  assert.ok(page, "No Electron renderer page was found.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const evaluate = (expression, timeout = 20_000) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`CDP evaluation timed out: ${expression.slice(0, 80)}`)), timeout);
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
      throw new Error(`Timed out waiting for ${label}: ${await evaluate("document.body.innerText.slice(0, 1000)").catch(() => "")}`);
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
