import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectElectronInput } from "./electron-cdp-input.mjs";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";
import { ensureHolonWorkspace } from "./holon-e2e-workspace.mjs";

const port = 32_000 + (process.pid % 5_000);
const debugPortBase = 20_000 + (process.pid % 10_000) * 2;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = spawn(process.execPath, [fileURLToPath(new URL("./holon-two-user-mock-server.mjs", import.meta.url))], {
  env: { ...process.env, NEWBRAIN_HOLON_TWO_USER_PORT: String(port) }, windowsHide: true,
  stdio: ["ignore", "pipe", "inherit"]
});
await ready(server);
process.env.NEWBRAIN_MODEL_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.NEWBRAIN_E2E_MODEL_ID = "newbrain-holon-two-user";
process.env.NEWBRAIN_E2E_AUTH_BYPASS = "1";

let sessionA;
let sessionB;
let nativeEventCount = 0;
try {
  sessionA = await openUser("mock-user-a", debugPortBase);
  await prepareWorkspace(sessionA.cdp, "Holon User A");
  await openHolon(sessionA.cdp);
  await executeNext(sessionA.cdp, "wi_a_1");
  await waitState((state) => state.users["mock-user-a"].candidates.includes("version-a-v1"), "A V1 candidate");
  await approveFirstCandidate(sessionA.cdp, "version-a-v1");
  await waitState((state) => state.users["mock-user-a"].activeVersionId === "version-a-v1", "A V1 active");

  await openTasks(sessionA.cdp);
  await executeNext(sessionA.cdp, "wi_a_2");
  await waitState((state) => state.users["mock-user-a"].candidates.includes("version-a-v2"), "A V2 candidate");
  await approveFirstCandidate(sessionA.cdp, "version-a-v2");
  await waitState((state) => state.users["mock-user-a"].activeVersionId === "version-a-v2", "A V2 active");
  await submitSafetyFeedback(sessionA.cdp, "private-a-skill", "version-a-v2");
  const rolledBack = await waitState((state) => state.users["mock-user-a"].activeVersionId === "version-a-v1"
    && state.users["mock-user-a"].feedbackCount === 1, "A V2 to V1 rollback");
  assert.deepEqual(rolledBack.users["mock-user-a"].snapshots, ["snapshot-a-1", "snapshot-a-2"]);

  nativeEventCount += sessionA.cdp.inputEvidence().nativeEventCount;
  sessionA.cdp.close();
  sessionA.session.close();
  await sleep(1_500);
  sessionA = null;

  sessionB = await openUser("mock-user-b", debugPortBase + 1);
  await prepareWorkspace(sessionB.cdp, "Holon User B");
  await openHolon(sessionB.cdp);
  await clickText(sessionB.cdp, ".holon-pane button", "刷新并领取");
  await sessionB.cdp.waitFor("B has no A task", `document.querySelector('.holon-empty')?.textContent?.includes('没有已领取')`);
  await openCandidates(sessionB.cdp);
  assert.equal(await sessionB.cdp.evaluate(`Boolean(document.querySelector('.candidate-diff'))`), false);
  await openKnowledgeAndSearch(sessionB.cdp, "private-a-rule");
  assert.equal(await sessionB.cdp.evaluate(`Boolean(document.querySelector('.holon-list article'))`), false);
  const denied = await sessionB.cdp.evaluate(`window.newbrain.getKnowledgeSnapshot({ snapshotId: 'snapshot-a-2' })
    .then(() => false, () => true)`);
  assert.equal(denied, true);
  const isolated = await waitState((state) => state.crossUserDenials >= 1, "cross-user denial");
  assert.deepEqual(isolated.users["mock-user-b"], {
    claimIndex: 0, eventTypes: [], candidates: [], versions: [], snapshots: [], feedbackCount: 0, activeVersionId: null
  });

  const cleanup = await fetch(`http://127.0.0.1:${port}/__cleanup`, { method: "POST" }).then((response) => response.json());
  assert.deepEqual(cleanup, { ok: true, residue: 0 });
  const evidence = {
    ok: true,
    input: { driver: "windows-user32-sendinput", nativeEventCount: nativeEventCount + sessionB.cdp.inputEvidence().nativeEventCount },
    userA: { v1Approved: true, v2Inherited: true, snapshotBound: true, safetyRollback: "version-a-v1" },
    userB: { noTasks: true, noCandidates: true, noKnowledge: true },
    crossUserDenied: true,
    cleanupResidue: 0
  };
  const evidencePath = fileURLToPath(new URL("../../../integration-artifacts/holon-newbrain/two-user-mock-electron.json", import.meta.url));
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  sessionA?.cdp.close();
  sessionB?.cdp.close();
  sessionA?.session.close();
  sessionB?.session.close();
  server.kill();
}

async function openUser(token, debugPort) {
  process.env.NEWBRAIN_E2E_AUTH_TOKEN = token;
  const session = await ensureElectronE2ESession(debugPort);
  const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  assert.ok(page);
  return { session, cdp: await connectElectronInput(page.webSocketDebuggerUrl, session.processId) };
}

async function prepareWorkspace(cdp, name) {
  await ensureHolonWorkspace(cdp, name);
  await cdp.waitFor("Holon navigation", `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Holon')`);
}

async function openHolon(cdp) {
  await clickText(cdp, "button", "Holon", true);
  await cdp.waitFor("Holon workspace", `Boolean(document.querySelector('.holon-workspace'))`);
}
async function openTasks(cdp) {
  await clickText(cdp, ".holon-tabs button", "远程任务");
  await cdp.waitFor("remote task pane", `[...document.querySelectorAll('.holon-pane button')].some((button) => button.textContent?.includes('刷新并领取'))`);
}
async function openCandidates(cdp) {
  await clickText(cdp, ".holon-tabs button", "学习候选");
  await clickText(cdp, ".holon-pane button", "刷新候选");
  await sleep(250);
}
async function executeNext(cdp, workItemId) {
  await clickText(cdp, ".holon-pane button", "刷新并领取");
  try {
    await cdp.waitFor(workItemId, `document.querySelector('.holon-work-item')?.textContent?.includes(${JSON.stringify(workItemId)})`);
  } catch (error) {
    const remote = await fetch(`http://127.0.0.1:${port}/__state`).then((response) => response.json());
    const renderer = await cdp.evaluate(`({
      workItem: document.querySelector('.holon-work-item')?.textContent || '',
      notice: document.querySelector('.holon-notice')?.textContent || '',
      body: document.body.innerText.slice(0, 2_000)
    })`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}: ${JSON.stringify({ remote, renderer })}`);
  }
  assert.equal(await cdp.evaluate(`document.querySelector('.holon-work-item')?.textContent?.includes('知识快照')`), true);
  assert.equal(await cdp.evaluate(`document.querySelector('.holon-work-item')?.textContent?.includes('有效工具')`), true);
  await clickText(cdp, ".holon-work-item button", "准备执行");
  await cdp.waitFor("confirmation", `Boolean(document.querySelector('.holon-confirm'))`);
  await clickText(cdp, ".holon-confirm button", "确认执行");
  await cdp.waitFor(`${workItemId} completed`, `document.querySelector('.holon-work-item')?.textContent?.includes('completed')`, 60_000);
}
async function approveFirstCandidate(cdp, versionId) {
  await openCandidates(cdp);
  await cdp.waitFor(versionId, `document.querySelector('.candidate-diff')?.parentElement?.textContent?.includes(${JSON.stringify(versionId)})`);
  await clickText(cdp, ".holon-row-actions button", "批准", true);
  await cdp.waitFor("governance confirmation", `Boolean(document.querySelector('.holon-confirm'))`);
  await clickText(cdp, ".holon-confirm button", "确认", true);
  await cdp.waitFor("governance completion", `!document.querySelector('.holon-confirm') && !document.querySelector('.holon-toolbar button')?.disabled`);
}
async function submitSafetyFeedback(cdp, skillKey, versionId) {
  await clickText(cdp, ".holon-tabs button", "同步与反馈");
  await cdp.replaceText({ selector: ".holon-feedback-form input", index: 0 }, skillKey);
  await cdp.replaceText({ selector: ".holon-feedback-form input", index: 1 }, versionId);
  await cdp.click({ selector: ".holon-feedback-form input", index: 2 });
  await cdp.click({ selector: ".holon-feedback-form button[type='submit']", text: "提交反馈" });
}
async function openKnowledgeAndSearch(cdp, query) {
  await clickText(cdp, ".holon-tabs button", "私有知识");
  await cdp.replaceText({ selector: ".holon-search input" }, query);
  await cdp.click({ selector: ".holon-search button[type='submit']", text: "搜索" });
  await sleep(250);
}
async function clickText(cdp, selector, text, exact = false) {
  await cdp.click({ selector, text, exact });
}
async function waitState(predicate, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await fetch(`http://127.0.0.1:${port}/__state`).then((response) => response.json());
    if (predicate(state)) return state;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function ready(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Two-user mock did not start.")), 10_000);
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("READY")) { clearTimeout(timeout); resolve(); } });
    child.once("exit", (code) => reject(new Error(`Two-user mock exited: ${code}`)));
  });
}
