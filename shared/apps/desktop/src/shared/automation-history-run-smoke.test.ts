/**
 * AUTOMATION-HISTORY-RUN-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * An automation run stays on its Codex target thread, so history and execution
 * are the same conversation.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { codexAutomationSendPlan } from "./automation-run-history.ts";

export const CASE_ID = "AUTOMATION-HISTORY-RUN-SMOKE-001";

function brainSourceRoot() {
  const envRoot = String(process.env.NEWBRAIN_SOURCE_ROOT || "").trim();
  if (envRoot && existsSync(path.join(envRoot, "platforms", "windows"))) return envRoot;
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(current, "platforms", "windows")) && existsSync(path.join(current, "shared"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function readFirst(candidates: Array<string | URL>) {
  for (const candidate of candidates) {
    const filePath = candidate instanceof URL ? fileURLToPath(candidate) : candidate;
    if (existsSync(filePath)) return readFileSync(filePath, "utf8");
  }
  throw new Error(`Missing source: ${candidates.map((item) => String(item)).join(" | ")}`);
}

test(`${CASE_ID} a run appends to the bound thread instead of starting another conversation`, () => {
  assert.deepEqual(codexAutomationSendPlan({
    boundWorkspaceId: "internal-chat",
    boundThreadId: "thread-1",
    snapshotHasThread: true,
    threadJustEnsured: false
  }), { appendToBoundThread: true });
  assert.deepEqual(codexAutomationSendPlan({
    boundWorkspaceId: "internal-chat",
    boundThreadId: "thread-1",
    snapshotHasThread: false,
    threadJustEnsured: true
  }), { appendToBoundThread: true });
  assert.deepEqual(codexAutomationSendPlan({
    boundWorkspaceId: "internal-chat",
    boundThreadId: "",
    snapshotHasThread: false,
    threadJustEnsured: true
  }), { appendToBoundThread: false });
  assert.deepEqual(codexAutomationSendPlan({
    boundWorkspaceId: "internal-chat",
    boundThreadId: "missing",
    snapshotHasThread: false,
    threadJustEnsured: false
  }), { appendToBoundThread: false });
});

test(`${CASE_ID} desktop run and history stay on that target thread`, () => {
  const workspace = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  const runNow = workspace.slice(workspace.indexOf("async function runAutomationNow"), workspace.indexOf("async function deleteAutomation"));
  assert.match(runNow, /pinnedThreadEnsured: true/);
  assert.match(runNow, /targetThreadId: threadId/);
  assert.match(runNow, /handleThreadMenuAction\("pin"/);
  const history = workspace.slice(workspace.indexOf("function openAutomationThread"), workspace.indexOf("async function runAutomationNow"));
  assert.match(history, /selectWorkspaceThread\(target\.workspaceId, target\.threadId, \{ force: true \}\)/);
  assert.match(workspace, /历史对话/);

  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root with platforms/windows must be resolvable");
  const sources = [
    readFirst([
      new URL("../renderer/ui.tsx", import.meta.url),
      path.join(root, "platforms", "windows", "apps", "desktop", "src", "renderer", "ui.tsx")
    ]),
    readFirst([
      path.join(root, "platforms", "macos", "common", "apps", "desktop", "src", "renderer", "ui.tsx")
    ]),
    readFirst([
      path.join(root, "platforms", "ubuntu", "common", "apps", "desktop", "src", "renderer", "ui.tsx")
    ])
  ];
  for (const source of sources) {
    const ask = source.slice(source.indexOf("async function askModel"), source.indexOf("async function cancelCurrentModelRequest"));
    assert.match(ask, /codexAutomationSendPlan/);
    assert.match(ask, /pinnedThreadEnsured/);
    assert.match(ask, /appendToBoundThread/);
  }
});
