import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";

const c = await createSceneTestCdpClient(9356);
await c.waitForAppReady();
const s = await c.evaluate(`(() => ({
  bodyTail: document.body.innerText.slice(-4500),
  hasMarker: document.body.innerText.includes('DATA-LOOP-002'),
  hasApprove: [...document.querySelectorAll('button')].some(b => /批准/.test(b.textContent||'')),
  buttons: [...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>(b.textContent||'').trim().slice(0,48)).filter(Boolean).slice(0,50),
  composer: (document.querySelector('[data-testid="composer-input"]')?.value||'').slice(0,240),
  composerLen: (document.querySelector('[data-testid="composer-input"]')?.value||'').length,
  sendDisabled: Boolean(document.querySelector('[data-testid="composer-send-button"]')?.disabled),
  julius: document.querySelector('[data-testid="brain-data-julius-shell"]')?.innerText?.slice(0,1200)||'',
  dataWs: document.querySelector('[data-testid="brain-data-workspace"]')?.innerText?.slice(0,1200)||'',
  salesQ3: /sales_q3/.test(document.body.innerText),
  scene: (()=>{try{return JSON.parse(localStorage.getItem('brain.workspaceSelection.v2')||'{}')}catch{return{}}})()
}))()`);
const meta = await c.evaluate(`(async () => {
  const projects = await window.codecn.listBrainProjects({ workspaceKey: 'data' });
  const out = [];
  for (const p of (projects||[]).slice(0,10)) {
    const files = await window.codecn.listBrainFiles({ projectId: p.id }).catch(()=>[]);
    const datasets = await window.codecn.listDataDatasets({ projectId: p.id }).catch(()=>[]);
    out.push({
      name: p.name,
      id: p.id,
      localWorkspaceId: p.localWorkspaceId,
      fileCount: files.length,
      files: files.slice(0,8).map(f => f.logicalName || f.name || f.storageKey),
      datasets: datasets.map(d => ({ id:d.id, name:d.name, rows:d.rowCount, cols:d.columnCount }))
    });
  }
  return out;
})()`);
console.log(JSON.stringify({ s, meta }, null, 2));
await c.close({ keepProcess: true });
