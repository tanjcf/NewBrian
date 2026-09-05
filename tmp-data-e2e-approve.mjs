import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const evidenceDir = `evidence/DATA-E2E-REAL-001-APPROVE/${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(evidenceDir, { recursive: true });
await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]);
const client = await createSceneTestCdpClient(9356);
await client.waitForAppReady();

async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }
async function shot(name) {
  const result = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `${evidenceDir}/${name}.png`;
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}
async function cdpClick(x, y) {
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

const evidence = { caseId: "DATA-E2E-REAL-001-APPROVE", startedAt: new Date().toISOString(), actions: [], checkpoints: [], result: "PARTIAL" };
evidence.checkpoints.push(await shot("00-start"));

for (let i = 0; i < 8; i++) {
  const btn = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === '批准并继续' && b.offsetParent);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) };
  })()`);
  if (!btn) break;
  evidence.checkpoints.push(await shot(`${String(i).padStart(2,"0")}-before-approve`));
  await cdpClick(btn.x, btn.y);
  evidence.actions.push({ at: new Date().toISOString(), target: "批准并继续", ...btn });
  await sleep(8000);
}

evidence.checkpoints.push(await shot("99-after-approvals"));
evidence.final = await client.evaluate(`({
  body: document.body.innerText.slice(0, 12000),
  datasetsHint: document.querySelector('[data-testid="brain-data-workspace"]')?.innerText?.slice(0,2000) || '',
  chart: Boolean(document.querySelector('[data-testid="brain-data-chart"]'))
})`);
evidence.meta = await client.evaluate(`(async () => {
  const projects = await window.codecn.listBrainProjects({ workspaceKey:'data' });
  const p = (projects||[]).find(x => (x.name||'').includes('1787620449725'));
  if (!p) return null;
  const files = await window.codecn.listBrainFiles({ projectId: p.id }).catch(()=>[]);
  const datasets = await window.codecn.listDataDatasets({ projectId: p.id }).catch(()=>[]);
  return { files, datasets };
})()`);
const hasData = (evidence.meta?.datasets || []).length > 0;
evidence.result = hasData ? "PARTIAL" : "PARTIAL";
evidence.finishedAt = new Date().toISOString();
await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
console.log(JSON.stringify({ evidenceDir, result: evidence.result, approvals: evidence.actions.length, datasets: evidence.meta?.datasets?.length || 0, files: evidence.meta?.files?.length || 0 }, null, 2));
await client.close({ keepProcess: true });
