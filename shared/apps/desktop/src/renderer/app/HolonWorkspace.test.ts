import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Holon workspace provides five operational views and explicit execution confirmation", async () => {
  const source = await readFile(new URL("./HolonWorkspace.tsx", import.meta.url), "utf8");
  for (const label of ["远程任务", "知识快照", "学习候选", "私有知识", "同步与反馈"]) assert.match(source, new RegExp(label));
  assert.match(source, /确认执行/);
  assert.match(source, /startWorkItem/);
  assert.match(source, /workItem\.workItem\.knowledgeSnapshotId/);
  assert.match(source, /workItem\.workItem\.executionPolicyVersion/);
  assert.match(source, /workItem\.effectiveToolNames/);
  assert.doesNotMatch(source, /fetch\(|ipcRenderer|ownerUserId|owner_user_id/);
});

test("Holon workspace exposes explicit resume and discard controls for durable tasks", async () => {
  const source = await readFile(new URL("./HolonWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /cancelWorkItem/);
  assert.match(source, /放弃任务/);
  assert.match(source, /恢复执行/);
  assert.match(source, /status === "interrupted"/);
});

test("Holon workspace polls running work and exposes the standard approval controls", async () => {
  const source = await readFile(new URL("./HolonWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /getWorkItemState\(\{ workItemId: workItem\.workItem\.id \}\)/);
  assert.match(source, /setWorkItem\(\{ \.\.\.startingWorkItem, status: "running" \}\)/);
  assert.match(source, /workItem\.status === "waiting_approval"/);
  assert.match(source, /workItem\.status === "running" \|\| workItem\.status === "waiting_approval"/);
  assert.match(source, /data-testid="approval-dialog"/);
  assert.match(source, /requestId: `holon-\$\{workItem\.workItem\.id\}`/);
  assert.match(source, /data-testid="approval-approve-button"/);
  assert.match(source, /data-testid="approval-reject-button"/);
});

test("learning candidates render a bounded change preview instead of raw server records", async () => {
  const source = await readFile(new URL("./HolonWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /formatCandidateDiff/);
  assert.match(source, /candidate\.parentVersionId/);
  assert.doesNotMatch(source, /item\.version_id \?\?/);
});

test("sync view surfaces quarantined conflicts instead of hiding them as offline retries", async () => {
  const source = await readFile(new URL("./HolonWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /quarantinedEventCount/);
  assert.match(source, /隔离事件/);
});

test("feedback submission keeps one idempotency key and disables duplicate clicks while pending", async () => {
  const source = await readFile(new URL("./HolonWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /disabled=\{busy === "feedback"\}/);
  assert.match(source, /idempotencyKey: feedbackKey/);
  assert.match(source, /feedbackSubmittingRef\.current/);
  assert.match(source, /safetyViolation: feedbackSafetyViolation/);
  assert.match(source, /setFeedbackSafetyViolation/);
});

test("logout unmounts Holon renderer state without deleting the durable outbox", async () => {
  const [uiSource, mainSource] = await Promise.all([
    readFile(new URL("../ui.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../main/index.ts", import.meta.url), "utf8")
  ]);
  assert.match(uiSource, /if \(!isAuthenticated\) \{[\s\S]{0,240}<LoginScreen/);
  const logoutStart = mainSource.indexOf("async function logoutDesktopAuth()");
  const logoutEnd = mainSource.indexOf("async function discoverWorkspaceSkillSpecs", logoutStart);
  assert.ok(logoutStart >= 0 && logoutEnd > logoutStart);
  const logoutSource = mainSource.slice(logoutStart, logoutEnd);
  assert.match(logoutSource, /writeDesktopAuthState\(null\)/);
  assert.doesNotMatch(logoutSource, /remote_event_outbox|remote_work_items|recoverRemoteExecutionState/);
});
