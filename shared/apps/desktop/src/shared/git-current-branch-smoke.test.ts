import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

export const CASE_ID = "GIT-CURRENT-BRANCH-SMOKE-001";

function readFirst(urls: URL[]) {
  for (const url of urls) {
    if (existsSync(url)) return readFileSync(url, "utf8");
  }
  throw new Error(`Missing source: ${urls.map((url) => url.pathname).join(" | ")}`);
}

test(`${CASE_ID} the status line shows the current git branch and hides a failed lookup`, () => {
  const main = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/main/index.ts", import.meta.url),
    new URL("../main/index.ts", import.meta.url)
  ]);
  const header = main.slice(main.indexOf("async function getWorkspaceHeaderStatus"), main.indexOf("async function getWorkspaceReviewChanges"));
  assert.match(header, /\["branch", "--show-current"\]/);
  assert.match(header, /branch: branchResult\.status === 0 \? \(branchResult\.stdout\?\.trim\(\) \|\| ""\) : ""/);
  assert.doesNotMatch(header, /\|\| "main"/);

  const ui = readFirst([
    new URL("../../../../../platforms/windows/apps/desktop/src/renderer/ui.tsx", import.meta.url),
    new URL("../renderer/ui.tsx", import.meta.url)
  ]);
  const headerState = ui.slice(ui.indexOf("const [workspaceHeaderStatus, setWorkspaceHeaderStatus]"), ui.indexOf("const [workspaceStatusSubmenu"));
  assert.match(headerState, /branch: ""/);
  assert.doesNotMatch(headerState, /branch: "main"/);
  assert.match(ui, /setWorkspaceHeaderStatus\(\(current\) => \(\{ \.\.\.current, branch: "" \}\)\)/);
  assert.match(ui, /workspaceHeaderStatus\.branch \? \(/);
  assert.match(ui, /当前分支：\$\{workspaceBranches\.current\}/);
  assert.match(ui, /当前分支：\(detached HEAD\)/);

  const workspace = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  const picker = workspace.slice(workspace.indexOf("new-chat-project-picker"), workspace.indexOf("new-chat-integrations"));
  assert.match(picker, /workspaceHeaderStatus\?\.branch \|\| newChatBranches\.current/);
  assert.match(picker, /当前分支：\(detached HEAD\)/);
  assert.doesNotMatch(picker, /\|\| "main"/);
});
