import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile, readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const caseId = "DATA-E2E-REAL-002";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const debugPort = 9356;
const projectName = "区域季度经营分析-E2E-1787622968401自动化";
const projectIdNeedle = "1787622968401";
const evidenceDir = `evidence/${caseId}/${stamp}`;
const marker = `DATA-COOK-004-${Date.now()}`;
const projectRoot = join(homedir(), ".codecn", ".codecn", "projects", projectName);
await mkdir(evidenceDir, { recursive: true });

// Remove prior cook outputs so chat must recreate them
await rm(join(projectRoot, "Docs", "BRAIN", "analysis.json"), { force: true });
await rm(join(projectRoot, ".brain-data", "manifest.json"), { force: true });

const prompt = `${marker}
只调用右侧数据 Tools，不要写 Python、不要 shell 绕过：
1) data.dataset.list 确认 regional-quarterly-ops 数据集仍在
2) 必须调用 data.analysis.cook 导出 Docs/BRAIN/analysis.json 与 .brain-data/manifest.json
3) 报告工具原始返回（成功或错误码），禁止声称跨盘无法写入而不调用工具
`;

async function activateWindow() {
  try { await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]); } catch {}
}
async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }
async function shot(client, name) {
  const result = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `${evidenceDir}/${name}.png`;
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}
async function state(client) {
  return client.evaluate(`(() => ({
    body: document.body.innerText.slice(0, 28000),
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => ({ text: x.textContent?.trim()?.slice(0, 60), testid: x.dataset.testid || '' })).slice(0, 200),
    julius: document.querySelector('[data-testid="brain-data-julius-shell"]')?.innerText?.slice(0, 2500) || '',
    salesQ3: /sales_q3\\.csv/.test(document.body.innerText)
  }))()`);
}
async function cdpClick(client, x, y) {
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(150);
}
async function clickText(client, text) {
  const p = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('button,a,[role=button]')].find(n => (n.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)}) && n.offsetParent && n.getBoundingClientRect().width < 800);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  assert.ok(p, `missing ${text}`);
  await activateWindow();
  await cdpClick(client, p.x, p.y);
  return { at: new Date().toISOString(), method: "CDP", target: text, ...p };
}
async function clickSelector(client, selector) {
  const p = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const padX = el.tagName === 'TEXTAREA' ? 24 : r.width/2;
    const padY = el.tagName === 'TEXTAREA' ? 12 : r.height/2;
    return { x: Math.round(r.left + padX), y: Math.round(r.top + padY) };
  })()`);
  assert.ok(p, selector);
  await activateWindow();
  await cdpClick(client, p.x, p.y);
  return { at: new Date().toISOString(), method: "CDP", target: selector, ...p };
}
async function pasteComposer(client, text) {
  for (let i = 0; i < 3; i++) await osPressEscape();
  await clickSelector(client, '[data-testid="composer-input"]');
  const ok = await client.evaluate(`(() => {
    const el = document.querySelector('[data-testid="composer-input"]');
    if (!(el instanceof HTMLTextAreaElement)) return false;
    const last = el.value;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, ${JSON.stringify(text)});
    el._valueTracker?.setValue(last);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value.includes(${JSON.stringify(marker)});
  })()`);
  assert.ok(ok, "composer set failed");
}
async function submitComposer(client) {
  await client.waitFor(`!document.querySelector('[data-testid="composer-send-button"]')?.disabled`, 10_000);
  await client.evaluate(`document.querySelector('[data-testid="composer-send-button"]')?.click()`);
}
async function listCookFiles() {
  const out = [];
  async function walk(dir, d = 0) {
    if (d > 5) return;
    for (const name of await readdir(dir).catch(() => [])) {
      const full = join(dir, name);
      try {
        const s = await stat(full);
        if (s.isDirectory()) await walk(full, d + 1);
        else if (/analysis\.json|manifest\.json|regional-quarterly/i.test(name) && s.size > 0) out.push({ path: full, size: s.size });
      } catch {}
    }
  }
  await walk(projectRoot);
  return out;
}

const client = await createSceneTestCdpClient(debugPort);
const evidence = { caseId, startedAt: new Date().toISOString(), projectName, marker, prompt, actions: [], assertions: [], checkpoints: [], result: "FAIL" };
try {
  await client.waitForAppReady();
  await activateWindow();
  evidence.checkpoints.push(await shot(client, "00-start"));

  const scene = await client.evaluate(`(() => { try { return JSON.parse(localStorage.getItem('brain.workspaceSelection.v2')||'{}').selectedWorkspaceKey; } catch { return ''; } })()`);
  if (scene !== "data") {
    evidence.actions.push(await clickSelector(client, ".brain-workspace-trigger"));
    await client.waitFor("Boolean(document.querySelector('.brain-workspace-menu')?.offsetParent)", 10_000);
    evidence.actions.push(await clickText(client, "数据与决策"));
    await sleep(800);
  }
  try { evidence.actions.push(await clickText(client, "显示更多")); await sleep(400); } catch {}
  const hit = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find(n => (n.textContent||'').includes(${JSON.stringify(projectIdNeedle)}) && n.offsetParent);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  if (hit) {
    await cdpClick(client, hit.x, hit.y);
    evidence.actions.push({ at: new Date().toISOString(), method: "CDP", target: "project", ...hit });
    await sleep(1000);
  }
  evidence.checkpoints.push(await shot(client, "01-project"));

  await pasteComposer(client, prompt);
  evidence.checkpoints.push(await shot(client, "02-prompt"));
  await submitComposer(client);
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(marker)}) && !((document.querySelector('[data-testid="composer-input"]')?.value||'').includes(${JSON.stringify(marker)}))`, 60_000);
  evidence.assertions.push({ name: "prompt submitted", pass: true });
  evidence.checkpoints.push(await shot(client, "03-submitted"));

  let capture = 4;
  let approvalCount = 0;
  let lastBody = "";
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await sleep(6_000);
    const cur = await state(client);
    lastBody = cur.body || "";
    const approval = cur.buttons.find((b) => b.text === "批准并继续" || b.text === "批准");
    if (approval) {
      evidence.checkpoints.push(await shot(client, `${String(capture++).padStart(2, "0")}-approval`));
      evidence.actions.push(await clickText(client, approval.text));
      approvalCount += 1;
      await sleep(1200);
    }
    if (capture % 2 === 0) evidence.checkpoints.push(await shot(client, `${String(capture++).padStart(2, "0")}-progress`));
    else capture++;
    evidence.progress = { slice: lastBody.slice(-3500), approvalCount };
    await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
    const busy = cur.buttons.some((b) => /停止|取消/.test(b.text || ""));
    const send = cur.buttons.some((b) => b.testid === "composer-send-button");
    const cookedOk = /exportedFiles|Docs\/BRAIN\/analysis\.json|data\.analysis\.cook[\s\S]{0,80}成功|manifest\.json/i.test(lastBody)
      && !/BRAIN_CORE_PATH_ESCAPE/.test(lastBody.slice(-2000));
    if (send && !busy && (cookedOk || approvalCount > 0) && Date.now() - Date.parse(evidence.startedAt) > 40_000) {
      // keep waiting a bit more if cook not yet confirmed on disk
      const files = await listCookFiles();
      if (files.some((f) => /Docs[\\/]+BRAIN[\\/]+analysis\.json$/i.test(f.path))) break;
      if (cookedOk && Date.now() - Date.parse(evidence.startedAt) > 90_000) break;
    }
    if (send && !busy && Date.now() - Date.parse(evidence.startedAt) > 9 * 60_000) break;
  }

  evidence.after = await state(client);
  evidence.checkpoints.push(await shot(client, "40-after"));
  for (const tab of ["Julius", "数据导入", "图表"]) {
    try {
      evidence.actions.push(await clickText(client, tab));
      await sleep(600);
      evidence.checkpoints.push(await shot(client, `41-${tab}`));
    } catch {}
  }

  await client.command("Page.reload", { ignoreCache: true });
  await client.waitForAppReady();
  await activateWindow();
  await sleep(2000);
  evidence.metaReload = await client.evaluate(`(async () => {
    const projects = await window.codecn.listBrainProjects({ workspaceKey: 'data' });
    const match = (projects||[]).find(p => (p.name||'').includes(${JSON.stringify(projectIdNeedle)}));
    if (!match) return { ok:false };
    const files = await window.codecn.listBrainFiles({ projectId: match.id }).catch(()=>[]);
    const datasets = await window.codecn.listDataDatasets({ projectId: match.id }).catch(()=>[]);
    return { ok:true, files, datasets };
  })()`);
  evidence.checkpoints.push(await shot(client, "71-reload"));

  const cookFiles = await listCookFiles();
  evidence.cookFiles = cookFiles;
  evidence.approvalCount = approvalCount;
  const hasDocsAnalysis = cookFiles.some((f) => /Docs[\\/]+BRAIN[\\/]+analysis\.json$/i.test(f.path) && f.size > 0);
  const hasManifest = cookFiles.some((f) => /\.brain-data[\\/]+manifest\.json$/i.test(f.path) && f.size > 0);
  const hasDataset = (evidence.metaReload?.datasets || []).some((d) => (d.rowCount || 0) > 0);
  const hasRealCsv = (evidence.metaReload?.files || []).some((f) => /regional-quarterly/i.test(f.logicalName || ""));
  const noPrototype = !evidence.after?.salesQ3;
  const toolsUsed = approvalCount > 0 || /data\.analysis\.cook|data\.dataset\.list/i.test(lastBody);
  const noPathEscape = !/BRAIN_CORE_PATH_ESCAPE/.test(lastBody);
  evidence.gradeSignals = { hasDocsAnalysis, hasManifest, hasDataset, hasRealCsv, noPrototype, toolsUsed, noPathEscape, approvalCount };

  if (hasDocsAnalysis && hasManifest && hasDataset && toolsUsed && noPrototype && noPathEscape) evidence.result = "PASS";
  else if (hasDataset || hasRealCsv || toolsUsed) {
    evidence.result = "PARTIAL";
    evidence.firstFailure = `Incomplete: ${JSON.stringify(evidence.gradeSignals)}`;
  } else {
    evidence.result = "FAIL";
    evidence.firstFailure = `No data loop: ${JSON.stringify(evidence.gradeSignals)}`;
  }
  evidence.assertions.push(
    { name: "Docs/BRAIN/analysis.json", pass: hasDocsAnalysis },
    { name: ".brain-data/manifest.json", pass: hasManifest },
    { name: "dataset persisted", pass: hasDataset },
    { name: "no sales_q3", pass: noPrototype },
    { name: "no PATH_ESCAPE", pass: noPathEscape },
    { name: "tools used", pass: toolsUsed }
  );
  evidence.checkpoints.push(await shot(client, "99-final"));
} catch (error) {
  evidence.firstFailure = error instanceof Error ? error.stack || error.message : String(error);
  try { evidence.checkpoints.push(await shot(client, "98-failure")); evidence.failure = await state(client); } catch {}
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  await writeFile(`${evidenceDir}/SUMMARY.md`, `# ${caseId}\n\n- result: **${evidence.result}**\n- project: ${projectName}\n- marker: ${marker}\n- approvals: ${evidence.approvalCount || 0}\n- grade: \`${JSON.stringify(evidence.gradeSignals || {})}\`\n- firstFailure: ${evidence.firstFailure || "none"}\n- fix: path_policy.writable allows nested missing parents for Docs/BRAIN cook\n`, "utf8");
  console.log(JSON.stringify({ evidenceDir, result: evidence.result, firstFailure: evidence.firstFailure, gradeSignals: evidence.gradeSignals, approvals: evidence.approvalCount, cookFiles: evidence.cookFiles }, null, 2));
  await client.close({ keepProcess: true });
}
