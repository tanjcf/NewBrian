import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const debugPort = Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9356);
const projectHint = "基层治理数字化-E2E-1787626335302";
const client = await createSceneTestCdpClient(debugPort);

async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }
async function cdpClick(x, y) {
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

try {
  await client.waitForAppReady();
  for (let i = 0; i < 4; i++) { await osPressEscape(); await sleep(120); }

  const scene = await client.evaluate(`(() => { try { return JSON.parse(localStorage.getItem('brain.workspaceSelection.v2')||'null'); } catch { return null; } })()`);
  if (scene?.selectedWorkspaceKey !== "document") {
    const trigger = await client.evaluate(`(() => { const el=document.querySelector('.brain-workspace-trigger'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    if (trigger) {
      await cdpClick(trigger.x, trigger.y);
      await sleep(400);
      const item = await client.evaluate(`(() => { const el=[...document.querySelectorAll('.brain-workspace-menu button')].find(n=>n.textContent.includes('文档创作')); if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
      if (item) await cdpClick(item.x, item.y);
      await sleep(800);
    }
  }

  const projectHit = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find(n => (n.textContent||'').includes(${JSON.stringify(projectHint)}));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: el.textContent?.trim()?.slice(0,80) };
  })()`);
  if (projectHit) {
    await cdpClick(projectHit.x, projectHit.y);
    await sleep(1000);
  }

  // Trigger sync via a short chat so configureRuntime registers wrappers + auto-sync
  const composer = await client.evaluate(`(() => { const el=document.querySelector('[data-testid="composer-input"]'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+20),y:Math.round(r.top+10)}; })()`);
  assertComposer(composer);
  await cdpClick(composer.x, composer.y);
  await sleep(200);
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.insertText", { text: "请只调用 document.project.sync_outputs，把 outputs 下已有 PDF/DOCX/PPTX 同步到右侧文件与产物，然后简短确认数量。" });
  await sleep(300);
  const send = await client.evaluate(`(() => { const el=document.querySelector('[data-testid="composer-send-button"]'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
  if (send) await cdpClick(send.x, send.y);

  const deadline = Date.now() + 180_000;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(5000);
    // Approve if needed
    const approval = await client.evaluate(`(() => {
      const btn=[...document.querySelectorAll('button')].find(n=>n.offsetParent && (n.textContent||'').trim()==='批准并继续' || (n.textContent||'').trim()==='批准');
      if(!btn) return null; const r=btn.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),text:btn.textContent.trim()};
    })()`);
    if (approval) await cdpClick(approval.x, approval.y);

    last = await client.evaluate(`(async () => {
      const body = document.body.innerText.slice(0, 8000);
      const globalTabs = [...document.querySelectorAll('.brain-resource-global-nav button')].map(x => x.textContent?.trim());
      let meta = null;
      try {
        const projects = await window.codecn.listBrainProjects({ workspaceKey: 'document' });
        const match = (projects||[]).find(p => (p.name||'').includes('1787626335302'));
        if (match) {
          const files = await window.codecn.listBrainFiles({ projectId: match.id });
          const artifacts = await window.codecn.listBrainArtifacts({ projectId: match.id });
          meta = { projectId: match.id, files: (files||[]).map(f=>f.logicalName||f.storageKey), artifacts: (artifacts||[]).map(a=>a.storageKey) };
        }
      } catch (error) { meta = { error: String(error) }; }
      const busy = [...document.querySelectorAll('button')].some(b => /停止|取消/.test(b.textContent||''));
      const sendVisible = Boolean(document.querySelector('[data-testid="composer-send-button"]')?.offsetParent);
      return { globalTabs, meta, busy, sendVisible, bodyTail: body.slice(-1500) };
    })()`);
    if (last?.meta?.files?.length > 0) break;
    if (last?.sendVisible && !last?.busy && /sync_outputs|已同步|文件/.test(last?.bodyTail || "")) break;
  }
  console.log(JSON.stringify(last, null, 2));
} finally {
  await client.close({ keepProcess: true });
}

function assertComposer(value) {
  if (!value) throw new Error("composer missing");
}
