import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile, readdir, stat } from "node:fs/promises";
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
const evidenceDir = `evidence/${caseId}/${stamp}`;
const csvPath = join(process.cwd(), "evidence/DATA-E2E-REAL-001/2026-08-25T01-14-09-724Z/fixtures/regional-quarterly-ops.csv");
const marker = `DATA-LOOP-003-${Date.now()}`;
await mkdir(evidenceDir, { recursive: true });

const prompt = `${marker}
请在当前「数据与决策」项目完成真实闭环（禁止 sales_q3，禁止只写方案）：
1) 若尚未登记：data.file.import_local absolutePath="${csvPath.replace(/\\/g, "/")}" autoImportDataset=true datasetName="区域季度经营分析"
2) data.dataset.list 与 data.dataset.read_rows
3) data.analysis.summarize
4) data.analysis.aggregate groupBy=["region"] metrics=[{"column":"revenue","operation":"sum"}] periodColumn="quarter" compareMetric="revenue" topN=4
5) data.analysis.save fileName="区域季度经营分析" insight写决策建议
6) 必须调用 data.analysis.cook 导出 Docs/BRAIN/analysis.json
每步报告工具返回。`;

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
    body: document.body.innerText.slice(0, 32000),
    composerLen: (document.querySelector('[data-testid="composer-input"]')?.value || '').length,
    julius: document.querySelector('[data-testid="brain-data-julius-shell"]')?.innerText?.slice(0, 3500) || '',
    dataWs: document.querySelector('[data-testid="brain-data-workspace"]')?.innerText?.slice(0, 3500) || '',
    chartPresent: Boolean(document.querySelector('[data-testid="brain-data-chart"],[data-testid="brain-data-julius-chart"], svg, canvas')),
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => ({ text: x.textContent?.trim()?.slice(0, 60), testid: x.dataset.testid || '' })).slice(0, 200)
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
async function clickSceneTab(client, label) {
  const p = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('.brain-resource-scene-nav button')].find(n => n.textContent?.trim() === ${JSON.stringify(label)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  if (!p) return null;
  await cdpClick(client, p.x, p.y);
  return { at: new Date().toISOString(), method: "CDP", target: `tab:${label}`, ...p };
}
async function pasteComposer(client, text) {
  for (let i = 0; i < 4; i++) await osPressEscape();
  await sleep(200);
  await clickSelector(client, '[data-testid="composer-input"]');
  await sleep(200);
  const focused = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") === "composer-input"`);
  if (!focused) {
    await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.focus()`);
  }
  // React controlled textarea: native setter + value tracker
  const ok = await client.evaluate(`(() => {
    const el = document.querySelector('[data-testid="composer-input"]');
    if (!(el instanceof HTMLTextAreaElement)) return false;
    const last = el.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, ${JSON.stringify(text)});
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(last);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value.includes(${JSON.stringify(marker)});
  })()`);
  assert.ok(ok, "composer react set failed");
  await sleep(200);
}
async function submitComposer(client) {
  await client.waitFor(`!document.querySelector('[data-testid="composer-send-button"]')?.disabled && (document.querySelector('[data-testid="composer-input"]')?.value||'').includes(${JSON.stringify(marker)})`, 10_000);
  const clicked = await client.evaluate(`(() => {
    const btn = document.querySelector('[data-testid="composer-send-button"]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  })()`);
  if (!clicked) {
    await clickSelector(client, '[data-testid="composer-send-button"]');
  }
}
async function readMeta(client) {
  return client.evaluate(`(async () => {
    const projects = await window.codecn.listBrainProjects({ workspaceKey: 'data' });
    const match = (projects||[]).find(p => (p.name||'') === ${JSON.stringify(projectName)});
    if (!match) return { ok:false };
    const files = await window.codecn.listBrainFiles({ projectId: match.id }).catch(()=>[]);
    const datasets = await window.codecn.listDataDatasets({ projectId: match.id }).catch(()=>[]);
    return { ok:true, project: { id: match.id, name: match.name, localWorkspaceId: match.localWorkspaceId }, files, datasets };
  })()`);
}
async function walkCook(projectRoot) {
  const cookFiles = [];
  if (!projectRoot) return cookFiles;
  async function walk(dir, d = 0) {
    if (d > 6) return;
    for (const name of await readdir(dir).catch(() => [])) {
      const full = join(dir, name);
      try {
        const s = await stat(full);
        if (s.isDirectory()) await walk(full, d + 1);
        else if (/analysis\.json|manifest\.json|analysis-editor\.json|regional-quarterly/i.test(name) && s.size > 0) {
          cookFiles.push({ path: full, size: s.size });
        }
      } catch {}
    }
  }
  await walk(projectRoot);
  return cookFiles;
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

  // Sidebar may collapse older items behind “显示更多”
  try {
    evidence.actions.push(await clickText(client, "显示更多"));
    await sleep(500);
  } catch {}
  // Match by unique id fragment (full name may wrap / truncate)
  const projectHit = await client.evaluate(`(() => {
    const needle = ${JSON.stringify("1787622968401")};
    const el = [...document.querySelectorAll('button,a,[role=button]')].find(n => (n.textContent||'').includes(needle) && n.offsetParent);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: (el.textContent||'').trim().slice(0,80) };
  })()`);
  if (projectHit) {
    await activateWindow();
    await cdpClick(client, projectHit.x, projectHit.y);
    evidence.actions.push({ at: new Date().toISOString(), method: "CDP", target: projectHit.text, x: projectHit.x, y: projectHit.y });
  } else {
    // Already active in right panel / catalog — continue
    evidence.actions.push({ at: new Date().toISOString(), method: "skip", target: "project already active or not listed" });
  }
  await sleep(1200);
  // Prefer existing project thread; only open 新对话 if composer missing
  const hasComposer = await client.evaluate(`Boolean(document.querySelector('[data-testid="composer-input"]'))`);
  if (!hasComposer) {
    try { evidence.actions.push(await clickText(client, "新对话")); await sleep(800); } catch {}
  }
  const picker = await client.evaluate("Boolean(document.querySelector('.new-chat-project-picker > button')?.offsetParent)");
  if (picker) {
    evidence.actions.push(await clickSelector(client, ".new-chat-project-picker > button"));
    await sleep(400);
    const pick = await client.evaluate(`(() => {
      const needle = ${JSON.stringify("1787622968401")};
      const el = [...document.querySelectorAll('button,a,[role=menuitem],div')].find(n => (n.textContent||'').includes(needle) && n.offsetParent);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + Math.min(r.width/2, 120)), y: Math.round(r.top + r.height/2) };
    })()`);
    if (pick) {
      await cdpClick(client, pick.x, pick.y);
      evidence.actions.push({ at: new Date().toISOString(), method: "CDP", target: "picker-project", ...pick });
      await sleep(600);
    }
  }
  evidence.checkpoints.push(await shot(client, "01-project"));

  await pasteComposer(client, prompt);
  evidence.checkpoints.push(await shot(client, "02-prompt"));
  await submitComposer(client);
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(marker)}) && !((document.querySelector('[data-testid="composer-input"]')?.value||'').includes(${JSON.stringify(marker)}))`, 60_000);
  evidence.assertions.push({ name: "prompt submitted", pass: true });
  evidence.checkpoints.push(await shot(client, "03-submitted"));

  let capture = 4;
  const deadline = Date.now() + 14 * 60_000;
  let approvalCount = 0;
  let lastBody = "";
  while (Date.now() < deadline) {
    await sleep(7_000);
    const cur = await state(client);
    lastBody = cur.body || "";
    const approval = cur.buttons.find((b) => b.text === "批准并继续" || b.text === "批准");
    if (approval) {
      evidence.checkpoints.push(await shot(client, `${String(capture++).padStart(2, "0")}-approval`));
      evidence.actions.push(await clickText(client, approval.text));
      approvalCount += 1;
      await sleep(1500);
    }
    if (capture % 2 === 0) evidence.checkpoints.push(await shot(client, `${String(capture++).padStart(2, "0")}-progress`));
    else capture++;
    evidence.progress = { slice: lastBody.slice(-4000), chart: cur.chartPresent, approvalCount };
    await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
    const busy = cur.buttons.some((b) => /停止|取消/.test(b.text || ""));
    const send = cur.buttons.some((b) => b.testid === "composer-send-button");
    const cooked = /data\.analysis\.cook|Docs\/BRAIN|analysis\.json|已导出|cook/i.test(lastBody);
    if (send && !busy && cooked && approvalCount > 0 && Date.now() - Date.parse(evidence.startedAt) > 45_000) break;
    if (send && !busy && Date.now() - Date.parse(evidence.startedAt) > 12 * 60_000) break;
    if (/生成异常终止|Agent loop stalled/.test(lastBody) && send && !busy) {
      const retry = cur.buttons.find((b) => (b.text || "").includes("重试"));
      if (retry) {
        try { evidence.actions.push(await clickText(client, retry.text)); } catch { evidence.actions.push(await clickText(client, "重试并从断点继续")); }
        await sleep(2000);
      }
    }
  }

  evidence.afterFirst = await state(client);
  evidence.metaAfter = await readMeta(client);
  evidence.checkpoints.push(await shot(client, "40-after-first"));

  for (const tab of ["Julius", "数据导入", "图表", "决策 Flow"]) {
    const a = await clickSceneTab(client, tab);
    if (a) {
      evidence.actions.push(a);
      await sleep(700);
      evidence.checkpoints.push(await shot(client, `41-${tab}`));
      evidence[`tab_${tab}`] = await state(client);
    }
  }

  const catalog = await client.evaluate(`(async () => (await window.codecn.listWorkspaces?.() || []))()`);
  evidence.workspaces = (catalog || []).slice(0, 30).map((w) => ({ id: w.id, name: w.name, path: w.path }));
  const localId = evidence.metaAfter?.project?.localWorkspaceId;
  const ws = (catalog || []).find((w) => w.id === localId);
  let projectRoot = ws?.path;
  if (!projectRoot) {
    projectRoot = join(homedir(), ".codecn", ".codecn", "projects", projectName);
  }
  evidence.projectRoot = projectRoot;
  let cookFiles = await walkCook(projectRoot);
  evidence.cookFiles = cookFiles;

  // reload persistence
  await client.command("Page.reload", { ignoreCache: true });
  await client.waitForAppReady();
  await activateWindow();
  await sleep(2500);
  const afterReload = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(projectName)})`);
  evidence.assertions.push({ name: "project after reload", pass: Boolean(afterReload) });
  if (afterReload) {
    try {
      evidence.actions.push(await clickText(client, "显示更多"));
      await sleep(400);
    } catch {}
    const hit = await client.evaluate(`(() => {
      const el = [...document.querySelectorAll('button')].find(n => (n.textContent||'').includes('1787622968401') && n.offsetParent);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
    if (hit) {
      await cdpClick(client, hit.x, hit.y);
      evidence.actions.push({ at: new Date().toISOString(), method: "CDP", target: "reload-project", ...hit });
      await sleep(1200);
    }
  }
  evidence.metaReload = await readMeta(client);
  cookFiles = await walkCook(projectRoot);
  evidence.cookFilesReload = cookFiles;
  evidence.checkpoints.push(await shot(client, "71-reload"));

  const datasets = evidence.metaReload?.datasets || evidence.metaAfter?.datasets || [];
  const files = evidence.metaReload?.files || evidence.metaAfter?.files || [];
  const hasRealCsv = files.some((f) => /regional-quarterly|区域季度/i.test(f.logicalName || f.name || f.storageKey || ""))
    || cookFiles.some((f) => /regional-quarterly/i.test(f.path));
  const hasDataset = datasets.length > 0 && datasets.some((d) => (d.rowCount || 0) > 0);
  const noPrototype = !/sales_q3\.csv/.test(evidence.afterFirst?.julius || evidence.afterFirst?.dataWs || "");
  const hasCook = cookFiles.some((f) => /Docs[\\/].*analysis\.json|\.brain-data[\\/].*analysis|manifest\.json/i.test(f.path) && f.size > 0);
  const toolsUsed = approvalCount > 0 || /data\.file\.import_local|data\.analysis\.cook|data\.analysis\.save/i.test(lastBody);
  evidence.approvalCount = approvalCount;
  evidence.gradeSignals = { hasRealCsv, hasDataset, noPrototype, hasCook, toolsUsed, approvalCount, datasetCount: datasets.length, fileCount: files.length, cookCount: cookFiles.length };

  if (hasDataset && hasCook && toolsUsed && noPrototype && afterReload) evidence.result = "PASS";
  else if (hasDataset || hasRealCsv || toolsUsed) {
    evidence.result = "PARTIAL";
    evidence.firstFailure = `Incomplete: ${JSON.stringify(evidence.gradeSignals)}`;
  } else {
    evidence.result = "FAIL";
    evidence.firstFailure = `No data loop: ${JSON.stringify(evidence.gradeSignals)}`;
  }
  evidence.assertions.push(
    { name: "real csv registered", pass: hasRealCsv },
    { name: "dataset imported", pass: hasDataset },
    { name: "no sales_q3 prototype", pass: noPrototype },
    { name: "cook artifacts", pass: hasCook },
    { name: "tools used", pass: toolsUsed }
  );
  evidence.checkpoints.push(await shot(client, "99-final"));
} catch (error) {
  evidence.firstFailure = error instanceof Error ? error.stack || error.message : String(error);
  try { evidence.checkpoints.push(await shot(client, "98-failure")); evidence.failure = await state(client); } catch {}
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  await writeFile(`${evidenceDir}/SUMMARY.md`, `# ${caseId}\n\n- result: **${evidence.result}**\n- project: ${projectName}\n- marker: ${marker}\n- approvals: ${evidence.approvalCount || 0}\n- grade: \`${JSON.stringify(evidence.gradeSignals || {})}\`\n- firstFailure: ${evidence.firstFailure || "none"}\n`, "utf8");
  console.log(JSON.stringify({ evidenceDir, result: evidence.result, firstFailure: evidence.firstFailure, gradeSignals: evidence.gradeSignals, approvals: evidence.approvalCount }, null, 2));
  await client.close({ keepProcess: true });
}
