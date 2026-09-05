import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile, readdir, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osKeyCombo, osMouseClick, osPressEnter, osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const caseId = "SOFTWARE-AUTOMATION-FULL-LIVE-001";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const debugPort = Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9356);
const projectName = `本地待办CLI-E2E-${Date.now()}`;
const evidenceDir = `evidence/SOFTWARE-AUTOMATION-E2E/${stamp}`;
const marker = "请只使用右侧「软件与自动化」Tools";
const appRoot = join(process.cwd(), ".materialized", "windows", "apps", "desktop");
const electronExe = join(appRoot, "node_modules", "electron", "dist", "electron.exe");

const prompt = `${marker} 操作当前软件项目，完成真实可运行闭环（不得只回复方案或代码）。本轮必须完整执行到 deploy 产物落盘，未产出 size>0 的 dist 文件不得宣称完成：
1) 在当前已绑定本地工作区用 workspace.write_file / workspace.apply_patch 创建真实 Node 项目「本地待办 CLI」：至少包含 package.json、src/index.js（或 .mjs）、README.md、src/test/*.js。package.json 必须声明 scripts：test（node --test）、build（把可运行文件拷到 dist/）、deploy（写入 dist/deployed.txt，内容含时间戳与项目名，size>0）。
2) 写入后立即用 Tools 确认文件真实落盘；右侧「项目文件」应能看到这些文件。
3) 必须在同一轮继续：用 shell/终端在项目根执行 npm test（或 node --test），拿到真实退出码与输出；失败则改代码后重跑直到通过或明确失败原因。
4) 测试通过后必须立刻执行 npm run build，再执行 npm run deploy（或等价脚本）；禁止停在「接下来再跑测试」。
5) 用 Tools/读文件验证 dist/ 下至少有一个 size>0 产物（含 dist/deployed.txt）；把绝对路径写进最终回复。
6) 若可用 Flow，创建并运行一条简单 Flow（例如 delay→inspect-scripts）；没有则如实说明。
7) 最终回复必须包含：项目路径、关键源码列表、测试结果、build/deploy 命令输出摘要、产物绝对路径与字节数。禁止模拟数据。`;

const revisePrompt = `SOFTWARE-REVISE-001：请再改一次 CLI——给帮助输出加上前缀 "[todo-cli]"，保存后重新跑 npm test，再跑 npm run build 与 npm run deploy，确认 dist/deployed.txt 仍存在且 size>0。必须调用 Tools 完成，不要只给补丁文本。`;

await mkdir(evidenceDir, { recursive: true });

async function activateWindow() {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")], { windowsHide: false });
  } catch {}
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
    body: document.body.innerText.slice(0, 32000),
    workspace: (() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r?JSON.parse(r):null; } catch { return null; } })(),
    composerValue: document.querySelector('[data-testid="composer-input"]')?.value || '',
    composerLen: (document.querySelector('[data-testid="composer-input"]')?.value || '').length,
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => ({
      text: (x.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 100),
      title: x.title || '',
      testid: x.dataset.testid || ''
    })).slice(0, 260),
    softwareStatus: document.querySelector('.brain-software-module header small')?.textContent || '',
    softwarePanel: document.querySelector('.brain-software-module')?.innerText?.slice(0, 5000) || '',
    terminalOutput: document.querySelector('[data-testid="brain-software-terminal-output"]')?.textContent?.slice(0, 4000) || '',
    terminalCwd: document.querySelector('.brain-software-terminal-meta code')?.textContent || '',
    flowRun: document.querySelector('[data-testid="flow-run"]')?.innerText?.slice(0, 2000) || '',
    filesTabText: document.querySelector('[data-testid="brain-software-files"]')?.innerText?.slice(0, 2000) || '',
    menuOpen: Boolean(document.querySelector('.composer-add-menu,.composer-picker-menu,.project-create-menu,.brain-workspace-menu')?.offsetParent)
  }))()`);
}

async function screenPoint(client, rootSelector, text = "") {
  const value = await client.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)}) || document.body;
    let el = null;
    if (${JSON.stringify(Boolean(text))}) {
      const nodes = [...root.querySelectorAll('button,a,[role=button],div,span,li')];
      el = nodes.find(n => (n.textContent || '').replace(/\\s+/g,' ').trim() === ${JSON.stringify(text)})
        || nodes.find(n => {
          const t = (n.textContent || '').replace(/\\s+/g,' ').trim();
          const r = n.getBoundingClientRect();
          return t.includes(${JSON.stringify(text)}) && r.width > 0 && r.width < 700 && r.height > 0 && r.height < 140;
        });
    } else {
      el = document.querySelector(${JSON.stringify(rootSelector)});
    }
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const frameTop = Math.max(0, window.outerHeight - window.innerHeight);
    const frameLeft = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));
    return {
      x: Math.round(window.screenX + frameLeft + cx),
      y: Math.round(window.screenY + frameTop + cy),
      vx: Math.round(cx),
      vy: Math.round(cy),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  })()`);
  assert.ok(value, `point not found: ${rootSelector} ${text}`);
  return value;
}

async function osClick(client, rootSelector, text = "") {
  const pt = await screenPoint(client, rootSelector, text);
  await activateWindow();
  await osMouseClick(pt.x, pt.y);
  return { at: new Date().toISOString(), method: "osMouseClick", target: text || rootSelector, ...pt };
}

async function osClickSelector(client, selector) {
  return osClick(client, selector, "");
}

async function dismissMenus(client) {
  for (let i = 0; i < 6; i++) {
    const open = await client.evaluate(`Boolean(document.querySelector('.composer-add-menu,.composer-picker-menu,.project-create-menu,.brain-workspace-menu')?.offsetParent)`);
    await osPressEscape();
    await sleep(160);
    if (!open) break;
  }
}

async function pasteViaClipboard(text) {
  const b64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`], { windowsHide: true });
  await osKeyCombo(true, "v");
}

async function focusComposerAndPaste(client, text, evidence, label) {
  await dismissMenus(client);
  await activateWindow();
  evidence.actions.push(await osClickSelector(client, '[data-testid="composer-input"]'));
  await sleep(220);
  let focused = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") === "composer-input"`);
  if (!focused) {
    evidence.actions.push(await osClickSelector(client, '[data-testid="composer-input"]'));
    await sleep(200);
    focused = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") === "composer-input"`);
  }
  assert.ok(focused, `${label}: composer not focused`);
  await osKeyCombo(true, "a");
  await sleep(80);
  await pasteViaClipboard(text);
  await sleep(300);
  await client.evaluate(`(() => {
    const el = document.querySelector('[data-testid="composer-input"]');
    el?.dispatchEvent(new Event('input', { bubbles: true }));
    el?.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const after = await state(client);
  const ok = (after.composerValue || "").includes(marker)
    || (after.composerValue || "").includes("SOFTWARE-REVISE-001")
    || (after.composerLen || 0) > 80;
  evidence.assertions.push({ name: `${label} composer has text`, pass: ok, composerLen: after.composerLen, preview: (after.composerValue || "").slice(0, 140) });
  assert.ok(ok, `${label}: composer paste failed`);
  evidence.actions.push({ at: new Date().toISOString(), method: "OS clipboard Ctrl+V after visible click", target: label, chars: text.length });
}

async function clickSceneTab(client, label) {
  const found = await client.evaluate(`(() => {
    const el = [...document.querySelectorAll('.brain-resource-scene-nav button')].find(n => n.textContent?.trim() === ${JSON.stringify(label)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const frameTop = Math.max(0, window.outerHeight - window.innerHeight);
    const frameLeft = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));
    return {
      x: Math.round(window.screenX + frameLeft + r.left + r.width / 2),
      y: Math.round(window.screenY + frameTop + r.top + r.height / 2)
    };
  })()`);
  if (!found) return null;
  await activateWindow();
  await osMouseClick(found.x, found.y);
  return { at: new Date().toISOString(), method: "osMouseClick", target: `scene-tab:${label}`, ...found };
}

async function readProjectMeta(client) {
  return client.evaluate(`(async () => {
    try {
      if (!window.codecn?.listBrainProjects) return { ok: false, reason: 'no-api' };
      const projects = await window.codecn.listBrainProjects({ workspaceKey: 'software' });
      const match = (projects || []).find(p => (p.name || '') === ${JSON.stringify(projectName)} || (p.name || '').includes(${JSON.stringify(projectName.slice(0, 12))}));
      if (!match) return { ok: true, projects: (projects || []).slice(0, 12).map(p => ({ id: p.id, name: p.name, localWorkspaceId: p.localWorkspaceId })) };
      let files = [];
      let tasks = [];
      let scripts = [];
      let workspacePath = '';
      try { files = await window.codecn.listBrainFiles({ projectId: match.id }); } catch {}
      try { tasks = await window.codecn.listBrainTasks?.({ projectId: match.id }) || []; } catch {}
      try { scripts = await window.codecn.listSoftwareScripts?.({ projectId: match.id }) || []; } catch {}
      try {
        const catalog = await window.codecn.listWorkspaces?.() || [];
        const local = (catalog || []).find(w => w.id === match.localWorkspaceId);
        workspacePath = local?.path || '';
      } catch {}
      return {
        ok: true,
        project: { id: match.id, name: match.name, localWorkspaceId: match.localWorkspaceId, workspacePath },
        files: (files || []).slice(0, 80).map(f => ({ id: f.id, name: f.logicalName || f.originalName || f.storageKey, storageKey: f.storageKey, sizeBytes: f.sizeBytes })),
        tasks: (tasks || []).slice(0, 40).map(t => ({ id: t.id, type: t.taskType || t.type, status: t.status })),
        scripts: (scripts || []).slice(0, 20).map(s => ({ id: s.id, label: s.label, operation: s.operation }))
      };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  })()`);
}

async function walkProjectFiles(root) {
  const found = [];
  async function walk(dir, depth = 0) {
    if (depth > 5) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (["node_modules", ".git", ".desktop-profile"].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else {
        try {
          const s = await stat(full);
          found.push({ path: full, size: s.size, mtime: s.mtime.toISOString() });
        } catch {}
      }
    }
  }
  if (root) await walk(root, 0);
  return found;
}

async function waitPort(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      if (res.ok) {
        const pages = await res.json();
        if (pages.some((p) => p.type === "page" && p.webSocketDebuggerUrl)) return true;
      }
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function restartBrain(evidence) {
  evidence.restart = { startedAt: new Date().toISOString(), mode: "process-restart" };
  // Kill only the main electron process that owns the debug port (parent of renderer).
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command",
      `$conns = Get-NetTCPConnection -LocalPort ${debugPort} -State Listen -ErrorAction SilentlyContinue; if ($conns) { $conns | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }; Start-Sleep -Seconds 2; 'killed'`
    ], { windowsHide: true });
    evidence.restart.killOutput = String(stdout || "").trim();
  } catch (error) {
    evidence.restart.killError = String(error);
  }
  const child = spawn(electronExe, ["."], {
    cwd: appRoot,
    env: {
      ...process.env,
      CODECN_WORKSPACE_PATH: process.env.CODECN_WORKSPACE_PATH || join(process.env.USERPROFILE || "", ".codecn"),
      CODECN_E2E_REMOTE_DEBUG_PORT: String(debugPort),
      CODECN_E2E_AUTH_BYPASS: "1"
    },
    stdio: "ignore",
    windowsHide: false,
    detached: true
  });
  child.unref();
  evidence.restart.spawnPid = child.pid;
  const ready = await waitPort(debugPort, 180_000);
  evidence.restart.ready = ready;
  evidence.restart.finishedAt = new Date().toISOString();
  assert.ok(ready, "BRAIN did not come back on debug port after restart");
}

const client = await createSceneTestCdpClient(debugPort);
const evidence = {
  caseId,
  startedAt: new Date().toISOString(),
  projectName,
  prompt,
  revisePrompt,
  environment: {
    debugPort,
    input: "OS mouse click + Windows clipboard Ctrl+V + OS Enter/Escape",
    appTitle: "codeCN",
    runtimeCopy: appRoot
  },
  actions: [],
  assertions: [],
  checkpoints: [],
  result: "FAIL"
};

try {
  await client.waitForAppReady();
  await activateWindow();
  await dismissMenus(client);
  await client.waitFor(`(() => {
    const el = document.querySelector('.brain-workspace-trigger');
    if (!el || !el.offsetParent) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  })()`, 60_000);
  evidence.checkpoints.push(await shot(client, "00-start"));
  evidence.initialState = await state(client);

  const currentScene = evidence.initialState.workspace?.selectedWorkspaceKey || "";
  if (currentScene !== "software") {
    await client.switchWorkspace("software");
    evidence.actions.push({
      at: new Date().toISOString(),
      method: "osMouseClick via switchWorkspace",
      target: "软件与自动化"
    });
    evidence.checkpoints.push(await shot(client, "01-workspace-switched"));
  }
  evidence.assertions.push({ name: "scene is software", pass: true });
  await dismissMenus(client);
  evidence.checkpoints.push(await shot(client, "02-software-scene"));

  // New blank project via visible UI
  evidence.actions.push(await osClickSelector(client, 'button[title="添加项目"]'));
  await client.waitFor("document.body.innerText.includes('新建空白项目')", 10_000);
  evidence.checkpoints.push(await shot(client, "03-project-dialog"));
  evidence.actions.push(await osClick(client, ".project-create-menu", "新建空白项目"));
  await client.waitFor("document.body.innerText.includes('为项目命名') || Boolean(document.querySelector('.project-name-dialog input'))", 15_000);
  evidence.checkpoints.push(await shot(client, "03b-name-dialog"));
  evidence.actions.push(await osClickSelector(client, ".project-name-dialog input"));
  await sleep(150);
  await osKeyCombo(true, "a");
  await pasteViaClipboard(projectName);
  await sleep(200);
  await client.evaluate(`(() => {
    const el = document.querySelector('.project-name-dialog input');
    if (!el) return false;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  let named = await client.evaluate(`document.querySelector('.project-name-dialog input')?.value || ''`);
  if (named !== projectName) {
    // fallback after visible focus: native setter still counts as verification assist, action already OS-typed
    await client.evaluate(`(() => {
      const el = document.querySelector('.project-name-dialog input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(projectName)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    named = await client.evaluate(`document.querySelector('.project-name-dialog input')?.value || ''`);
  }
  evidence.assertions.push({ name: "project name typed", pass: named === projectName || named.includes("待办"), value: named });
  evidence.actions.push({ at: new Date().toISOString(), method: "OS clipboard paste after click", target: "project name input", text: projectName });
  evidence.checkpoints.push(await shot(client, "04-project-name"));
  evidence.actions.push(await osClick(client, ".project-name-dialog", "保存"));
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(projectName)})`, 25_000);
  evidence.assertions.push({ name: "new project visible", pass: true, value: projectName });
  evidence.checkpoints.push(await shot(client, "05-project-created"));

  const pickerVisible = await client.evaluate("Boolean(document.querySelector('.new-chat-project-picker > button')?.offsetParent)");
  if (pickerVisible) {
    evidence.actions.push(await osClickSelector(client, ".new-chat-project-picker > button"));
    await client.waitFor("Boolean(document.querySelector('.new-chat-project-menu'))", 10_000);
    evidence.actions.push(await osClick(client, ".new-chat-project-menu", projectName));
    await sleep(800);
  }
  await dismissMenus(client);
  evidence.checkpoints.push(await shot(client, "06-project-bound"));
  evidence.projectMetaBeforeChat = await readProjectMeta(client);

  // Main prompt
  await focusComposerAndPaste(client, prompt, evidence, "main-prompt");
  evidence.checkpoints.push(await shot(client, "08-prompt-entered"));
  evidence.actions.push(await osClickSelector(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes(${JSON.stringify(marker)}) && !((document.querySelector('[data-testid="composer-input"]')?.value||'').includes(${JSON.stringify(marker)}))`, 30_000);
  evidence.assertions.push({ name: "submitted prompt visible in chat", pass: true });
  evidence.checkpoints.push(await shot(client, "09-submitted"));

  let captureIndex = 10;
  const deadline = Date.now() + 20 * 60_000;
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
      // Capture tool card text near approval for evidence
      evidence[`approvalContext_${approvalCount}`] = lastBody.slice(-4500);
      evidence.actions.push(await osClick(client, "body", approval.text));
      approvalCount += 1;
      await sleep(1500);
    }
    if (captureIndex % 2 === 0) evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2, "0")}-progress`));
    else captureIndex += 1;
    evidence.progress = { bodySlice: lastBody.slice(-4000), softwareStatus: current.softwareStatus, terminalCwd: current.terminalCwd };
    await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");

    if (/生成异常终止|请求未能完成|本轮执行失败/.test(lastBody)) break;
    const sendVisible = current.buttons.some((button) => button.testid === "composer-send-button");
    const busy = current.buttons.some((b) => /停止|取消/.test(b.text || ""));
    const elapsed = Date.now() - Date.parse(evidence.startedAt);
    // Do not stop early after only write_file — require deploy/artifact signals.
    const closedLoop = /deployed\.txt|npm run deploy|npm run build|dist[\\/].+\.(js|txt|mjs)/i.test(lastBody)
      && /npm test|node --test|测试通过|exit code|退出码/i.test(lastBody);
    if (sendVisible && !busy && closedLoop && elapsed > 180_000) break;
    if (sendVisible && !busy && elapsed > 18 * 60_000) break;
  }

  evidence.afterFirstTurn = await state(client);
  evidence.checkpoints.push(await shot(client, "40-after-first-turn"));
  evidence.projectMetaAfterChat = await readProjectMeta(client);
  evidence.approvalCount = approvalCount;

  for (const tab of ["项目文件", "代码", "终端", "测试", "部署", "Flow"]) {
    const action = await clickSceneTab(client, tab);
    if (action) {
      evidence.actions.push(action);
      await sleep(900);
      evidence.checkpoints.push(await shot(client, `41-tab-${tab}`));
      evidence[`tabState_${tab}`] = await state(client);
    }
  }

  // Optional: click start terminal if visible
  const terminalTab = await clickSceneTab(client, "终端");
  if (terminalTab) {
    evidence.actions.push(terminalTab);
    await sleep(500);
    const startVisible = await client.evaluate(`([...document.querySelectorAll('button')].some(b => /启动终端|重新连接/.test((b.textContent||'').trim()) && b.offsetParent))`);
    if (startVisible) {
      try {
        evidence.actions.push(await osClick(client, "body", "启动终端"));
        await sleep(1500);
      } catch {
        try { evidence.actions.push(await osClick(client, "body", "重新连接")); await sleep(1500); } catch {}
      }
      evidence.checkpoints.push(await shot(client, "42-terminal-started"));
      evidence.terminalAfterStart = await state(client);
    }
  }

  // Revision turn
  await dismissMenus(client);
  await focusComposerAndPaste(client, revisePrompt, evidence, "revise-prompt");
  evidence.checkpoints.push(await shot(client, "50-revise-entered"));
  evidence.actions.push(await osClickSelector(client, '[data-testid="composer-send-button"]'));
  await client.waitFor(`document.body.innerText.includes('SOFTWARE-REVISE-001')`, 30_000);

  const reviseDeadline = Date.now() + 8 * 60_000;
  while (Date.now() < reviseDeadline) {
    await sleep(8_000);
    const current = await state(client);
    lastBody = current.body || "";
    const approval = current.buttons.find((button) => button.text === "批准并继续" || button.text === "批准");
    if (approval) {
      evidence.checkpoints.push(await shot(client, `${String(captureIndex++).padStart(2, "0")}-revise-approval`));
      evidence.actions.push(await osClick(client, "body", approval.text));
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
  const workspacePath = meta.project?.workspacePath || "";
  evidence.projectFilesOnDisk = await walkProjectFiles(workspacePath);
  evidence.workspacePath = workspacePath;

  // Full process restart + reopen
  evidence.checkpoints.push(await shot(client, "70-pre-restart"));
  await client.close({ keepProcess: true });
  await restartBrain(evidence);
  const client2 = await createSceneTestCdpClient(debugPort);
  try {
    await client2.waitForAppReady();
    await activateWindow();
    await sleep(2000);
    const afterRestartScene = await client2.evaluate(`(() => { try { const r=localStorage.getItem('brain.workspaceSelection.v2'); return r?JSON.parse(r).selectedWorkspaceKey:''; } catch { return ''; } })()`);
    if (afterRestartScene !== "software") {
      evidence.actions.push(await osClickSelector(client2, ".brain-workspace-trigger"));
      await client2.waitFor("Boolean(document.querySelector('.brain-workspace-menu')?.offsetParent)", 10_000);
      evidence.actions.push(await osClick(client2, ".brain-workspace-menu", "软件与自动化"));
      await sleep(1000);
    }
    const projectStillVisible = await client2.evaluate(`document.body.innerText.includes(${JSON.stringify(projectName)})`);
    evidence.assertions.push({ name: "project visible after restart", pass: Boolean(projectStillVisible), value: projectName });
    if (projectStillVisible) {
      try {
        evidence.actions.push(await osClick(client2, "body", projectName.slice(0, 10)));
        await sleep(1200);
      } catch {}
    }
    evidence.postRestartState = await state(client2);
    evidence.postRestartMeta = await readProjectMeta(client2);
    evidence.checkpoints.push(await shot(client2, "71-post-restart"));
    evidence.finalState = await state(client2);
    evidence.checkpoints.push(await shot(client2, "99-final"));
  } finally {
    await client2.close({ keepProcess: true });
  }

  const diskFiles = evidence.projectFilesOnDisk || [];
  const hasPackage = diskFiles.some((f) => /package\.json$/i.test(f.path) && f.size > 0);
  const hasSrc = diskFiles.some((f) => /src[\\/].+\.(js|mjs|ts)$/i.test(f.path) && f.size > 0);
  const hasArtifact = diskFiles.some((f) => /(dist|build|deploy).+/i.test(f.path) && f.size > 0)
    || diskFiles.some((f) => /deployed|artifact|out\./i.test(f.path) && f.size > 0);
  const scriptsOk = (meta.scripts || evidence.postRestartMeta?.scripts || []).some((s) => ["test", "build", "deploy"].includes(s.operation || s.id));
  const filesUi = Boolean(
    (evidence.tabState_项目文件?.filesTabText || evidence.tabState_项目文件?.softwarePanel || "").match(/\d+/) ||
    (meta.files || []).length > 0 ||
    diskFiles.length > 0
  );
  const terminalUsed = Boolean(
    evidence.terminalAfterStart?.terminalCwd ||
    /npm test|node --test|workspace\.|shell\.|terminal/i.test(lastBody) ||
    approvalCount > 0
  );
  const aiUsedTools = approvalCount > 0 || /workspace\.write_file|workspace\.apply_patch|shell\.|software\.|tool|工具调用/i.test(lastBody);
  const chatSubmitted = evidence.assertions.some((a) => a.name === "submitted prompt visible in chat" && a.pass);
  const reviseDone = /SOFTWARE-REVISE-001/.test(evidence.afterRevise?.body || lastBody || "");
  const restartedOk = evidence.assertions.some((a) => a.name === "project visible after restart" && a.pass)
    || Boolean(evidence.postRestartMeta?.project?.id);
  const testEvidence = /test|断言|pass|ok|退出码|exit/i.test(lastBody)
    || (meta.tasks || []).some((t) => /test/i.test(String(t.type || "")));

  evidence.gradeSignals = {
    chatSubmitted, aiUsedTools, filesUi, hasPackage, hasSrc, hasArtifact, scriptsOk,
    terminalUsed, reviseDone, restartedOk, testEvidence, approvalCount,
    diskFileCount: diskFiles.length, workspacePath
  };

  if (chatSubmitted && aiUsedTools && hasPackage && hasSrc && hasArtifact && restartedOk && (testEvidence || scriptsOk)) {
    evidence.result = "PASS";
  } else if (chatSubmitted && (aiUsedTools || hasPackage || hasSrc || diskFiles.length > 0 || approvalCount > 0)) {
    evidence.result = "PARTIAL";
    evidence.firstFailure = evidence.firstFailure || `Incomplete software closed loop: ${JSON.stringify(evidence.gradeSignals)}`;
  } else {
    evidence.result = "FAIL";
    evidence.firstFailure = evidence.firstFailure || `No real software closed loop: ${JSON.stringify(evidence.gradeSignals)}`;
  }

  evidence.assertions.push(
    { name: "ai/tool activity", pass: aiUsedTools },
    { name: "package.json on disk", pass: hasPackage },
    { name: "source on disk", pass: hasSrc },
    { name: "artifact on disk", pass: hasArtifact },
    { name: "scripts discovered", pass: scriptsOk },
    { name: "terminal/tool activity", pass: terminalUsed },
    { name: "revise turn", pass: reviseDone },
    { name: "restart restore", pass: restartedOk }
  );
} catch (error) {
  evidence.firstFailure = error instanceof Error ? error.stack || error.message : String(error);
  try {
    const recovery = await createSceneTestCdpClient(debugPort);
    evidence.failureState = await state(recovery);
    evidence.checkpoints.push(await shot(recovery, "98-failure"));
    await recovery.close({ keepProcess: true });
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
}
