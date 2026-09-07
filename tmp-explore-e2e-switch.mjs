import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve("I:/G盘迁移备份/workrpase/BRAIN");
const scriptsRoot = resolve(repo, "platforms/windows/apps/desktop/scripts");
const { createSceneTestCdpClient } = await import(pathToFileURL(resolve(scriptsRoot, "scene-test-cdp-client.mjs")).href);
const { osMouseClick } = await import(pathToFileURL(resolve(scriptsRoot, "scene-test-os-input.mjs")).href);

const port = 9356;
const caseId = "EXPLORE-SWITCH-002";
const runDir = resolve(repo, "evidence", caseId, new Date().toISOString().replace(/[:.]/gu, "-"));
await mkdir(runDir, { recursive: true });

const client = await createSceneTestCdpClient(port);
await client.waitForAppReady();

async function shot(name) {
  const image = await client.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(resolve(runDir, `${name}.png`), Buffer.from(image.data, "base64"));
}

async function state() {
  return client.evaluate(`(() => ({
    selected: (() => { try { return JSON.parse(localStorage.getItem('brain.workspaceSelection.v2')||'{}').selectedWorkspaceKey } catch { return null } })(),
    trigger: (() => {
      const el = document.querySelector('.brain-workspace-trigger');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: (el.innerText||'').trim().slice(0,80), x: r.x, y: r.y, w: r.width, h: r.height, disabled: el.disabled, aria: el.getAttribute('aria-expanded') };
    })(),
    menuOpen: Boolean(document.querySelector('.brain-workspace-menu')),
    menuItems: [...document.querySelectorAll('.brain-workspace-menu button,[role="menuitem"]')].map((b) => (b.innerText||'').trim().slice(0,40)),
    hasFakeTabs: /场景知识|可用工具|正在接入对应的真实编辑/.test(document.body.innerText),
    globalNav: [...document.querySelectorAll('.brain-resource-global-nav button')].map((b) => (b.innerText||'').replace(/\\s+/g,' ').trim()),
    sceneNav: [...document.querySelectorAll('.brain-resource-scene-nav button')].map((b) => (b.innerText||'').trim()),
    panelHeader: document.querySelector('.brain-resource-panel header')?.innerText?.trim() || null,
    visibleTail: document.body.innerText.slice(0, 1500)
  }))()`);
}

const actions = [];
const assertions = [];
let result = "PASS";
let firstFailure = "";
let finalState = null;

try {
  await shot("before");
  const before = await state();
  actions.push({ type: "inspect-before", before });
  console.log(JSON.stringify({ before }, null, 2));

  // Ensure window focused via OS click on trigger coords
  const box = before.trigger;
  if (!box) throw new Error("No .brain-workspace-trigger found");

  // Try CDP mouse then wait for menu; fallback OS click
  await client.mouseClickSelector(".brain-workspace-trigger");
  actions.push({ type: "click-trigger-cdp" });
  await new Promise((r) => setTimeout(r, 800));
  let mid = await state();
  if (!mid.menuOpen) {
    const cx = Math.round(box.x + box.w / 2);
    const cy = Math.round(box.y + box.h / 2);
    // Need screen coords - get window bounds
    const win = await client.evaluate(`({ innerWidth, innerHeight, screenX: window.screenX, screenY: window.screenY, dpr: window.devicePixelRatio })`);
    // Use CDP Input.dispatchMouseEvent which mouseClickSelector already uses; try clicking by text of current scene
    await client.mouseClickButtonText(box.text.split("\n")[0] || "文档创作");
    actions.push({ type: "click-trigger-by-text", text: box.text, win });
    await new Promise((r) => setTimeout(r, 800));
    mid = await state();
  }
  if (!mid.menuOpen) {
    // Force open via evaluating click is forbidden for acceptance; but for diagnosis record failure path
    // Try keyboard / focus then Enter
    await client.evaluate(`document.querySelector('.brain-workspace-trigger')?.focus()`);
    await client.pressEnter();
    actions.push({ type: "focus-trigger-enter" });
    await new Promise((r) => setTimeout(r, 800));
    mid = await state();
  }
  console.log(JSON.stringify({ mid }, null, 2));
  await shot("menu-attempt");

  if (!mid.menuOpen) throw new Error("Workspace menu did not open after clicks");

  await client.mouseClickButtonText("场景学习探索", ".brain-workspace-menu");
  actions.push({ type: "switch-explore" });
  await client.waitFor(`(() => {
    try {
      const raw = localStorage.getItem("brain.workspaceSelection.v2");
      return raw && JSON.parse(raw).selectedWorkspaceKey === "explore";
    } catch { return false; }
  })()`, 15_000);

  await new Promise((r) => setTimeout(r, 1000));
  finalState = await state();
  await shot("completed");

  assertions.push({ name: "selected-explore", passed: finalState.selected === "explore", actual: finalState.selected });
  assertions.push({ name: "no-fake-scene-tools", passed: !finalState.hasFakeTabs });
  assertions.push({ name: "has-global-nav-files-artifacts-tasks", passed: ["文件","产物","任务"].every((label) => finalState.globalNav.some((t) => t.startsWith(label))) });
  assertions.push({ name: "no-scene-capability-nav", passed: !finalState.sceneNav.length });

  if (assertions.some((a) => !a.passed)) {
    result = "FAIL";
    firstFailure = assertions.filter((a) => !a.passed).map((a) => a.name).join(", ");
  }
} catch (error) {
  result = "FAIL";
  firstFailure = error instanceof Error ? error.message : String(error);
  assertions.push({ name: "execution", passed: false, detail: firstFailure });
  try { finalState = await state(); await shot("failure"); } catch {}
} finally {
  await client.close();
}

const evidence = {
  caseId,
  timestamp: new Date().toISOString(),
  environment: { repository: repo, platform: process.platform, port, mode: "switch-explore-diag" },
  actions,
  assertions,
  result,
  firstFailure,
  screenshots: ["before.png", "menu-attempt.png", "completed.png", "failure.png"].filter(Boolean),
  finalState
};
await writeFile(resolve(runDir, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
console.log(JSON.stringify({ evidencePath: resolve(runDir, "evidence.json"), result, firstFailure, assertions }, null, 2));
if (result !== "PASS") process.exitCode = 1;
