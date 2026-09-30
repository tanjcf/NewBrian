import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectElectronInput } from "./electron-cdp-input.mjs";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";
import { ensureHolonWorkspace } from "./holon-e2e-workspace.mjs";

const port = 22_000 + (process.pid % 5_000);
const server = spawn(process.execPath, [new URL("./holon-contract-model-server.mjs", import.meta.url).pathname.slice(1)], {
  env: { ...process.env, NEWBRAIN_HOLON_TEST_PORT: String(port) }, windowsHide: true, stdio: ["ignore", "pipe", "inherit"]
});
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Holon test server did not start.")), 10_000);
  server.stdout.on("data", (chunk) => { if (String(chunk).includes("READY")) { clearTimeout(timeout); resolve(); } });
  server.once("exit", (code) => reject(new Error(`Holon test server exited: ${code}`)));
});
process.env.NEWBRAIN_MODEL_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.NEWBRAIN_E2E_MODEL_ID = "newbrain-e2e-model";
process.env.NEWBRAIN_E2E_AUTH_BYPASS = "1";
const session = await ensureElectronE2ESession(Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9341));
let cdp;
try {
  const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  assert.ok(page);
  cdp = await connectElectronInput(page.webSocketDebuggerUrl, session.processId);
  const { evaluate, waitFor } = cdp;
  const waitRemote = async (label, predicate, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastState = null;
    while (Date.now() < deadline) {
      const value = await fetch(`http://127.0.0.1:${port}/__state`).then((response) => response.json());
      lastState = value;
      if (predicate(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out waiting for remote ${label}: ${JSON.stringify({
      responseCount: lastState?.responseCount,
      approvalToolIssued: lastState?.approvalToolIssued,
      eventTypes: lastState?.events?.map((event) => `${event.work_item_id}:${event.event_type}`),
      cancelRequests: lastState?.cancelRequests,
      feedbackCount: lastState?.feedback?.length
    })}`);
  };
  await ensureHolonWorkspace(cdp, "Holon E2E");
  await waitFor("Holon navigation", `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Holon')`);
  await cdp.click({ selector: "button", text: "Holon", exact: true });
  await waitFor("Holon workspace", `Boolean(document.querySelector('.holon-workspace'))`);
  await cdp.click({ selector: ".holon-pane button", text: "刷新并领取" });
  await waitFor("claimed task", `document.querySelector('.holon-work-item')?.textContent?.includes('wi_e2e_001')`);
  assert.equal(await evaluate(`document.querySelector('.holon-work-item')?.textContent?.includes('确认执行') || false`), false);
  await waitFor("enabled prepare action", `[...document.querySelectorAll('.holon-work-item button')].some((button) => button.textContent?.includes('准备执行') && !button.disabled)`);
  await cdp.click({ selector: ".holon-work-item button", text: "准备执行" });
  await waitFor("explicit confirmation", `document.querySelector('.holon-confirm')?.textContent?.includes('确认执行')`);
  await cdp.click({ selector: ".holon-confirm button", text: "确认执行" });
  await waitFor("completed WorkItem", `document.querySelector('.holon-work-item')?.textContent?.includes('completed')`, 60_000);
  await cdp.click({ selector: ".holon-tabs button", text: "知识快照" });
  await cdp.replaceText({ selector: ".holon-search input" }, "snapshot-e2e");
  await cdp.click({ selector: ".holon-search button[type='submit']", text: "加载" });
  await waitFor("immutable snapshot", `document.querySelector('.holon-list')?.textContent?.includes('e2e-skill')`);
  await cdp.click({ selector: ".holon-tabs button", text: "学习候选" });
  await cdp.click({ selector: ".holon-pane button", text: "刷新候选" });
  await waitFor("learning candidate", `document.querySelector('.candidate-diff')?.textContent?.includes('candidate-e2e')`);
  await cdp.click({ selector: ".holon-row-actions button", text: "批准", exact: true });
  await waitFor("approve confirmation", `document.querySelector('.holon-confirm')?.textContent?.includes('批准')`);
  await cdp.click({ selector: ".holon-confirm button", text: "确认", exact: true });
  await waitRemote("candidate approval", (value) => value.mutations.some((item) => item.path.endsWith('/approve')));
  await cdp.click({ selector: ".holon-row-actions button", text: "拒绝", exact: true });
  await waitFor("reject confirmation", `document.querySelector('.holon-confirm')?.textContent?.includes('拒绝')`);
  await cdp.click({ selector: ".holon-confirm button", text: "确认", exact: true });
  await waitRemote("candidate rejection", (value) => value.mutations.some((item) => item.path.endsWith('/reject')));
  await cdp.replaceText({ selector: ".holon-governance-form input", index: 0 }, "e2e-skill");
  await cdp.replaceText({ selector: ".holon-governance-form input", index: 1 }, "version-parent");
  await cdp.click({ selector: ".holon-governance-form button[type='submit']", text: "准备回滚" });
  await waitFor("rollback confirmation", `document.querySelector('.holon-confirm')?.textContent?.includes('版本回滚')`);
  await cdp.click({ selector: ".holon-confirm button", text: "确认", exact: true });
  await waitRemote("skill rollback", (value) => value.mutations.some((item) => item.path.endsWith('/rollback')));
  await cdp.click({ selector: ".holon-tabs button", text: "私有知识" });
  await cdp.replaceText({ selector: ".holon-search input" }, "e2e");
  await cdp.click({ selector: ".holon-search button[type='submit']", text: "搜索" });
  await waitFor("private knowledge result", `document.querySelector('.holon-list')?.textContent?.includes('knowledge-e2e')`);
  await cdp.click({ selector: ".holon-tabs button", text: "同步与反馈" });
  await cdp.replaceText({ selector: ".holon-feedback-form input", index: 0 }, "e2e-skill");
  await cdp.replaceText({ selector: ".holon-feedback-form input", index: 1 }, "version-e2e");
  await cdp.click({ selector: ".holon-feedback-form button[type='submit']", text: "提交反馈" });
  await cdp.click({ selector: ".holon-feedback-form button[type='submit']", text: "提交反馈" }).catch(() => {});
  const remoteState = await waitRemote("feedback and retried outbox", (value) =>
    value.feedback.length === 1 && value.eventAttempts >= 2
      && value.events.some((event) => event.event_type === "work_item.completed"), 60_000);
  await cdp.click({ selector: ".holon-tabs button", text: "远程任务" });
  await cdp.click({ selector: ".holon-pane button", text: "刷新并领取" });
  await waitFor("second claimed task", `document.querySelector('.holon-work-item')?.textContent?.includes('wi_e2e_002')`);
  await cdp.click({ selector: ".holon-work-item button", text: "放弃任务" });
  await waitFor("discarded task", `document.querySelector('.holon-work-item')?.textContent?.includes('cancelled')`);
  const cancellationState = await waitRemote("durable cancellation", (value) =>
    value.cancelRequests.includes("wi_e2e_002")
      && value.events.some((event) => event.work_item_id === "wi_e2e_002" && event.event_type === "work_item.cancelled"), 30_000);
  const previousPreferences = await evaluate(`window.newbrain.getDesktopPreferences()`);
  await evaluate(`(async () => {
    const preferences = await window.newbrain.getDesktopPreferences();
    await window.newbrain.saveDesktopPreferences({
      ...preferences,
      configuration: { ...preferences.configuration, requireApprovalForShell: true }
    });
  })()`);
  await cdp.click({ selector: ".holon-pane button", text: "刷新并领取" });
  await waitFor("approval task claim", `document.querySelector('.holon-work-item')?.textContent?.includes('wi_e2e_003')`);
  await cdp.click({ selector: ".holon-work-item button", text: "准备执行" });
  await waitFor("approval task confirmation", `Boolean(document.querySelector('.holon-confirm'))`);
  await cdp.click({ selector: ".holon-confirm button", text: "确认执行", exact: true });
  await waitRemote("remote approval tool proposal", (value) => value.approvalToolIssued === true, 30_000);
  await waitFor("remote task approval dialog", `Boolean(document.querySelector('[data-testid="approval-dialog"]'))`, 30_000);
  await cdp.click({ selector: "[data-testid='approval-approve-button']", text: "批准并继续" });
  await waitFor("remote task approval completion", `!document.querySelector('[data-testid="approval-dialog"]')`, 30_000);
  const approvalState = await waitRemote("approval evidence", (value) =>
    value.events.some((event) => event.work_item_id === "wi_e2e_003" && event.event_type === "approval.requested")
      && value.events.some((event) => event.work_item_id === "wi_e2e_003" && event.event_type === "approval.resolved")
      && value.events.some((event) => event.work_item_id === "wi_e2e_003" && event.event_type === "work_item.completed"), 30_000);
  const executionWorkspacePath = await evaluate(`window.newbrain.getSnapshot().then((snapshot) => snapshot.session?.workspacePath || "")`);
  assert.ok(executionWorkspacePath);
  assert.ok(executionWorkspacePath.toLowerCase().startsWith(session.workspacePath.toLowerCase()));
  const approvalArtifact = join(executionWorkspacePath, "holon-remote-approval.txt");
  assert.equal(existsSync(approvalArtifact), true);
  assert.match(readFileSync(approvalArtifact, "utf8"), /HOLON_REMOTE_APPROVAL_OK/);
  unlinkSync(approvalArtifact);
  await evaluate(`window.newbrain.saveDesktopPreferences(${JSON.stringify(previousPreferences)})`);
  assert.ok(remoteState.events.some((event) => event.event_type === "work_item.started"));
  assert.ok(remoteState.events.some((event) => event.event_type === "work_item.completed"));
  assert.ok(remoteState.eventAttempts >= 2);
  assert.equal(remoteState.feedback.length, 1);
  assert.equal(remoteState.mutations.filter((item) => item.path.endsWith("/approve")).length, 1);
  assert.equal(remoteState.mutations.filter((item) => item.path.endsWith("/reject")).length, 1);
  assert.equal(remoteState.mutations.filter((item) => item.path.endsWith("/rollback")).length, 1);
  assert.equal(cancellationState.cancelRequests.filter((id) => id === "wi_e2e_002").length, 1);
  assert.doesNotMatch(JSON.stringify(approvalState.events), /owner_user_id|ownerUserId|HOLON_E2E_COMPLETED|HOLON_REMOTE_APPROVAL_OK|Set-Content/);
  const evidence = { ok: true, input: cdp.inputEvidence(), eventCount: approvalState.events.length, eventAttempts: approvalState.eventAttempts, snapshot: true, candidate: true, search: true, governance: true, feedback: true, cancellation: true, approval: true };
  const evidencePath = fileURLToPath(new URL("../../../integration-artifacts/holon-newbrain/deterministic-electron.json", import.meta.url));
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  cdp?.close();
  session.close();
  server.kill();
}
