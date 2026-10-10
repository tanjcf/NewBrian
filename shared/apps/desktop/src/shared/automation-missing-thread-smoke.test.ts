import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { planAutomationThreadTarget } from "./automation-thread-recovery.ts";

export const CASE_ID = "AUTOMATION-MISSING-THREAD-SMOKE-001";

function readFirst(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  throw new Error(`Missing source: ${urls.map((url) => url.pathname).join(" | ")}`);
}

test(`${CASE_ID} a missing automation thread is recreated and the task still runs`, () => {
  assert.deepEqual(planAutomationThreadTarget({
    boundWorkspaceId: "ws-1",
    boundThreadId: "thread-1",
    workspaceExists: true,
    threadExists: true,
    fallbackWorkspaceId: "internal-chat"
  }), { workspaceId: "ws-1", createThread: false });
  assert.deepEqual(planAutomationThreadTarget({
    boundWorkspaceId: "ws-1",
    boundThreadId: "deleted-thread",
    workspaceExists: true,
    threadExists: false,
    fallbackWorkspaceId: "internal-chat"
  }), { workspaceId: "ws-1", createThread: true });
  assert.deepEqual(planAutomationThreadTarget({
    boundWorkspaceId: "gone",
    boundThreadId: "deleted-thread",
    workspaceExists: false,
    threadExists: false,
    fallbackWorkspaceId: "internal-chat"
  }), { workspaceId: "internal-chat", createThread: true });

  const ui = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx", import.meta.url),
    new URL("../renderer/ui.tsx", import.meta.url)
  ]);
  const pinned = ui.slice(ui.indexOf("if (pinnedWorkspaceId && pinnedThreadId)"), ui.indexOf("A selected-thread object can be stale"));
  assert.match(pinned, /planAutomationThreadTarget\(/);
  assert.match(pinned, /composingNewThread = true/);
  assert.match(pinned, /正在新建线程并执行任务/);
  assert.doesNotMatch(pinned, /自动化绑定的对话线程不存在/);
  assert.doesNotMatch(pinned, /return "missing-thread"/);

  const main = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/main/index.ts", import.meta.url),
    new URL("../main/index.ts", import.meta.url)
  ]);
  const scheduled = main.slice(main.indexOf("async function runScheduledAutomation"), main.indexOf("let automationTickQueued"));
  assert.match(scheduled, /planAutomationThreadTarget\(/);
  assert.match(scheduled, /workspaceThreadLifecycleService\.add\(/);
  assert.match(scheduled, /threadId: createdThread\.id/);

  const workspace = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  const runNow = workspace.slice(workspace.indexOf("async function runAutomationNow"), workspace.indexOf("async function deleteAutomation"));
  assert.match(runNow, /planAutomationThreadTarget\(/);
  assert.match(runNow, /addWorkspaceThread\(/);
  assert.match(runNow, /persistAutomation\(item, \{ workspaceId, threadId \}\)/);
  assert.match(runNow, /targetThreadId: threadId/);
});
