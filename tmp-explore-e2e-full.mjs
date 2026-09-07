import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repo = resolve("I:/G盘迁移备份/workrpase/BRAIN");
const scriptsRoot = resolve(repo, "platforms/windows/apps/desktop/scripts");
const { createSceneTestCdpClient } = await import(pathToFileURL(resolve(scriptsRoot, "scene-test-cdp-client.mjs")).href);
const { osMouseClick } = await import(pathToFileURL(resolve(scriptsRoot, "scene-test-os-input.mjs")).href);

const port = 9356;
const caseId = "EXPLORE-E2E";
const runDir = resolve(repo, "evidence", caseId, new Date().toISOString().replace(/[:.]/gu, "-"));
await mkdir(runDir, { recursive: true });

const client = await createSceneTestCdpClient(port);
await client.waitForAppReady();

async function shot(name) {
  const image = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(resolve(runDir, `${name}.png`), Buffer.from(image.data, "base64"));
  return `${name}.png`;
}

async function bringToFront() {
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  if ([W]::IsIconic($p.MainWindowHandle)) { [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }
  [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 300
  Write-Output ("focused:" + $p.Id + ":" + $p.MainWindowTitle)
} else { Write-Output "no-window" }
`], { windowsHide: true });
}

async function viewportClick(selectorOrFind) {
  const point = await client.evaluate(`(() => {
    ${typeof selectorOrFind === "string"
      ? `const el = document.querySelector(${JSON.stringify(selectorOrFind)});`
      : `const root = document.querySelector(${JSON.stringify(selectorOrFind.root || "body")}) || document.body;
         const el = [...root.querySelectorAll("button,a,[role=menuitemradio],[role=button]")].find((n) => (n.innerText||"").includes(${JSON.stringify(selectorOrFind.text)}));`}
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText||"").trim().slice(0,60) };
  })()`);
  if (!point) throw new Error(`viewport target missing: ${JSON.stringify(selectorOrFind)}`);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 250));
  return point;
}

async function osClickSelector(selector) {
  // Prefer OS click with improved frame offset using window.screenX/Y + chrome height from CDP Browser.getWindowForTarget if available
  const geo = await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const chromeH = Math.max(0, window.outerHeight - window.innerHeight);
    const chromeW = Math.max(0, window.outerWidth - window.innerWidth);
    return {
      sx: Math.round(window.screenX + chromeW / 2 + r.left + r.width / 2),
      sy: Math.round(window.screenY + chromeH + r.top + r.height / 2),
      screenX: window.screenX, screenY: window.screenY, outerW: window.outerWidth, outerH: window.outerHeight, innerW: window.innerWidth, innerH: window.innerHeight
    };
  })()`);
  if (!geo) throw new Error(`os target missing: ${selector}`);
  await osMouseClick(geo.sx, geo.sy);
  return geo;
}

async function uiState() {
  return client.evaluate(`(() => ({
    selected: (() => { try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2")||"{}").selectedWorkspaceKey } catch { return null } })(),
    menuOpen: Boolean(document.querySelector(".brain-workspace-menu")),
    menuItems: [...document.querySelectorAll(".brain-workspace-menu [role=menuitemradio], .brain-workspace-menu button")].map((b) => (b.innerText||"").replace(/\\s+/g," ").trim()),
    hasFakeTabs: /场景知识|可用工具|正在接入对应的真实编辑/.test(document.body.innerText),
    globalNav: [...document.querySelectorAll(".brain-resource-global-nav button")].map((b) => (b.innerText||"").replace(/\\s+/g," ").trim()),
    sceneNav: [...document.querySelectorAll(".brain-resource-scene-nav button")].map((b) => (b.innerText||"").trim()),
    panelHeader: document.querySelector(".brain-resource-panel header")?.innerText?.trim() || null,
    fileCount: document.querySelector(".brain-resource-global-nav button")?.innerText || null,
    composerCount: [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter((n) => n.offsetWidth > 0 && n.offsetHeight > 0).length,
    visibleTail: document.body.innerText.slice(0, 2000)
  }))()`);
}

const actions = [];
const assertions = [];
const screenshots = [];
let result = "PASS";
let firstFailure = "";
let finalState = null;
const steps = {};

try {
  await bringToFront();
  screenshots.push(await shot("01-before"));
  steps.before = await uiState();
  actions.push({ type: "before", state: steps.before });

  // Open workspace menu via CDP mouse (viewport) then OS fallback
  await bringToFront();
  const cdpClick = await viewportClick(".brain-workspace-trigger");
  actions.push({ type: "cdp-click-trigger", cdpClick });
  await new Promise((r) => setTimeout(r, 400));
  let mid = await uiState();
  if (!mid.menuOpen) {
    await bringToFront();
    const osGeo = await osClickSelector(".brain-workspace-trigger");
    actions.push({ type: "os-click-trigger", osGeo });
    await new Promise((r) => setTimeout(r, 500));
    mid = await uiState();
  }
  screenshots.push(await shot("02-menu-attempt"));
  steps.menuAttempt = mid;
  if (!mid.menuOpen) throw new Error("Workspace menu did not open");

  const exploreClick = await viewportClick({ text: "场景学习探索", root: ".brain-workspace-menu" });
  actions.push({ type: "select-explore", exploreClick });
  await client.waitFor(`(() => {
    try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2")||"{}").selectedWorkspaceKey === "explore"; }
    catch { return false; }
  })()`, 15_000);
  await new Promise((r) => setTimeout(r, 800));
  steps.afterSwitch = await uiState();
  screenshots.push(await shot("03-explore"));
  actions.push({ type: "after-switch", state: steps.afterSwitch });

  assertions.push({ name: "selected-explore", passed: steps.afterSwitch.selected === "explore", actual: steps.afterSwitch.selected });
  assertions.push({ name: "no-fake-scene-tools", passed: !steps.afterSwitch.hasFakeTabs });
  assertions.push({
    name: "global-nav-files-artifacts-tasks",
    passed: ["文件", "产物", "任务"].every((label) => steps.afterSwitch.globalNav.some((t) => t.startsWith(label))),
    actual: steps.afterSwitch.globalNav
  });
  assertions.push({ name: "no-scene-capability-nav", passed: !(steps.afterSwitch.sceneNav || []).length, actual: steps.afterSwitch.sceneNav });

  // New chat
  await bringToFront();
  await viewportClick('[data-testid="new-chat-button"]');
  actions.push({ type: "new-chat" });
  await new Promise((r) => setTimeout(r, 700));
  steps.afterNewChat = await uiState();
  screenshots.push(await shot("04-new-chat"));

  // Click global tabs 文件/产物/任务
  for (const tab of ["文件", "产物", "任务"]) {
    await bringToFront();
    await viewportClick({ text: tab, root: ".brain-resource-global-nav" });
    actions.push({ type: "click-global-tab", tab });
    await new Promise((r) => setTimeout(r, 400));
    const afterTab = await uiState();
    steps[`tab-${tab}`] = { globalNav: afterTab.globalNav, sceneNav: afterTab.sceneNav, panelHeader: afterTab.panelHeader };
    screenshots.push(await shot(`05-tab-${tab}`));
  }

  // Submit a lightweight explore prompt asking to create a small real file in project
  const prompt = "在当前「场景学习探索」项目中，请用真实工具在项目里创建一个文本文件 explore-e2e-note.txt，内容写：场景学习探索E2E验收。不要只回复文字；必须产生真实文件并出现在右侧文件列表。";
  const composer = await client.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter((n) => n.offsetWidth > 0 && n.offsetHeight > 0 && !n.closest('[aria-hidden="true"]'));
    if (!nodes.length) return null;
    nodes[0].setAttribute("data-codecn-e2e-composer", "true");
    return { selector: '[data-codecn-e2e-composer="true"]', count: nodes.length };
  })()`);
  if (!composer) throw new Error("No visible composer");
  await bringToFront();
  await viewportClick(composer.selector);
  // Select all + paste via clipboard + Ctrl+V OS
  const encoded = Buffer.from(prompt, "utf8").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Set-Clipboard -Value $v`], { windowsHide: true });
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await new Promise((r) => setTimeout(r, 300));
  await client.pressEnter();
  actions.push({ type: "submit-prompt", prompt });
  screenshots.push(await shot("06-submitted"));

  // Wait completion / approval loop
  const deadline = Date.now() + 180_000;
  let last = null;
  let stable = 0;
  while (Date.now() < deadline) {
    // approve if visible
    const approveVisible = await client.evaluate(`(() => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
      const hit = buttons.find((b) => /批准并继续|批准/.test((b.innerText||"").trim()));
      return hit ? (hit.innerText||"").trim() : null;
    })()`);
    if (approveVisible) {
      await viewportClick({ text: approveVisible.split("\n")[0] });
      actions.push({ type: "approve", label: approveVisible });
      await new Promise((r) => setTimeout(r, 800));
    }
    last = await client.evaluate(`(() => ({
      busy: Boolean(document.querySelector('[data-generating="true"],.is-generating,button[aria-label*="停止"]')) || /正在思考|进行中|正在继续执行|当前对话正在处理中|等待批准/u.test(document.body.innerText.slice(-8000)),
      text: document.body.innerText.slice(-8000),
      error: document.body.innerText.match(/(?:HTTP 4\\d\\d|HTTP 5\\d\\d|生成异常终止|服务暂不可用|请先登录)/)?.[0] || null,
      hasFakeTabs: /场景知识|可用工具|正在接入对应的真实编辑/.test(document.body.innerText),
      selected: (() => { try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2")||"{}").selectedWorkspaceKey } catch { return null } })(),
      globalNav: [...document.querySelectorAll(".brain-resource-global-nav button")].map((b) => (b.innerText||"").replace(/\\s+/g," ").trim()),
      sceneNav: [...document.querySelectorAll(".brain-resource-scene-nav button")].map((b) => (b.innerText||"").trim())
    }))()`);
    if (!last.busy) stable += 1; else stable = 0;
    if (stable >= 3) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  steps.afterChat = last;
  screenshots.push(await shot("07-chat-done"));
  actions.push({ type: "chat-done", state: last });

  assertions.push({ name: "chat-completed-or-stable", passed: Boolean(last) && !last.busy });
  if (last?.error) assertions.push({ name: "no-runtime-error", passed: false, detail: last.error });
  else assertions.push({ name: "no-runtime-error", passed: true });

  // Click files tab and capture counts after chat
  await viewportClick({ text: "文件", root: ".brain-resource-global-nav" });
  steps.afterFilesTab = await uiState();
  screenshots.push(await shot("08-files-after"));
  assertions.push({
    name: "layout-still-native-after-chat",
    passed: steps.afterFilesTab.selected === "explore" && !steps.afterFilesTab.hasFakeTabs && !(steps.afterFilesTab.sceneNav || []).length
  });

  // Restart recovery: reload page via CDP (full process restart may be blocked); record as reload-level recovery
  await client.reload();
  await client.waitForAppReady();
  await new Promise((r) => setTimeout(r, 1000));
  steps.afterReload = await uiState();
  screenshots.push(await shot("09-after-reload"));
  assertions.push({ name: "persist-selected-explore-after-reload", passed: steps.afterReload.selected === "explore", actual: steps.afterReload.selected });
  assertions.push({ name: "native-panel-after-reload", passed: !steps.afterReload.hasFakeTabs && !(steps.afterReload.sceneNav || []).length, actual: { fake: steps.afterReload.hasFakeTabs, sceneNav: steps.afterReload.sceneNav, globalNav: steps.afterReload.globalNav } });

  finalState = steps.afterReload;
  const hardFails = assertions.filter((a) => a.passed === false);
  if (hardFails.length) {
    // Layout success but incomplete side-effects => PARTIAL; layout fail => FAIL
    const layoutOk = assertions.filter((a) => ["selected-explore", "no-fake-scene-tools", "global-nav-files-artifacts-tasks", "no-scene-capability-nav", "layout-still-native-after-chat", "native-panel-after-reload"].includes(a.name)).every((a) => a.passed);
    result = layoutOk ? "PARTIAL" : "FAIL";
    firstFailure = hardFails.map((a) => `${a.name}:${a.detail || a.actual || "failed"}`).join(" | ");
  }
} catch (error) {
  result = "FAIL";
  firstFailure = error instanceof Error ? error.message : String(error);
  assertions.push({ name: "execution", passed: false, detail: firstFailure });
  try {
    finalState = await uiState();
    screenshots.push(await shot("failure"));
  } catch {}
} finally {
  await client.close();
}

const evidence = {
  caseId,
  timestamp: new Date().toISOString(),
  environment: { repository: repo, platform: process.platform, port, mode: "explore-e2e-full", runtime: ".materialized/windows/apps/desktop" },
  actions,
  assertions,
  result,
  firstFailure,
  screenshots,
  steps,
  finalState
};
await writeFile(resolve(runDir, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
console.log(JSON.stringify({ evidencePath: resolve(runDir, "evidence.json"), result, firstFailure, assertionSummary: assertions }, null, 2));
if (result === "FAIL") process.exitCode = 1;
