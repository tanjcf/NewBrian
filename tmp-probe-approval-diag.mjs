import { writeFile } from "node:fs/promises";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";

const c = await createSceneTestCdpClient(9356);
const detail = await c.evaluate(`(async () => {
  const snap = await window.codecn?.getSessionSnapshot?.() || null;
  const threads = [];
  try {
    const workspaces = await window.codecn?.listWorkspaces?.() || [];
    for (const ws of workspaces.slice(0, 20)) {
      for (const t of (ws.threads || []).slice(0, 30)) {
        if (/await|批准|审核|pending|running/i.test(JSON.stringify(t))) {
          threads.push({
            workspaceId: ws.id,
            id: t.id,
            title: t.title,
            status: t.status,
            statusLabel: t.statusLabel,
            lastEventSummary: t.lastEventSummary
          });
        }
      }
    }
  } catch (error) {
    threads.push({ error: String(error) });
  }
  const composerPerm = document.querySelector('.composer-permission, [data-testid*="permission"], button') 
    ? [...document.querySelectorAll('button')].filter(b => /替我审批|完全访问|Ask|审批/.test(b.textContent||'')).map(b => (b.textContent||'').replace(/\\s+/g,' ').trim()).slice(0,10)
    : [];
  return {
    approval: snap?.approval || null,
    pendingTool: snap?.pendingTool || null,
    session: snap?.session || null,
    suspiciousThreads: threads.slice(0, 20),
    composerPermButtons: composerPerm,
    liveStatusText: [...document.querySelectorAll('.conversation-turn, .chat-turn, [class*=turn]')].slice(-3).map(el => (el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,300))
  };
})()`);
await writeFile("evidence/SOFTWARE-AUTOMATION-E2E/approval-diag.json", JSON.stringify(detail, null, 2));
console.log(JSON.stringify(detail, null, 2));
await c.close({ keepProcess: true });
