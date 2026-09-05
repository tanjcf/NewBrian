import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const parentDir = "evidence/DATA-E2E-REAL-001/2026-08-25T01-14-09-724Z";
const caseId = "DATA-E2E-REAL-001-CONTINUE";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = `evidence/${caseId}/${stamp}`;
const projectName = "区域季度经营分析-E2E-1787620449725";
const csvSrc = join(parentDir, "fixtures", "regional-quarterly-ops.csv");
const projectDir = join(process.env.USERPROFILE || "", ".codecn", ".codecn", "projects", projectName);
await mkdir(evidenceDir, { recursive: true });

const client = await createSceneTestCdpClient(9356);
const evidence = {
  caseId,
  parentEvidence: parentDir,
  startedAt: new Date().toISOString(),
  projectName,
  projectDir,
  actions: [],
  assertions: [],
  checkpoints: [],
  result: "FAIL"
};

async function activateWindow() {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]);
  } catch {}
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
    body: document.body.innerText.slice(0, 30000),
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => ({
      text: x.textContent?.trim()?.slice(0, 80), testid: x.dataset.testid || ''
    })).slice(0, 200),
    dataWorkspace: document.querySelector('[data-testid="brain-data-workspace"]')?.innerText?.slice(0, 4000) || '',
    chartPresent: Boolean(document.querySelector('[data-testid="brain-data-chart"]')),
    analysisPresent: Boolean(document.querySelector('[data-testid="brain-data-analysis-result"]'))
  }))()`);
}
async function cdpClickAt(client, x, y) {
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(150);
}
async function clickText(client, text) {
  const p = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('button,a,[role=button]')].find(n => (n.textContent||'').replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)}) && n.offsetParent);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  assert.ok(p, text);
  await activateWindow();
  await cdpClickAt(client, p.x, p.y);
  return { at: new Date().toISOString(), method: "CDP mouse", target: text, ...p };
}
async function clickSelector(client, selector) {
  const p = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + (el.tagName==='TEXTAREA'?20:r.width/2)), y: Math.round(r.top + (el.tagName==='TEXTAREA'?10:r.height/2)) };
  })()`);
  assert.ok(p, selector);
  await activateWindow();
  await cdpClickAt(client, p.x, p.y);
  return { at: new Date().toISOString(), method: "CDP mouse", target: selector, ...p };
}
async function clickSceneTab(client, label) {
  const p = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('.brain-resource-scene-nav button')].find(n => n.textContent?.trim() === ${JSON.stringify(label)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  if (!p) return null;
  await cdpClickAt(client, p.x, p.y);
  return { at: new Date().toISOString(), method: "CDP mouse", target: `tab:${label}`, ...p };
}
async function readMeta(client) {
  return client.evaluate(`(async () => {
    const projects = await window.codecn.listBrainProjects({ workspaceKey: 'data' });
    const match = (projects||[]).find(p => (p.name||'') === ${JSON.stringify(projectName)});
    if (!match) return { ok:false };
    let files=[], datasets=[];
    try { files = await window.codecn.listBrainFiles({ projectId: match.id }); } catch {}
    try { datasets = await window.codecn.listDataDatasets({ projectId: match.id }); } catch {}
    return { ok:true, project: match, files, datasets };
  })()`);
}

try {
  await client.waitForAppReady();
  await activateWindow();
  for (let i = 0; i < 3; i++) await osPressEscape();
  evidence.checkpoints.push(await shot(client, "00-continue-start"));

  // Fixture: copy real CSV into project directory so agent can find it
  await mkdir(projectDir, { recursive: true });
  const csvDest = join(projectDir, "regional-quarterly-ops.csv");
  await copyFile(csvSrc, csvDest);
  evidence.fixtureCopy = { from: csvSrc, to: csvDest, bytes: (await stat(csvDest)).size };
  evidence.assertions.push({ name: "csv copied into project dir", pass: true, path: csvDest });

  // Click retry if visible
  const hasRetry = await client.evaluate(`Boolean([...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('重试并从断点继续') && b.offsetParent))`);
  if (hasRetry) {
    evidence.actions.push(await clickText(client, "重试并从断点继续"));
    evidence.checkpoints.push(await shot(client, "01-retry-clicked"));
  } else {
    // Send a follow-up with in-project path
    evidence.actions.push(await clickSelector(client, '[data-testid="composer-input"]'));
    const follow = `继续执行。项目目录已有真实 CSV：regional-quarterly-ops.csv。请用右侧数据与决策 Tools 导入该文件，完成分析、图表、决策与导出。不要使用 sales_q3 原型数据。`;
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await client.command("Input.insertText", { text: follow });
    await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.dispatchEvent(new Event('input',{bubbles:true}))`);
    evidence.actions.push(await clickSelector(client, '[data-testid="composer-send-button"]'));
    evidence.checkpoints.push(await shot(client, "01-followup-sent"));
  }

  let capture = 2;
  const deadline = Date.now() + 12 * 60_000;
  let approvalCount = 0;
  let lastBody = "";
  while (Date.now() < deadline) {
    await sleep(10_000);
    const cur = await state(client);
    lastBody = cur.body || "";
    const approval = cur.buttons.find((b) => b.text === "批准并继续" || b.text === "批准");
    if (approval) {
      evidence.checkpoints.push(await shot(client, `${String(capture++).padStart(2,"0")}-approval`));
      evidence.actions.push(await clickText(client, approval.text));
      approvalCount++;
    }
    if (capture % 2 === 0) evidence.checkpoints.push(await shot(client, `${String(capture++).padStart(2,"0")}-progress`));
    else capture++;
    evidence.progress = { slice: lastBody.slice(-3000), chart: cur.chartPresent, analysis: cur.analysisPresent };
    await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
    if (/生成异常终止|Agent loop stalled/.test(lastBody) && !cur.buttons.some((b) => /停止|取消/.test(b.text||""))) {
      const retry = cur.buttons.find((b) => (b.text||"").includes("重试"));
      if (retry && approvalCount < 3) {
        evidence.actions.push(await clickText(client, "重试并从断点继续"));
        await sleep(2000);
        continue;
      }
    }
    const busy = cur.buttons.some((b) => /停止|取消/.test(b.text || ""));
    const send = cur.buttons.some((b) => b.testid === "composer-send-button");
    if (send && !busy && (/已导入|数据集|决策报告|Cook|图表|regional-quarterly/i.test(lastBody)) && Date.now() - Date.parse(evidence.startedAt) > 90_000) break;
    if (send && !busy && Date.now() - Date.parse(evidence.startedAt) > 10 * 60_000) break;
  }

  for (const tab of ["Julius", "数据导入", "图表", "决策 Flow"]) {
    const a = await clickSceneTab(client, tab);
    if (a) { evidence.actions.push(a); await sleep(600); evidence.checkpoints.push(await shot(client, `40-tab-${tab}`)); evidence[`tab_${tab}`] = await state(client); }
  }

  evidence.meta = await readMeta(client);
  evidence.finalState = await state(client);
  evidence.checkpoints.push(await shot(client, "99-final"));
  evidence.approvalCount = approvalCount;

  const datasets = evidence.meta?.datasets || [];
  const files = evidence.meta?.files || [];
  const rightData = datasets.length > 0 || /\d+\s*行/.test(evidence.tab_数据导入?.dataWorkspace || "");
  const hadChart = Boolean(evidence.finalState?.chartPresent || evidence.tab_图表?.chartPresent);
  const hadAnalysis = Boolean(evidence.finalState?.analysisPresent);
  const usedTools = approvalCount > 0 || /已调用工具|spreadsheet\.|workspace\./i.test(lastBody);
  const prototypeOnly = /sales_q3/.test(lastBody) && datasets.length === 0;
  // Scan project for real exports
  const exports = [];
  async function walk(dir, d = 0) {
    if (d > 4) return;
    for (const name of await readdir(dir).catch(() => [])) {
      const full = join(dir, name);
      try {
        const s = await stat(full);
        if (s.isDirectory()) await walk(full, d + 1);
        else if (/decision|analysis|chart|cook|\.md$/i.test(name) && name !== "CODECN.md" && s.size > 0) exports.push({ path: full, size: s.size });
      } catch {}
    }
  }
  await walk(projectDir);
  evidence.exports = exports;
  evidence.gradeSignals = { rightData, hadChart, hadAnalysis, usedTools, prototypeOnly, datasetCount: datasets.length, fileCount: files.length, exportCount: exports.length, approvalCount };

  if (rightData && hadChart && exports.length > 0 && usedTools && !prototypeOnly) evidence.result = "PASS";
  else if (rightData || datasets.length > 0 || files.length > 0 || /已导入|regional-quarterly/i.test(lastBody)) {
    evidence.result = "PARTIAL";
    evidence.firstFailure = `Incomplete: ${JSON.stringify(evidence.gradeSignals)}`;
  } else {
    evidence.result = "FAIL";
    evidence.firstFailure = `No right-side data tools effect: ${JSON.stringify(evidence.gradeSignals)}`;
  }
} catch (error) {
  evidence.firstFailure = error instanceof Error ? error.stack || error.message : String(error);
  try { evidence.checkpoints.push(await shot(client, "98-failure")); evidence.failureState = await state(client); } catch {}
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  // Also update parent evidence grade honesty
  console.log(JSON.stringify({ evidenceDir, result: evidence.result, firstFailure: evidence.firstFailure, gradeSignals: evidence.gradeSignals, approvals: evidence.approvalCount }, null, 2));
  await client.close({ keepProcess: true });
}
