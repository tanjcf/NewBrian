import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";

const c = await createSceneTestCdpClient(9356);
const info = await c.evaluate(`(async () => {
  const workspaces = await window.codecn?.listWorkspaces?.() || [];
  const awaiting = [];
  for (const ws of workspaces) {
    for (const t of (ws.threads || [])) {
      if (t.status === "awaiting-approval" || /等待/.test(String(t.statusLabel || ""))) {
        awaiting.push({
          workspaceId: ws.id,
          workspaceName: ws.name,
          threadId: t.id,
          title: (t.title || "").slice(0, 80),
          status: t.status,
          statusLabel: t.statusLabel
        });
      }
    }
  }
  const selected = (() => {
    try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2") || "{}"); } catch { return {}; }
  })();
  return {
    selected,
    awaitingCount: awaiting.length,
    awaiting,
    currentChatSnippet: document.body.innerText.includes("已处理") ? "shows 已处理" : "no 已处理",
    hasApprovalDialog: Boolean(document.querySelector('[data-testid="conversation-approval-dialog"]'))
  };
})()`);
console.log(JSON.stringify(info, null, 2));
await c.close({ keepProcess: true });
