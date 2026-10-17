import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

export const CASE_ID = "AUTOMATION-VISIBLE-THREAD-SMOKE-001";

function readFirst(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  throw new Error(`Missing source: ${urls.map((url) => url.pathname).join(" | ")}`);
}

test(`${CASE_ID} a finished automation stays visible in the chat list`, () => {
  const visibility = readFileSync(new URL("../renderer/app/workspace-visibility.ts", import.meta.url), "utf8");
  const sceneChat = visibility.slice(
    visibility.indexOf("export function sceneChatWorkspaces"),
    visibility.indexOf("export function projectSearchResults")
  );
  assert.match(sceneChat, /thread\.scope !== "chat"/);
  assert.match(visibility, /thread\.kind !== "subagent"/);

  const main = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/main/index.ts", import.meta.url),
    new URL("../main/index.ts", import.meta.url)
  ]);
  const scheduled = main.slice(main.indexOf("async function runScheduledAutomation"), main.indexOf("let automationTickQueued"));
  assert.match(scheduled, /const scope = "chat"/);
  assert.doesNotMatch(scheduled, /INTERNAL_CHAT_WORKSPACE_ID \? "chat"/);

  const workspace = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  const openThread = workspace.slice(workspace.indexOf("function openAutomationThread"), workspace.indexOf("async function runAutomationNow"));
  assert.match(openThread, /selectWorkspaceThread\(target\.workspaceId, target\.threadId, \{ force: true \}\)/);
  assert.match(openThread, /这条自动化的对话不在列表里/);
  assert.match(workspace, /data-testid="automation-open-thread"/);
  assert.match(workspace, /查看对话/);
  const runNow = workspace.slice(workspace.indexOf("async function runAutomationNow"), workspace.indexOf("async function deleteAutomation"));
  assert.match(runNow, /const scope = "chat"/);
});
