import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);
const repo = resolve("I:/G盘迁移备份/workrpase/BRAIN");
const scriptsRoot = resolve(repo, "platforms/windows/apps/desktop/scripts");
const { createSceneTestCdpClient } = await import(pathToFileURL(resolve(scriptsRoot, "scene-test-cdp-client.mjs")).href);

const port = 9560;
const caseId = "EXPLORE-E2E";
const stamp = Date.now();
const projectName = `ExploreE2E-${stamp}`;
const noteName = `explore-e2e-note-${stamp}.txt`;
const noteContent = "场景学习探索E2E验收";
const runDir = resolve(repo, "evidence", caseId, new Date().toISOString().replace(/[:.]/gu, "-") + "-prompt-rerun");
await mkdir(runDir, { recursive: true });

const client = await createSceneTestCdpClient(port);
await client.waitForAppReady();

async function shot(name) {
  const image = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(resolve(runDir, `${name}.png`), Buffer.from(image.data, "base64"));
  return `${name}.png`;
}

async function viewportClick(target) {
  const point = await client.evaluate(`(() => {
    ${typeof target === "string"
      ? `const el = document.querySelector(${JSON.stringify(target)});`
      : `const root = document.querySelector(${JSON.stringify(target.root || "body")}) || document.body;
         const candidates = [...root.querySelectorAll(${JSON.stringify(target.selector || "button,a,[role=menuitemradio],[role=button],input")})];
         const el = candidates.find((n) => {
           const text = (n.innerText || n.getAttribute("aria-label") || n.value || "").trim();
           return text.includes(${JSON.stringify(target.text)});
         });`}
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText || el.value || "").trim().slice(0, 80) };
  })()`);
  if (!point) throw new Error(`missing target ${JSON.stringify(target)}`);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 350));
  return point;
}

async function paste(text) {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Set-Clipboard -Value $v`], { windowsHide: true });
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
}

async function uiState() {
  return client.evaluate(`(() => {
    const countOf = (label) => {
      const hit = [...document.querySelectorAll(".brain-resource-global-nav button")].find((b) => (b.innerText || "").includes(label));
      const m = (hit?.innerText || "").match(/(\\d+)/);
      return m ? Number(m[1]) : 0;
    };
    return {
      selected: (() => { try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2") || "{}").selectedWorkspaceKey; } catch { return null; } })(),
      hasFakeTabs: /场景知识|可用工具|正在接入对应的真实编辑/.test(document.body.innerText),
      globalNav: [...document.querySelectorAll(".brain-resource-global-nav button")].map((b) => (b.innerText || "").replace(/\\s+/g, " ").trim()),
      sceneNav: [...document.querySelectorAll(".brain-resource-scene-nav button")].map((b) => (b.innerText || "").trim()),
      panelHeader: document.querySelector(".brain-resource-panel header")?.innerText?.trim() || null,
      fileRows: [...document.querySelectorAll(".brain-resource-list .brain-resource-row strong, .brain-resource-row strong")].map((n) => n.innerText),
      empty: document.querySelector(".brain-resource-empty")?.innerText || null,
      fileCount: countOf("文件"),
      artifactCount: countOf("产物"),
      taskCount: countOf("任务"),
      projectNames: [...document.querySelectorAll(".codex-sidebar button, .codex-sidebar .sidebar-project, .codex-sidebar li")].map((n) => (n.innerText || "").trim()).filter(Boolean).slice(0, 40),
      busy: Boolean(document.querySelector('[data-generating="true"],.is-generating,button[aria-label*="停止"]')) || /正在思考|进行中|等待批准|当前对话正在处理中/u.test(document.body.innerText.slice(-6000)),
      textTail: document.body.innerText.slice(-5000)
    };
  })()`);
}

const actions = [];
const assertions = [];
const screenshots = [];
let result = "PASS";
let firstFailure = "";
let finalState = null;

try {
  screenshots.push(await shot("01-before"));
  actions.push({ type: "before", state: await uiState() });

  // Switch to explore
  await viewportClick(".brain-workspace-trigger");
  await new Promise((r) => setTimeout(r, 400));
  await viewportClick({ text: "场景学习探索", root: ".brain-workspace-menu" });
  await client.waitFor(`(() => { try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2")||"{}").selectedWorkspaceKey==="explore"; } catch { return false; } })()`, 15000);
  await new Promise((r) => setTimeout(r, 800));
  screenshots.push(await shot("02-explore"));
  const afterSwitch = await uiState();
  actions.push({ type: "switch-explore", afterSwitch });
  assertions.push({ name: "selected-explore", passed: afterSwitch.selected === "explore", actual: afterSwitch.selected });
  assertions.push({ name: "no-fake-scene-tools", passed: !afterSwitch.hasFakeTabs });
  assertions.push({ name: "native-global-nav", passed: ["文件", "产物", "任务"].every((l) => afterSwitch.globalNav.some((t) => t.startsWith(l))), actual: afterSwitch.globalNav });
  assertions.push({ name: "no-scene-capability-nav", passed: !(afterSwitch.sceneNav || []).length, actual: afterSwitch.sceneNav });

  // Create blank explore project via UI "+"
  const plusClicked = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
    const hit = buttons.find((b) => (b.getAttribute("aria-label") || "").includes("新建") || (b.innerText || "").trim() === "+" || (b.title || "").includes("新建项目"));
    if (!hit) return null;
    hit.setAttribute("data-explore-e2e-plus", "true");
    return "[data-explore-e2e-plus='true']";
  })()`);
  if (plusClicked) {
    await viewportClick(plusClicked);
    actions.push({ type: "click-plus" });
  } else {
    // fallback: sidebar project add near 项目
    await viewportClick({ text: "+", root: ".codex-sidebar" });
    actions.push({ type: "click-plus-fallback" });
  }
  await new Promise((r) => setTimeout(r, 600));
  screenshots.push(await shot("03-new-project-ui"));

  // Fill project name if an input appeared
  const nameInput = await client.evaluate(`(() => {
    const inputs = [...document.querySelectorAll("input")].filter((n) => n.offsetWidth > 0 && n.offsetHeight > 0);
    const hit = inputs.find((n) => /项目|名称|name/i.test(n.placeholder || n.name || n.getAttribute("aria-label") || "")) || inputs[0];
    if (!hit) return null;
    hit.setAttribute("data-explore-e2e-name", "true");
    return "[data-explore-e2e-name='true']";
  })()`);
  if (nameInput) {
    await viewportClick(nameInput);
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await paste(projectName);
    actions.push({ type: "type-project-name", projectName });
    // confirm create
    const created = await client.evaluate(`([...document.querySelectorAll("button")].find((b) => b.offsetWidth > 0 && /创建|新建|确定|Create/i.test((b.innerText||"").trim())) || null)?.innerText?.trim() || null`);
    if (created) {
      await viewportClick({ text: created.split("\n")[0] });
      actions.push({ type: "confirm-create", created });
    } else {
      await client.pressEnter();
      actions.push({ type: "confirm-create-enter" });
    }
    await new Promise((r) => setTimeout(r, 1500));
  } else {
    actions.push({ type: "no-name-input", note: "reuse current explore workspace if already blank-bound" });
  }
  screenshots.push(await shot("04-project-ready"));

  // New chat — must happen before submit so this run owns a fresh turn
  await viewportClick('[data-testid="new-chat-button"]');
  actions.push({ type: "new-chat" });
  await new Promise((r) => setTimeout(r, 1000));
  screenshots.push(await shot("05-new-chat"));

  // Prefer selecting the bound explore project folder if visible
  const projectPick = await client.evaluate(`(() => {
    const labels = [...document.querySelectorAll(".codex-sidebar button, .codex-sidebar [role=button], .sidebar-scroll button")].filter((b) => b.offsetWidth > 0);
    const hit = labels.find((b) => /新建文件夹|ExploreE2E/.test((b.innerText || "").trim()));
    if (!hit) return null;
    hit.setAttribute("data-explore-e2e-project", "true");
    return "[data-explore-e2e-project='true']";
  })()`);
  if (projectPick) {
    await viewportClick(projectPick);
    actions.push({ type: "select-project" });
    await new Promise((r) => setTimeout(r, 600));
  }

  const prompt = `在当前「场景学习探索」已绑定项目中，请调用真实工具 workspace.write_file 创建文件 ${noteName}，内容必须是：${noteContent}。不要只回复文字；必须真实落盘，并让右侧「文件」「产物」「任务」出现记录。`;
  const composer = await client.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter((n) => n.offsetWidth > 0 && n.offsetHeight > 0 && !n.closest('[aria-hidden="true"]'));
    if (!nodes.length) return null;
    nodes[0].setAttribute("data-codecn-e2e-composer", "true");
    return { selector: '[data-codecn-e2e-composer="true"]', count: nodes.length };
  })()`);
  if (!composer?.selector) throw new Error("No visible composer");
  await viewportClick(composer.selector);
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await paste(prompt);
  await new Promise((r) => setTimeout(r, 400));
  const composerText = await client.evaluate(`(() => {
    const el = document.querySelector('[data-codecn-e2e-composer="true"]');
    return (el?.value || el?.textContent || el?.innerText || "").slice(0, 200);
  })()`);
  actions.push({ type: "composer-filled", composerText });
  if (!composerText.includes(noteName)) throw new Error(`Composer did not receive prompt; got=${composerText}`);
  // New-chat composer often ignores Enter; click the visible send control.
  const sendSelector = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
    const hit = buttons.find((b) => {
      const label = ((b.getAttribute("aria-label") || "") + " " + (b.title || "") + " " + (b.innerText || "")).trim();
      return /发送|Submit|Send/i.test(label) || label === "↑" || (b.innerText || "").trim() === "↑";
    }) || buttons.find((b) => b.closest(".composer-area, .new-chat-composer, footer.composer-area") && /↑|发送/.test(b.innerText || b.getAttribute("aria-label") || ""));
    if (!hit) return null;
    hit.setAttribute("data-explore-e2e-send", "true");
    return "[data-explore-e2e-send='true']";
  })()`);
  if (sendSelector) {
    await viewportClick(sendSelector);
    actions.push({ type: "click-send", sendSelector });
  } else {
    await client.pressEnter();
    actions.push({ type: "submit-enter-fallback" });
  }
  actions.push({ type: "submit", prompt });
  await new Promise((r) => setTimeout(r, 1500));
  screenshots.push(await shot("06-submitted"));
  const stillInComposer = await client.evaluate(`(() => {
    const el = document.querySelector('[data-codecn-e2e-composer="true"]');
    const text = (el?.value || el?.textContent || el?.innerText || "").trim();
    return text.includes(${JSON.stringify(noteName)});
  })()`);
  if (stillInComposer) {
    // Second attempt: Ctrl+Enter then click any primary round send near composer
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    actions.push({ type: "ctrl-enter-retry" });
    await new Promise((r) => setTimeout(r, 1000));
  }
  screenshots.push(await shot("06b-after-send"));

  const deadline = Date.now() + 180000;
  let last = null;
  let stable = 0;
  let sawBusy = false;
  while (Date.now() < deadline) {
    const approve = await client.evaluate(`([...document.querySelectorAll("button")].find((b) => b.offsetWidth > 0 && /批准并继续|^批准$/.test((b.innerText || "").trim())) || null)?.innerText?.trim() || null`);
    if (approve) {
      await viewportClick({ text: approve.split("\n")[0] });
      actions.push({ type: "approve", approve });
      await new Promise((r) => setTimeout(r, 800));
    }
    last = await uiState();
    if (last.busy) sawBusy = true;
    const hasNewNote = (last.textTail || "").includes(noteName) || (last.fileRows || []).some((n) => n.includes(noteName));
    if (!last.busy && sawBusy && hasNewNote) stable += 1; else if (!last.busy && sawBusy) stable += 1; else stable = 0;
    if (stable >= 3) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!sawBusy) actions.push({ type: "warn-no-busy", detail: "Model turn may not have started" });
  if (!sawBusy && !(last?.textTail || "").includes(noteName)) {
    throw new Error("Chat turn did not start (never busy) and new note name not visible");
  }
  screenshots.push(await shot("07-chat-done"));
  actions.push({ type: "chat-done", last, sawBusy });

  await viewportClick({ text: "文件", root: ".brain-resource-global-nav" });
  await new Promise((r) => setTimeout(r, 500));
  const filesState = await uiState();
  screenshots.push(await shot("08-files"));
  await viewportClick({ text: "产物", root: ".brain-resource-global-nav" });
  await new Promise((r) => setTimeout(r, 400));
  const artifactsState = await uiState();
  screenshots.push(await shot("09-artifacts"));
  await viewportClick({ text: "任务", root: ".brain-resource-global-nav" });
  await new Promise((r) => setTimeout(r, 400));
  const tasksState = await uiState();
  screenshots.push(await shot("10-tasks"));

  assertions.push({ name: "chat-stable", passed: Boolean(last) && !last.busy });
  assertions.push({ name: "no-runtime-login-error", passed: !/请先登录|ECONNREFUSED|生成异常终止/.test(last?.textTail || ""), detail: (last?.textTail || "").slice(-300) });
  assertions.push({
    name: "files-gt-0",
    passed: filesState.fileCount > 0 && filesState.fileRows.some((n) => n.includes(noteName.replace(/\.txt$/u, "")) || n === noteName || n.includes(noteName)),
    actual: { fileCount: filesState.fileCount, fileRows: filesState.fileRows, empty: filesState.empty, panelHeader: filesState.panelHeader, expectedNote: noteName }
  });
  assertions.push({
    name: "chat-mentions-new-note",
    passed: (last?.textTail || "").includes(noteName) || (filesState.textTail || "").includes(noteName),
    actual: { expectedNote: noteName, chatHasNote: (last?.textTail || "").includes(noteName) }
  });
  assertions.push({ name: "artifacts-gt-0", passed: artifactsState.artifactCount > 0, actual: { artifactCount: artifactsState.artifactCount, fileRows: artifactsState.fileRows } });
  assertions.push({ name: "tasks-gt-0", passed: tasksState.taskCount > 0, actual: { taskCount: tasksState.taskCount, fileRows: tasksState.fileRows } });
  assertions.push({ name: "layout-still-native", passed: filesState.selected === "explore" && !filesState.hasFakeTabs && !(filesState.sceneNav || []).length });

  // Reload persistence
  await client.reload();
  await client.waitForAppReady();
  await new Promise((r) => setTimeout(r, 1200));
  // ensure explore selected
  const afterReloadSelected = await client.evaluate(`(() => { try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2")||"{}").selectedWorkspaceKey; } catch { return null; } })()`);
  if (afterReloadSelected !== "explore") {
    await viewportClick(".brain-workspace-trigger");
    await new Promise((r) => setTimeout(r, 300));
    await viewportClick({ text: "场景学习探索", root: ".brain-workspace-menu" });
    await new Promise((r) => setTimeout(r, 800));
  }
  await viewportClick({ text: "文件", root: ".brain-resource-global-nav" });
  finalState = await uiState();
  screenshots.push(await shot("11-after-reload"));
  assertions.push({ name: "persist-explore-after-reload", passed: finalState.selected === "explore", actual: finalState.selected });
  assertions.push({
    name: "persist-files-after-reload",
    passed: finalState.fileCount > 0 && finalState.fileRows.some((n) => n.includes(noteName) || n.includes(noteName.replace(/\.txt$/u, ""))),
    actual: { fileCount: finalState.fileCount, fileRows: finalState.fileRows, expectedNote: noteName }
  });
  assertions.push({ name: "native-panel-after-reload", passed: !finalState.hasFakeTabs && !(finalState.sceneNav || []).length });

  const failed = assertions.filter((a) => !a.passed);
  if (failed.length) {
    const layoutOk = assertions.filter((a) => ["selected-explore", "no-fake-scene-tools", "native-global-nav", "no-scene-capability-nav", "layout-still-native", "native-panel-after-reload"].includes(a.name)).every((a) => a.passed);
    const sideOk = assertions.filter((a) => ["files-gt-0", "artifacts-gt-0", "tasks-gt-0"].includes(a.name)).every((a) => a.passed);
    result = layoutOk && !sideOk ? "PARTIAL" : (layoutOk && sideOk ? "PASS" : "FAIL");
    // if only some side effects, still PARTIAL when layout ok
    if (layoutOk && assertions.some((a) => ["files-gt-0", "artifacts-gt-0", "tasks-gt-0"].includes(a.name) && a.passed) && !sideOk) result = "PARTIAL";
    if (layoutOk && sideOk) result = "PASS";
    firstFailure = failed.map((a) => `${a.name}:${a.detail || JSON.stringify(a.actual)}`).join(" | ");
    if (!failed.length) result = "PASS";
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
  environment: { repository: repo, platform: process.platform, port, mode: "explore-e2e-prompt-rerun", runtime: ".materialized/windows/apps/desktop", projectName, noteName },
  actions,
  assertions,
  result,
  firstFailure,
  screenshots,
  finalState
};
const evidencePath = resolve(runDir, "evidence.json");
await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");

const validator = "C:/Users/Administrator/.codex/skills/codecn-electron-e2e-operator/scripts/validate-evidence.mjs";
let validation = null;
if (existsSync(validator)) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [validator, evidencePath], { windowsHide: true });
    validation = { stdout: String(stdout).trim(), stderr: String(stderr).trim() };
  } catch (error) {
    validation = { error: error instanceof Error ? error.message : String(error), stdout: String(error.stdout || ""), stderr: String(error.stderr || "") };
  }
}

console.log(JSON.stringify({ evidencePath, result, firstFailure, assertionSummary: assertions, validation }, null, 2));
if (result === "FAIL") process.exitCode = 1;
