import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";

const debugPort = Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9356);
const client = await createSceneTestCdpClient(debugPort);
try {
  await client.waitForAppReady();
  const state = await client.evaluate(`(() => ({
    title: document.title,
    workspace: (() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r?JSON.parse(r):null; } catch { return null; } })(),
    bodyHead: document.body.innerText.slice(0, 2500),
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => (x.textContent||'').replace(/\\s+/g,' ').trim()).filter(Boolean).slice(0, 80),
    sceneTabs: [...document.querySelectorAll('.brain-resource-scene-nav button')].map(x => x.textContent?.trim()),
    globalTabs: [...document.querySelectorAll('.brain-resource-global-nav button')].map(x => x.textContent?.trim()),
    hasComposer: Boolean(document.querySelector('[data-testid="composer-input"]')),
    hasSend: Boolean(document.querySelector('[data-testid="composer-send-button"]')),
    docWorkspace: document.querySelector('[data-testid="brain-document-workspace"]')?.innerText?.slice(0, 1500) || null
  }))()`);
  console.log(JSON.stringify(state, null, 2));
} finally {
  await client.close({ keepProcess: true });
}
