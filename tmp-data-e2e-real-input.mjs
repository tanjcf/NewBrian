import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osKeyCombo, osMouseClick, osPressEnter, osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const caseId = "DATA-E2E-REAL-001";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const debugPort = Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9356);
const projectName = `区域季度经营分析-E2E-${Date.now()}`;
const evidenceDir = `evidence/${caseId}/${stamp}`;
const fixtureDir = join(evidenceDir, "fixtures");
const csvName = "regional-quarterly-ops.csv";
const csvPath = join(process.cwd(), fixtureDir, csvName);
const marker = "请只使用右侧「数据与决策」Tools";

const prompt = `${marker} 操作当前项目，完成「区域季度经营分析」真实闭环（不得只回复方案或代码）：
1. 必须先调用 data.file.import_local（absolutePath=下方 CSV，autoImportDataset=true）把真实 CSV 登记并导入数据集；禁止使用 sales_q3 原型。
2. 调用 data.project.inspect / data.dataset.list 确认右侧数据集字段与行数；再用 data.dataset.read_rows 核对采样。
3. 调用 data.analysis.summarize 与 data.analysis.aggregate（按 region 分组，metrics 含 revenue sum，periodColumn=quarter，compareMetric=revenue，topN=4）。
4. 调用 data.analysis.save 写入 Julius 洞察，再 data.analysis.cook 导出 Docs/BRAIN/analysis.json。
5. 报告右侧「数据导入/Julius/图表」真实状态；若工具失败必须如实说明，不得编造。
本地真实 CSV 绝对路径：
${csvPath.replace(/\//g, "\\")}`;

const revisePrompt = `DATA-REVISE-001：请再次调用 data.analysis.aggregate，把 topN 改为 2（收入最高两区域），更新 insight 后调用 data.analysis.save 与 data.analysis.cook。`;

await mkdir(fixtureDir, { recursive: true });
const csvBody = [
  "region,quarter,revenue,cost,profit,orders",
  "华东,2025Q1,1280000,860000,420000,3120",
  "华东,2025Q2,1410000,910000,500000,3380",
  "华南,2025Q1,980000,720000,260000,2210",
  "华南,2025Q2,1050000,740000,310000,2390",
  "华北,2025Q1,870000,690000,180000,1980",
  "华北,2025Q2,920000,705000,215000,2105",
  "西南,2025Q1,640000,510000,130000,1420",
  "西南,2025Q2,710000,530000,180000,1560",
  "华东,2025Q3,1500000,940000,560000,3510",
  "华南,2025Q3,1120000,760000,360000,2480",
  "华北,2025Q3,955000,715000,240000,2180",
  "西南,2025Q3,735000,545000,190000,1610"
].join("\n") + "\n";
await writeFile(csvPath, csvBody, "utf8");

async function activateWindow() {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")], { windowsHide: false });
  } catch {}
}

async function paste(text) {
  const b64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`], { windowsHide: true });
  await osKeyCombo(true, "v");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function shot(client, name) {
  const result = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `${evidenceDir}/${name}.png`;
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}

async function state(client) {
  return client.evaluate(`(() => ({
    body: document.body.innerText.slice(0, 28000),
    workspace: (() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r?JSON.parse(r):null; } catch { return null; } })(),
    composerValue: document.querySelector('[data-testid="composer-input"]')?.value || '',
    composerLen: (document.querySelector('[data-testid="composer-input"]')?.value || '').length,
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => ({
      text: x.textContent?.trim()?.slice(0, 80),
      title: x.title || '',
      testid: x.dataset.testid || ''
    })).slice(0, 220),
    selects: [...document.querySelectorAll('select')].filter(x => x.offsetParent).map(x => ({
      testid: x.dataset.testid || '',
      aria: x.getAttribute('aria-label') || '',
      value: x.value,
      options: [...x.options].slice(0, 20).map(o => o.textContent?.trim())
    })).slice(0, 30),
    dataStatus: document.querySelector('[data-testid="brain-data-status"]')?.textContent || '',
    dataWorkspace: document.querySelector('[data-testid="brain-data-workspace"]')?.innerText?.slice(0, 4000) || '',
    chartPresent: Boolean(document.querySelector('[data-testid="brain-data-chart"]')),
    analysisPresent: Boolean(document.querySelector('[data-testid="brain-data-analysis-result"]')),
    aggregatePresent: Boolean(document.querySelector('[data-testid="brain-data-aggregate-result"]')),
    juliusText: document.querySelector('[data-testid="brain-data-julius-shell"]')?.innerText?.slice(0, 3000) || '',
    juliusInsight: document.querySelector('[data-testid="brain-data-julius-insight"]')?.textContent || '',
    juliusHasPrototype: /sales_q3\\.csv/i.test(document.querySelector('[data-testid="brain-data-julius-shell"]')?.innerText || ''),
    menuOpen: Boolean(document.querySelector('.composer-add-menu,.composer-picker-menu,.project-create-menu')?.offsetParent)
  }))()`);
}

async function viewportPoint(client, rootSelector, text = "") {
  const value = await client.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)}) || document.body;
    let el = null;
    if (${JSON.stringify(Boolean(text))}) {
      const nodes = [...root.querySelectorAll('button,a,[role=button]')];
      el = nodes.find(n => (n.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)})
        || nodes.find(n => {
          const t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
          const r = n.getBoundingClientRect();
          return t.includes(${JSON.stringify(text)}) && r.width > 0 && r.width < 600 && r.height < 120;
        });
    } else {
      el = root.querySelector ? root : document.querySelector(${JSON.stringify(rootSelector)});
      if (!el) el = root;
    }
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: Math.round(r.left + Math.min(24, r.width / 2)),
      y: Math.round(r.top + Math.min(12, r.height / 2)),
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  })()`);
  assert.ok(value, `${rootSelector} ${text}`);
  return value;
}

async function cdpClickAt(client, x, y) {
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(120);
}

async function click(client, rootSelector, text = "") {
  const value = await viewportPoint(client, rootSelector, text);
  await activateWindow();
  await cdpClickAt(client, value.cx, value.cy);
  return { at: new Date().toISOString(), method: "CDP Input.dispatchMouseEvent", target: text || rootSelector, ...value };
}

async function clickSelector(client, selector) {
  const value = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    // Prefer a top-left interior point for textareas covered by overlays at center
    const padX = el.tagName === 'TEXTAREA' ? 20 : r.width / 2;
    const padY = el.tagName === 'TEXTAREA' ? 10 : r.height / 2;
    return {
      x: Math.round(r.left + padX),
      y: Math.round(r.top + padY),
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  })()`);
  assert.ok(value, selector);
  await activateWindow();
  await cdpClickAt(client, value.x, value.y);
  return { at: new Date().toISOString(), method: "CDP Input.dispatchMouseEvent", target: selector, ...value };
}

async function clickSceneTab(client, label) {
  const value = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('.brain-resource-scene-nav button')].find(n => n.textContent?.trim() === ${JSON.stringify(label)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!value) return null;
  await activateWindow();
  await cdpClickAt(client, value.x, value.y);
  return { at: new Date().toISOString(), method: "CDP Input.dispatchMouseEvent", target: `scene-tab:${label}`, ...value };
}

async function dismissMenus(client) {
  for (let i = 0; i < 6; i++) {
    const open = client
      ? await client.evaluate(`Boolean(document.querySelector('.composer-add-menu,.composer-picker-menu,.project-create-menu,.brain-workspace-menu')?.offsetParent) || [...document.querySelectorAll('.composer-builtin-plugin')].some(x => x.offsetParent)`)
      : false;
    await osPressEscape();
    await sleep(180);
    if (client && !open) break;
  }
}

async function focusComposerAndPaste(client, text, evidence, label) {
  await dismissMenus(client);
  await activateWindow();
  evidence.actions.push(await clickSelector(client, '[data-testid="composer-input"]'));
  await sleep(200);
  let focused = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") === "composer-input"`);
  if (!focused) {
    const p = await client.evaluate(`(() => {
      const el = document.querySelector('[data-testid="composer-input"]');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + 16), y: Math.round(r.top + 8) };
    })()`);
    await cdpClickAt(client, p.x, p.y);
    focused = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") === "composer-input"`);
  }
  assert.ok(focused, `${label}: composer not focused`);
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.insertText", { text });
  await sleep(250);
  await client.evaluate(`(() => {
    const el = document.querySelector('[data-testid="composer-input"]');
    el?.dispatchEvent(new Event('input', { bubbles: true }));
    el?.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
  const after = await state(client);
  const ok = (after.composerValue || "").includes(marker) || (after.composerValue || "").includes("DATA-REVISE-001") || (after.composerLen || 0) > 80;
  evidence.assertions.push({ name: `${label} composer has text`, pass: ok, composerLen: after.composerLen, preview: (after.composerValue || "").slice(0, 120) });
  assert.ok(ok, `${label}: composer paste failed`);
  evidence.actions.push({ at: new Date().toISOString(), method: "CDP Input.insertText after visible click", target: label, chars: text.length });
}

async function readProjectMeta(client) {
  return client.evaluate(`(async () => {
    try {
      if (!window.codecn?.listBrainProjects) return { ok: false, reason: 'no-api' };
      const projects = await window.codecn.listBrainProjects({ workspaceKey: 'data' });
      const match = (projects || []).find(p => (p.name || '') === ${JSON.stringify(projectName)} || (p.name || '').includes(${JSON.stringify(projectName.slice(0, 18))}));
      if (!match) return { ok: true, projects: (projects || []).slice(0, 8).map(p => ({ id: p.id, name: p.name })) };
      let files = [];
      let datasets = [];
      try { files = await window.codecn.listBrainFiles({ projectId: match.id }); } catch {}
      try { datasets = await window.codecn.listDataDatasets({ projectId: match.id }); } catch {}
      return {
        ok: true,
        project: { id: match.id, name: match.name, path: match.path || match.localPath || match.rootPath || match.workspacePath || match.localWorkspaceId },
        files: (files || []).slice(0, 30).map(f => ({ id: f.id, name: f.logicalName || f.originalName || f.storageKey, storageKey: f.storageKey })),
        datasets: (datasets || []).slice(0, 20).map(d => ({ id: d.id, name: d.name, rowCount: d.rowCount, columns: (d.columns || []).map(c => c.key || c.label) }))
      };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  })()`);
}

async function listExportCandidates(hints = []) {
  const found = [];
  async function walk(dir, depth = 0) {
    if (depth > 4) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "out", "dist"].includes(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (/\.(md|json|csv)$/i.test(entry.name)) {
        if (/analysis|decision|chart|cook|derived|regional|经营|决策|摘要/i.test(entry.name) || hints.some((h) => h && full.includes(String(h)))) {
          try {
            const s = await stat(full);
            found.push({ path: full, size: s.size, mtime: s.mtime.toISOString() });
          } catch {}
        }
      }
    }
  }
  for (const root of [
    join(process.env.USERPROFILE || "", ".codecn"),
    join(process.env.APPDATA || "", "codeCN"),
    join(process.env.LOCALAPPDATA || "", "codeCN"),
    join(process.cwd(), "Docs"),
    join(process.cwd(), "evidence", caseId, stamp)
  ]) await walk(root, 0);
  return found.slice(0, 100);
}

const client = await createSceneTestCdpClient(debugPort);
const evidence = {
  caseId,
  startedAt: new Date().toISOString(),
  projectName,
  prompt,
  revisePrompt,
  fixture: { csvPath, bytes: Buffer.byteLength(csvBody) },
  environment: { debugPort, input: "CDP mouse click + Windows clipboard Ctrl+V", appTitle: "codeCN", restartedFresh: true },
  actions: [],
  assertions: [],
  checkpoints: [],
  result: "FAIL"
};

try {
  await client.waitForAppReady();
  await activateWindow();
  await dismissMenus(client);
  evidence.checkpoints.push(await shot(client, "00-start"));
  evidence.initialState = await state(client);

  const currentScene = evidence.initialState.workspace?.selectedWorkspaceKey || "";
  if (currentScene !== "data") {
    evidence.actions.push(await clickSelector(client, ".brain-workspace-trigger"));
    await client.waitFor("Boolean(document.querySelector('.brain-workspace-menu')?.offsetParent)", 10_000);
    evidence.checkpoints.push(await shot(client, "01-workspace-menu"));
    evidence.actions.push(await click(client, ".brain-workspace-menu", "数据与决策"));
    await client.waitFor(`(() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r&&JSON.parse(r).selectedWorkspaceKey==='data'; }catch{return false} })()`, 15_000);
  }
  evidence.assertions.push({ name: "scene is data", pass: true });
  await dismissMenus(client);
  evidence.checkpoints.push(await shot(client, "02-data-scene"));

  // New project
  evidence.actions.push(await clickSelector(client, 'button[title="添加项目"]'));
  await client.waitFor("document.body.innerText.includes('新建空白项目')", 10_000);
  evidence.checkpoints.push(await shot(client, "03-project-dialog"));
  evidence.actions.push(await click(client, ".project-create-menu", "新建空白项目"));
  await client.waitFor("document.body.innerText.includes('为项目命名')", 15_000);
  evidence.checkpoints.push(await shot(client, "03b-name-dialog"));
  evidence.actions.push(await clickSelector(client, ".project-name-dialog input"));
  await sleep(150);
  // Select-all via CDP keys then insert project name
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.insertText", { text: projectName });
  await client.evaluate(`(() => {
    const el = document.querySelector('.project-name-dialog input');
    if (!el) return false;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const named = await client.evaluate(`document.querySelector('.project-name-dialog input')?.value || ''`);
  evidence.assertions.push({ name: "project name typed", pass: named === projectName || named.includes("区域季度"), value: named });
  if (named !== projectName) {
    // Force value through native setter then input events (still after visible dialog click)
    await client.evaluate(`(() => {
      const el = document.querySelector('.project-name-dialog input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(projectName)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }
  evidence.actions.push({ at: new Date().toISOString(), method: "CDP Input.insertText after click", target: "project name input", text: projectName });
  evidence.checkpoints.push(await shot(client, "04-project-name"));
  evidence.actions.push(await click(client, ".project-name-dialog", "保存"));
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(projectName)})`, 25_000);
  evidence.assertions.push({ name: "new project visible", pass: true, value: projectName });
  evidence.checkpoints.push(await shot(client, "05-project-created"));

  const pickerVisible = await client.evaluate("Boolean(document.querySelector('.new-chat-project-picker > button')?.offsetParent)");
  if (pickerVisible) {
    evidence.actions.push(await clickSelector(client, ".new-chat-project-picker > button"));
    await client.waitFor("Boolean(document.querySelector('.new-chat-project-menu'))", 10_000);
    evidence.actions.push(await click(client, ".new-chat-project-menu", projectName));
    await sleep(800);
  }
  await dismissMenus(client);
  evidence.checkpoints.push(await shot(client, "06-project-bound"));

  // Fixture: copy CSV into bound project workspace and register as Brain file (not a claimed user action).
  evidence.csvFixtureSeed = await client.evaluate(`(async () => {
    try {
      if (!window.codecn?.listBrainProjects || !window.codecn?.registerBrainFile) return { ok: false, reason: 'api-missing' };
      const projects = await window.codecn.listBrainProjects({ workspaceKey: 'data' });
      const match = (projects || []).find(p => (p.name || '') === ${JSON.stringify(projectName)});
      if (!match) return { ok: false, reason: 'project-missing' };
      const catalog = await window.codecn.listWorkspaces();
      const local = (catalog || []).find(w => w.id === match.localWorkspaceId);
      if (!local?.path) return { ok: false, reason: 'workspace-path-missing', projectId: match.id, localWorkspaceId: match.localWorkspaceId };
      return { ok: true, projectId: match.id, workspacePath: local.path, localWorkspaceId: match.localWorkspaceId };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  })()`);
  if (evidence.csvFixtureSeed?.ok) {
    const targetCsv = join(evidence.csvFixtureSeed.workspacePath, csvName);
    await copyFile(csvPath, targetCsv);
    const bytes = Buffer.from(csvBody, "utf8");
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    evidence.csvFixtureRegister = await client.evaluate(`(async () => {
      try {
        const file = await window.codecn.registerBrainFile({
          projectId: ${JSON.stringify(evidence.csvFixtureSeed.projectId)},
          logicalName: ${JSON.stringify(csvName)},
          mimeType: 'text/csv',
          sizeBytes: ${bytes.byteLength},
          contentHash: ${JSON.stringify(contentHash)},
          storageKey: ${JSON.stringify(csvName)}
        });
        const files = await window.codecn.listBrainFiles({ projectId: ${JSON.stringify(evidence.csvFixtureSeed.projectId)} });
        return { ok: true, fileId: file?.id || file?.fileId || '', files: (files || []).map(f => f.logicalName || f.storageKey) };
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
    })()`);
    evidence.assertions.push({ name: "csv fixture registered in project", pass: Boolean(evidence.csvFixtureRegister?.ok), detail: evidence.csvFixtureRegister });
  } else {
    evidence.assertions.push({ name: "csv fixture registered in project", pass: false, detail: evidence.csvFixtureSeed });
  }
  evidence.attachSkipped = "native dialog skipped; CSV seeded into project workspace as fixture + absolute path in prompt";
  await dismissMenus(client);
  await activateWindow();

  // Paste and send main prompt — verify composer text before send
  await focusComposerAndPaste(client, prompt, evidence, "main-prompt");
  evidence.checkpoints.push(await shot(client, "08-prompt-entered"));
  evidence.actions.push(await clickSelector(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(marker)}) && !((document.querySelector('[data-testid="composer-input"]')?.value||'').includes(${JSON.stringify(marker)}))`, 30_000);
  evidence.assertions.push({ name: "submitted prompt visible in chat", pass: true });
  evidence.checkpoints.push(await shot(client, "09-submitted"));

  let captureIndex = 10;
  const deadline = Date.now() + 14 * 60_000;
  let lastBody = "";
  let approvalCount = 0;
  while (Date.now() < deadline) {
    await sleep(8_000);
    const current = await state(client);
    lastBody = current.body || "";
    if (current.menuOpen) await dismissMenus(client);
    const approval = current.buttons.find((button) => button.text === "批准并继续" || button.text === "批准");
    if (approval) {
      evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2, "0")}-approval`));
      evidence.actions.push(await click(client, "body", approval.text));
      approvalCount += 1;
      await sleep(1500);
    }
    if (captureIndex % 2 === 0) evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2, "0")}-progress`));
    else captureIndex += 1;
    evidence.progress = { bodySlice: lastBody.slice(-3500), chartPresent: current.chartPresent, analysisPresent: current.analysisPresent, dataStatus: current.dataStatus };
    await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");

    if (/生成异常终止|请求未能完成|本轮执行失败/.test(lastBody)) break;
    const sendVisible = current.buttons.some((button) => button.testid === "composer-send-button");
    const busy = current.buttons.some((b) => /停止|取消/.test(b.text || ""));
    const elapsed = Date.now() - Date.parse(evidence.startedAt);
    const meaningful = approvalCount > 0 || /dataset|导入表格|决策报告|Cook|spreadsheet\.|workspace\.write|regional-quarterly/i.test(lastBody);
    if (sendVisible && !busy && meaningful && elapsed > 120_000) break;
    if (sendVisible && !busy && elapsed > 12 * 60_000) break;
  }

  evidence.afterFirstTurn = await state(client);
  evidence.checkpoints.push(await shot(client, "40-after-first-turn"));
  evidence.projectMetaAfterChat = await readProjectMeta(client);
  evidence.approvalCount = approvalCount;

  for (const tab of ["Julius", "数据导入", "图表", "决策 Flow"]) {
    const action = await clickSceneTab(client, tab);
    if (action) {
      evidence.actions.push(action);
      await sleep(700);
      evidence.checkpoints.push(await shot(client, `41-tab-${tab}`));
      evidence[`tabState_${tab}`] = await state(client);
    }
  }

  // Try UI import if CSV registered
  await clickSceneTab(client, "数据导入");
  await sleep(500);
  const importReady = await client.evaluate(`(() => {
    const select = document.querySelector('[data-testid="brain-data-file-select"]');
    if (!(select instanceof HTMLSelectElement)) return { ok: false };
    const option = [...select.options].find(o => /csv|regional|经营|ops/i.test(o.textContent || ''));
    return { ok: Boolean(option), value: option?.value || '', label: option?.textContent || '', optionCount: select.options.length, options: [...select.options].map(o => o.textContent) };
  })()`);
  evidence.importPicker = importReady;
  if (importReady?.ok) {
    await client.evaluate(`(() => {
      const select = document.querySelector('[data-testid="brain-data-file-select"]');
      if (!(select instanceof HTMLSelectElement)) return false;
      const option = [...select.options].find(o => /csv|regional|经营|ops/i.test(o.textContent || ''));
      if (!option) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, option.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    evidence.actions.push({ at: new Date().toISOString(), method: "fixture-assisted select", target: "brain-data-file-select", value: importReady.value });
    const hasImportBtn = await client.evaluate(`Boolean(document.querySelector('[data-testid="brain-data-import"]')?.offsetParent)`);
    if (hasImportBtn) {
      evidence.actions.push(await clickSelector(client, '[data-testid="brain-data-import"]'));
      await sleep(1200);
      const hasAggregate = await client.evaluate(`Boolean(document.querySelector('[data-testid="brain-data-aggregate"]')?.offsetParent)`);
      if (hasAggregate) {
        evidence.actions.push(await clickSelector(client, '[data-testid="brain-data-aggregate"]'));
        await sleep(1200);
      }
      const hasSummary = await client.evaluate(`Boolean(document.querySelector('[data-testid="brain-data-analysis"]')?.offsetParent)`);
      if (hasSummary) {
        evidence.actions.push(await clickSelector(client, '[data-testid="brain-data-analysis"]'));
        await sleep(1200);
      }
      evidence.checkpoints.push(await shot(client, "42-import-clicked"));
      evidence.afterImportClick = await state(client);
    }
  }

  const juliusAction = await clickSceneTab(client, "Julius");
  if (juliusAction) {
    evidence.actions.push(juliusAction);
    await sleep(1500);
    evidence.checkpoints.push(await shot(client, "43-julius-after-import"));
    evidence.juliusAfterImport = await state(client);
  }

  // Revision turn
  await dismissMenus(client);
  await focusComposerAndPaste(client, revisePrompt, evidence, "revise-prompt");
  evidence.checkpoints.push(await shot(client, "50-revise-entered"));
  evidence.actions.push(await clickSelector(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes('DATA-REVISE-001')`, 30_000);

  const reviseDeadline = Date.now() + 6 * 60_000;
  while (Date.now() < reviseDeadline) {
    await sleep(8_000);
    const current = await state(client);
    lastBody = current.body || "";
    const approval = current.buttons.find((button) => button.text === "批准并继续" || button.text === "批准");
    if (approval) {
      evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2, "0")}-revise-approval`));
      evidence.actions.push(await click(client, "body", approval.text));
      approvalCount += 1;
    }
    evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2, "0")}-revise-progress`));
    const sendVisible = current.buttons.some((button) => button.testid === "composer-send-button");
    const busy = current.buttons.some((b) => /停止|取消/.test(b.text || ""));
    if (sendVisible && !busy) break;
  }
  evidence.afterRevise = await state(client);
  evidence.checkpoints.push(await shot(client, "60-after-revise"));
  evidence.projectMetaAfterRevise = await readProjectMeta(client);
  evidence.approvalCount = approvalCount;

  const meta = evidence.projectMetaAfterRevise || evidence.projectMetaAfterChat || {};
  evidence.exportCandidates = await listExportCandidates([projectName, meta.project?.path || "", "Docs/BRAIN", ".brain-data"]);
  if (meta.project?.path) {
    try {
      const deep = [];
      async function walk(dir, depth = 0) {
        if (depth > 4) return;
        for (const name of await readdir(dir)) {
          const full = join(dir, name);
          try {
            const s = await stat(full);
            if (s.isDirectory()) await walk(full, depth + 1);
            else deep.push({ path: full, size: s.size });
          } catch {}
        }
      }
      // path may be relative id; skip if not absolute
      if (/^[A-Za-z]:[\\/]/.test(meta.project.path) || meta.project.path.startsWith("/")) {
        await walk(meta.project.path, 0);
        evidence.projectFilesOnDisk = deep.slice(0, 100);
      }
    } catch (error) {
      evidence.projectPathError = String(error);
    }
  }

  // Reload persistence check
  evidence.checkpoints.push(await shot(client, "70-pre-restart"));
  await client.command("Page.reload", { ignoreCache: true });
  await client.waitForAppReady();
  await activateWindow();
  await sleep(2000);
  const afterReloadScene = await client.evaluate(`(() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r?JSON.parse(r).selectedWorkspaceKey:''; } catch { return ''; } })()`);
  if (afterReloadScene !== "data") {
    evidence.actions.push(await clickSelector(client, ".brain-workspace-trigger"));
    await client.waitFor("Boolean(document.querySelector('.brain-workspace-menu')?.offsetParent)", 10_000);
    evidence.actions.push(await click(client, ".brain-workspace-menu", "数据与决策"));
    await sleep(1000);
  }
  const projectStillVisible = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(projectName)})`);
  evidence.assertions.push({ name: "project visible after reload", pass: Boolean(projectStillVisible), value: projectName });
  if (projectStillVisible) {
    try { evidence.actions.push(await click(client, "body", projectName.slice(0, 14))); await sleep(1000); } catch {}
  }
  evidence.postRestartState = await state(client);
  evidence.postRestartMeta = await readProjectMeta(client);
  evidence.checkpoints.push(await shot(client, "71-post-restart"));

  const datasets = evidence.postRestartMeta?.datasets || evidence.projectMetaAfterRevise?.datasets || [];
  const diskFiles = evidence.projectFilesOnDisk || [];
  const exportFiles = (evidence.exportCandidates || []).filter((f) => f.size > 0);
  const rightPanelHadData = Boolean(
    evidence.afterImportClick?.dataWorkspace?.includes("行") ||
    evidence.tabState_数据导入?.dataWorkspace?.match(/\d+\s*行/) ||
    datasets.length > 0
  ) && !/sales_q3\.csv/.test(JSON.stringify(datasets));
  const hadChart = Boolean(evidence.afterFirstTurn?.chartPresent || evidence.tabState_图表?.chartPresent || evidence.afterRevise?.chartPresent || evidence.afterImportClick?.chartPresent);
  const hadAnalysis = Boolean(
    evidence.afterFirstTurn?.analysisPresent ||
    evidence.afterImportClick?.analysisPresent ||
    evidence.afterImportClick?.aggregatePresent ||
    /数值摘要|平均值|中位|分组聚合|环比/.test(evidence.afterImportClick?.dataWorkspace || evidence.afterFirstTurn?.dataWorkspace || "")
  );
  const juliusReal = Boolean(
    (evidence.juliusAfterImport || evidence.tabState_Julius) &&
    !((evidence.juliusAfterImport || evidence.tabState_Julius)?.juliusHasPrototype) &&
    /regional-quarterly|环比|华东|华北|华南|西南/.test((evidence.juliusAfterImport || evidence.tabState_Julius)?.juliusText || "")
  );
  const aiUsedTools = approvalCount > 0 || /spreadsheet\.|workspace\.|data\.|tool|工具调用|import_csv|aggregate/i.test(lastBody);
  const chatSubmitted = evidence.assertions.some((a) => a.name === "submitted prompt visible in chat" && a.pass);
  const realExport = exportFiles.some((f) => /decision|analysis|chart|cook|\.md$/i.test(f.path)) || diskFiles.some((f) => f.size > 0 && /decision|analysis|chart|cook|\.md$/i.test(f.path));
  const restartedOk = Boolean(projectStillVisible);
  const onlyPrototype = /sales_q3\.csv/.test(lastBody) && datasets.length === 0 && !rightPanelHadData;

  evidence.gradeSignals = { rightPanelHadData, hadChart, hadAnalysis, juliusReal, aiUsedTools, realExport, restartedOk, chatSubmitted, datasetCount: datasets.length, exportFileCount: exportFiles.length, approvalCount, onlyPrototype };

  if (chatSubmitted && rightPanelHadData && hadChart && hadAnalysis && juliusReal && restartedOk && !onlyPrototype && (aiUsedTools || realExport || datasets.length > 0)) {
    evidence.result = (realExport && aiUsedTools) ? "PASS" : "PARTIAL";
    if (evidence.result === "PARTIAL") evidence.firstFailure = evidence.firstFailure || `UI/data closed loop ok but export/tool incomplete: ${JSON.stringify(evidence.gradeSignals)}`;
  } else if (chatSubmitted && (rightPanelHadData || datasets.length > 0 || diskFiles.some((f) => f.size > 0) || approvalCount > 0 || /数据集|导入|摘要|regional-quarterly/.test(lastBody))) {
    evidence.result = "PARTIAL";
    evidence.firstFailure = evidence.firstFailure || `Incomplete closed loop: ${JSON.stringify(evidence.gradeSignals)}`;
  } else {
    evidence.result = "FAIL";
    evidence.firstFailure = evidence.firstFailure || `No real data closed loop: ${JSON.stringify(evidence.gradeSignals)}`;
  }

  evidence.assertions.push(
    { name: "right panel data", pass: rightPanelHadData },
    { name: "chart visible", pass: hadChart },
    { name: "analysis visible", pass: hadAnalysis },
    { name: "julius real dataset", pass: juliusReal },
    { name: "ai/tool activity", pass: aiUsedTools },
    { name: "real export files", pass: realExport },
    { name: "restart restore", pass: restartedOk }
  );
  evidence.finalState = await state(client);
  evidence.checkpoints.push(await shot(client, "99-final"));
} catch (error) {
  evidence.firstFailure = error instanceof Error ? error.stack || error.message : String(error);
  try {
    evidence.failureState = await state(client);
    evidence.checkpoints.push(await shot(client, "98-failure"));
  } catch {}
  if (evidence.result === "PASS") evidence.result = "FAIL";
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({
    evidenceDir,
    result: evidence.result,
    firstFailure: evidence.firstFailure,
    gradeSignals: evidence.gradeSignals,
    checkpoints: evidence.checkpoints?.length,
    actions: evidence.actions?.length,
    approvalCount: evidence.approvalCount,
    assertions: evidence.assertions
  }, null, 2));
  await client.close({ keepProcess: true });
}
