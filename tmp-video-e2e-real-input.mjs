import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osKeyCombo, osMouseClick } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const caseId = "VIDEO-E2E-REAL-001";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = `evidence/${caseId}/${stamp}`;
await mkdir(evidenceDir, { recursive: true });

async function activateWindow() {
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$w=New-Object -ComObject WScript.Shell; if(-not $w.AppActivate('codeCN')){exit 2}"], { windowsHide: true });
}

async function clipboardPaste(text) {
  const base64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${base64}')))`], { windowsHide: true });
  await osKeyCombo(true, "v");
}

async function screenshot(client, name) {
  const result = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const path = `${evidenceDir}/${name}.png`;
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
}

async function readVisibleState(client) {
  return client.evaluate(`(() => ({
    title: document.title,
    body: document.body.innerText.slice(0, 12000),
    buttons: [...document.querySelectorAll('button')].filter(x => x.offsetParent).map(x => ({text:x.textContent?.trim(), testid:x.dataset.testid, title:x.title})).slice(0,120),
    inputs: [...document.querySelectorAll('textarea,input,[contenteditable=true]')].filter(x => x.offsetParent).map(x => ({tag:x.tagName,placeholder:x.getAttribute('placeholder'),testid:x.dataset.testid,aria:x.getAttribute('aria-label')})).slice(0,50)
  }))()`);
}

async function rawScreenPoint(client, selector, text = "") {
  const point = await client.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)}) || document.body;
    const el = ${text ? `[...root.querySelectorAll('button,a,[role=button]')].find(n => n.textContent?.trim() === ${JSON.stringify(text)})` : "root"};
    if (!el) return null;
    el.scrollIntoView({block:'center',inline:'center'});
    const r = el.getBoundingClientRect();
    return {x:Math.round(window.screenX+r.left+r.width/2),y:Math.round(window.screenY+r.top+r.height/2),rect:{left:r.left,top:r.top,width:r.width,height:r.height},window:{screenX:window.screenX,screenY:window.screenY,outerWidth:window.outerWidth,outerHeight:window.outerHeight,innerWidth:window.innerWidth,innerHeight:window.innerHeight}};
  })()`);
  assert.ok(point, `${selector} ${text}`);
  return point;
}

async function rawClick(client, selector, text = "") {
  const point = await rawScreenPoint(client, selector, text);
  await osMouseClick(point.x, point.y);
  return { method: "osMouseClick", target: text || selector, ...point };
}

const client = await createSceneTestCdpClient(Number(process.env.CODECN_E2E_REMOTE_DEBUG_PORT || 9666));
const evidence = { caseId, startedAt: new Date().toISOString(), evidenceDir, actions: [], assertions: [], result: "FAIL" };
try {
  await client.waitForAppReady();
  await activateWindow();
  evidence.before = await screenshot(client, "00-startup");
  evidence.initialState = await readVisibleState(client);
  evidence.actions.push(await rawClick(client, ".brain-workspace-trigger"));
  await client.waitFor("Boolean(document.querySelector('.brain-workspace-menu'))", 10_000);
  evidence.workspaceMenu = await screenshot(client, "01-workspace-menu");
  evidence.actions.push(await rawClick(client, ".brain-workspace-menu", "视频制作"));
  await client.waitFor(`(() => { try { const raw=localStorage.getItem('brain.workspaceSelection.v2'); return raw && JSON.parse(raw).selectedWorkspaceKey === 'video'; } catch { return false; } })()`, 15_000);
  await new Promise((resolve) => setTimeout(resolve, 800));
  evidence.videoScene = await screenshot(client, "02-video-scene");
  evidence.videoState = await readVisibleState(client);
  evidence.actions.push(await rawClick(client, 'button[title="添加项目"]'));
  await new Promise((resolve) => setTimeout(resolve, 500));
  evidence.projectDialog = await screenshot(client, "03-project-dialog");
  evidence.projectDialogState = await readVisibleState(client);
  evidence.actions.push(await rawClick(client, "body", "新建空白项目"));
  await new Promise((resolve) => setTimeout(resolve, 700));
  evidence.blankProject = await screenshot(client, "04-blank-project");
  evidence.blankProjectState = await readVisibleState(client);
  console.log(JSON.stringify({ evidenceDir, videoState: evidence.videoState }, null, 2));
} finally {
  await writeFile(`${evidenceDir}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
  await client.close({ keepProcess: true });
}
