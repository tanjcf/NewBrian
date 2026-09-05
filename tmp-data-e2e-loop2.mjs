import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile, readdir, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const caseId = "DATA-E2E-REAL-002";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const debugPort = 9356;
const projectName = "区域季度经营分析-E2E-1787620449725";
const evidenceDir = `evidence/${caseId}/${stamp}`;
const csvPath = join(process.cwd(), "evidence/DATA-E2E-REAL-001/2026-08-25T01-14-09-724Z/fixtures/regional-quarterly-ops.csv");
const marker = "DATA-LOOP-002";
await mkdir(evidenceDir, { recursive: true });

const prompt = `${marker}：请只使用右侧数据 Tools 完成真实闭环（禁止 sales_q3 / 禁止只写方案）：
1) data.file.import_local，absolutePath="${csvPath.replace(/\\/g, "\\\\")}"，autoImportDataset=true，datasetName="区域季度经营分析"
2) data.dataset.list 与 data.dataset.read_rows 核对行数/字段
3) data.analysis.summarize
4) data.analysis.aggregate：groupBy=["region"]，metrics=[{column:"revenue",operation:"sum"}]，periodColumn="quarter"，compareMetric="revenue"，topN=4，orderBy={metric:"sum_revenue",direction:"desc"}
5) data.analysis.save：fileName="区域季度经营分析"，insight 基于聚合结果写决策建议，datasetId 用刚导入的 id
6) data.analysis.cook
每步报告工具返回；失败如实说明。`;

const revisePrompt = `DATA-REVISE-002：再调用 data.analysis.aggregate（topN=2），然后 data.analysis.save + data.analysis.cook 更新导出。`;

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
    composerLen: (document.querySelector('[data-testid="composer-input"]')?.value || '').length,
    dataWorkspace: document.querySelector('[data-testid="brain-data-workspace"]')?.innerText?.slice(0, 4000) || '',
    julius: document.querySelector('[data-testid="brain-data-julius-shell"]')?.innerText?.slice(0, 3000) || '',
    chartPresent: Boolean(document.querySelector('[data-testid="brain-data-chart"],[data-testid="brain-data-julius-chart"]')),
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => ({ text: x.textContent?.trim()?.slice(0, 60), testid: x.dataset.testid || '' })).slice(0, 180)
  }))()`);
}
async function cdpClick(client, x, y) {
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(120);
}
async function clickText(client, text) {
  const p = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('button,a,[role=button]')].find(n => (n.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)}) && n.offsetParent && n.getBoundingClientRect().width < 700);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  assert.ok(p, text);
  await activateWindow();
  await cdpClick(client, p.x, p.y);
  return { at: new Date().toISOString(), method: "CDP", target: text, ...p };
}
async function clickSelector(client, selector) {
  const p = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const padX = el.tagName === 'TEXTAREA' ? 20 : r.width/2;
    const padY = el.tagName === 'TEXTAREA' ? 10 : r.height/2;
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
  for (let i = 0; i < 3; i++) await osPressEscape();
  await clickSelector(client, '[data-testid="composer-input"]');
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.insertText", { text });
  await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.dispatchEvent(new Event('input',{bubbles:true}))`);
  const len = await client.evaluate(`(document.querySelector('[data-testid="composer-input"]')?.value||'').length`);
  assert.ok(len > 40, `composer empty ${len}`);
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

const client = await createSceneTestCdpClient(debugPort);
const evidence = { caseId, startedAt: new Date().toISOString(), projectName, prompt, actions: [], assertions: [], checkpoints: [], result: "FAIL" };
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

  // Select existing project in sidebar
  evidence.actions.push(await clickText(client, projectName.slice(0, 18)));
  await sleep(1000);
  const picker = await client.evaluate("Boolean(document.querySelector('.new-chat-project-picker > button')?.offsetParent)");
  if (picker) {
    evidence.actions.push(await clickSelector(client, ".new-chat-project-picker > button"));
    await sleep(400);
    try { evidence.actions.push(await clickText(client, projectName)); } catch {}
  }
  evidence.checkpoints.push(await shot(client, "01-project"));

  await pasteComposer(client, prompt);
  evidence.checkpoints.push(await shot(client, "02-prompt"));
  evidence.actions.push(await clickSelector(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(marker)})`, 20_000);
  evidence.assertions.push({ name: "prompt submitted", pass: true });
  evidence.checkpoints.push(await shot(client, "03-submitted"));

  let capture = 4;
  const deadline = Date.now() + 14 * 60_000;
  let approvalCount = 0;
  let lastBody = "";
  while (Date.now() < deadline) {
    await sleep(8_000);
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
    evidence.progress = { slice: lastBody.slice(-3500), chart: cur.chartPresent };
    await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
    const busy = cur.buttons.some((b) => /停止|取消/.test(b.text || ""));
    const send = cur.buttons.some((b) => b.testid === "composer-send-button");
    const meaningful = /data\.file\.import_local|dataset-|已导入|regional-quarterly|analysis\.cook|Docs\/BRAIN/i.test(lastBody);
    if (send && !busy && meaningful && approvalCount > 0 && Date.now() - Date.parse(evidence.startedAt) > 60_000) break;
    if (send && !busy && Date.now() - Date.parse(evidence.startedAt) > 12 * 60_000) break;
    if (/生成异常终止|Agent loop stalled/.test(lastBody) && send && !busy) {
      const retry = cur.buttons.find((b) => (b.text || "").includes("重试"));
      if (retry) { evidence.actions.push(await clickText(client, "重试并从断点继续")); await sleep(2000); }
    }
  }

  evidence.afterFirst = await state(client);
  evidence.metaAfter = await readMeta(client);
  evidence.checkpoints.push(await shot(client, "40-after-first"));

  for (const tab of ["Julius", "数据导入", "图表", "决策 Flow"]) {
    const a = await clickSceneTab(client, tab);
    if (a) { evidence.actions.push(a); await sleep(700); evidence.checkpoints.push(await shot(client, `41-${tab}`)); evidence[`tab_${tab}`] = await state(client); }
  }

  // revise
  await pasteComposer(client, revisePrompt);
  evidence.actions.push(await clickSelector(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes('DATA-REVISE-002')`, 20_000);
  const reviseDeadline = Date.now() + 6 * 60_000;
  while (Date.now() < reviseDeadline) {
    await sleep(8_000);
    const cur = await state(client);
    lastBody = cur.body || "";
    const approval = cur.buttons.find((b) => b.text === "批准并继续" || b.text === "批准");
    if (approval) {
      evidence.actions.push(await clickText(client, approval.text));
      approvalCount += 1;
    }
    evidence.checkpoints.push(await shot(client, `${String(capture++).padStart(2, "0")}-revise`));
    const busy = cur.buttons.some((b) => /停止|取消/.test(b.text || ""));
    if (cur.buttons.some((b) => b.testid === "composer-send-button") && !busy) break;
  }

  evidence.afterRevise = await state(client);
  evidence.metaFinal = await readMeta(client);
  evidence.approvalCount = approvalCount;
  evidence.checkpoints.push(await shot(client, "60-after-revise"));

  // Find cook artifacts via workspace catalog path
  const catalog = await client.evaluate(`(async () => {
    const workspaces = await window.codecn.listWorkspaces?.() || [];
    return workspaces;
  })()`);
  evidence.workspaces = (catalog || []).slice(0, 20).map((w) => ({ id: w.id, name: w.name, path: w.path }));
  const localId = evidence.metaFinal?.project?.localWorkspaceId;
  const ws = (catalog || []).find((w) => w.id === localId);
  const projectRoot = ws?.path;
  evidence.projectRoot = projectRoot;
  const cookFiles = [];
  if (projectRoot) {
    async function walk(dir, d = 0) {
      if (d > 5) return;
      for (const name of await readdir(dir).catch(() => [])) {
        const full = join(dir, name);
        try {
          const s = await stat(full);
          if (s.isDirectory()) await walk(full, d + 1);
          else if (/analysis\.json|manifest\.json|regional-quarterly|decision/i.test(name) && s.size > 0) cookFiles.push({ path: full, size: s.size });
        } catch {}
      }
    }
    await walk(projectRoot);
  }
  evidence.cookFiles = cookFiles;

  // reload persistence
  await client.command("Page.reload", { ignoreCache: true });
  await client.waitForAppReady();
  await activateWindow();
  await sleep(2000);
  const afterReload = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(projectName)})`);
  evidence.assertions.push({ name: "project after reload", pass: Boolean(afterReload) });
  if (afterReload) {
    try { evidence.actions.push(await clickText(client, projectName.slice(0, 14))); await sleep(1000); } catch {}
  }
  evidence.metaReload = await readMeta(client);
  evidence.checkpoints.push(await shot(client, "71-reload"));

  const datasets = evidence.metaReload?.datasets || evidence.metaFinal?.datasets || [];
  const files = evidence.metaFinal?.files || [];
  const hasRealCsv = files.some((f) => /regional-quarterly|区域季度/i.test(f.logicalName || f.name || f.storageKey || ""));
  const hasDataset = datasets.length > 0 && datasets.some((d) => (d.rowCount || 0) > 0);
  const noPrototype = !/sales_q3\.csv/.test(evidence.afterRevise?.julius || evidence.afterFirst?.julius || "");
  const hasCook = cookFiles.some((f) => /analysis\.json|manifest\.json/i.test(f.path) && f.size > 0);
  const toolsUsed = approvalCount > 0 || /data\.file\.import_local|data\.analysis\.cook/i.test(lastBody);
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
  console.log(JSON.stringify({ evidenceDir, result: evidence.result, firstFailure: evidence.firstFailure, gradeSignals: evidence.gradeSignals, approvals: evidence.approvalCount }, null, 2));
  await client.close({ keepProcess: true });
}
