import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repo = resolve("I:/G盘迁移备份/workrpase/BRAIN");
const scriptsRoot = resolve(repo, "platforms/windows/apps/desktop/scripts");
const { createSceneTestCdpClient } = await import(pathToFileURL(resolve(scriptsRoot, "scene-test-cdp-client.mjs")).href);

const port = 9356;
const runDir = resolve(repo, "evidence/EXPLORE-E2E", `${new Date().toISOString().replace(/[:.]/gu, "-")}-sideeffect`);
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
         const el = [...root.querySelectorAll("button,a,[role=menuitemradio],[role=button],div")].find((n) => (n.innerText||"").includes(${JSON.stringify(target.text)}));`}
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText||"").trim().slice(0,80) };
  })()`);
  if (!point) throw new Error(`missing ${JSON.stringify(target)}`);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 300));
  return point;
}

async function state() {
  return client.evaluate(`(() => ({
    selected: (() => { try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2")||"{}").selectedWorkspaceKey } catch { return null } })(),
    globalNav: [...document.querySelectorAll(".brain-resource-global-nav button")].map((b) => (b.innerText||"").replace(/\\s+/g," ").trim()),
    sceneNav: [...document.querySelectorAll(".brain-resource-scene-nav button")].map((b) => (b.innerText||"").trim()),
    hasFakeTabs: /场景知识|可用工具|正在接入对应的真实编辑/.test(document.body.innerText),
    panelHeader: document.querySelector(".brain-resource-panel header")?.innerText?.trim() || null,
    fileRows: [...document.querySelectorAll(".brain-resource-row strong")].map((n) => n.innerText),
    empty: document.querySelector(".brain-resource-empty")?.innerText || null,
    busy: Boolean(document.querySelector('[data-generating="true"],.is-generating,button[aria-label*="停止"]')) || /正在思考|进行中|等待批准/u.test(document.body.innerText.slice(-5000)),
    textTail: document.body.innerText.slice(-4000)
  }))()`);
}

const actions = [];
const screenshots = [];
let result = "PARTIAL";
let firstFailure = "";
const assertions = [];

try {
  screenshots.push(await shot("before"));
  // ensure explore
  const cur = await state();
  actions.push({ type: "before", cur });
  if (cur.selected !== "explore") {
    await viewportClick(".brain-workspace-trigger");
    await new Promise((r) => setTimeout(r, 400));
    await viewportClick({ text: "场景学习探索", root: ".brain-workspace-menu" });
    await client.waitFor(`(() => { try { return JSON.parse(localStorage.getItem("brain.workspaceSelection.v2")||"{}").selectedWorkspaceKey==="explore" } catch { return false } })()`, 10000);
  }

  // Try open Choose project / bind local folder if visible
  const hasChoose = await client.evaluate(`document.body.innerText.includes("Choose project")`);
  if (hasChoose) {
    try {
      await viewportClick({ text: "Choose project" });
      actions.push({ type: "open-choose-project" });
      await new Promise((r) => setTimeout(r, 500));
      // pick 新建文件夹 if listed
      const picked = await client.evaluate(`(() => {
        const items = [...document.querySelectorAll('.new-chat-project-menu button, .new-chat-project-menu [role=menuitem], button')].filter((b) => b.offsetWidth>0);
        const hit = items.find((b) => /新建文件夹|ss|test|EliseCC/.test(b.innerText||""));
        return hit ? (hit.innerText||"").trim().slice(0,40) : null;
      })()`);
      if (picked) {
        await viewportClick({ text: picked.split("\n")[0] });
        actions.push({ type: "pick-project", picked });
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (e) {
      actions.push({ type: "choose-project-failed", error: String(e) });
    }
  }

  screenshots.push(await shot("project-bound"));
  await viewportClick('[data-testid="new-chat-button"]');
  await new Promise((r) => setTimeout(r, 600));

  const prompt = "只做一件事：调用真实工具，在当前已绑定的本地项目中写入 explore-e2e-note-2.txt，内容为「场景学习探索E2E验收2」。写完后刷新并确认右侧「文件」页签数量大于0。不要只口头说成功。";
  const composer = await client.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter((n) => n.offsetWidth > 0 && n.offsetHeight > 0);
    if (!nodes.length) return null;
    nodes[0].setAttribute("data-codecn-e2e-composer","true");
    return '[data-codecn-e2e-composer="true"]';
  })()`);
  if (!composer) throw new Error("no composer");
  await viewportClick(composer);
  const encoded = Buffer.from(prompt, "utf8").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Set-Clipboard -Value $v`], { windowsHide: true });
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await client.command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await client.command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await client.pressEnter();
  actions.push({ type: "submit", prompt });
  screenshots.push(await shot("submitted"));

  const deadline = Date.now() + 120000;
  let last = null; let stable = 0;
  while (Date.now() < deadline) {
    const approve = await client.evaluate(`([...document.querySelectorAll('button')].find((b)=>b.offsetWidth>0 && /批准并继续|批准/.test((b.innerText||'').trim()))||null)?.innerText?.trim()||null`);
    if (approve) {
      await viewportClick({ text: approve.split("\n")[0] });
      actions.push({ type: "approve", approve });
      await new Promise((r) => setTimeout(r, 700));
    }
    last = await state();
    if (!last.busy) stable += 1; else stable = 0;
    if (stable >= 3) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await viewportClick({ text: "文件", root: ".brain-resource-global-nav" });
  const after = await state();
  screenshots.push(await shot("after"));
  actions.push({ type: "after", after });

  const fileCount = Number((after.globalNav.find((t) => t.startsWith("文件")) || "文件 0").replace(/[^\d]/gu, "") || "0");
  assertions.push({ name: "selected-explore", passed: after.selected === "explore" });
  assertions.push({ name: "no-fake-tabs", passed: !after.hasFakeTabs && !(after.sceneNav || []).length });
  assertions.push({ name: "files-gt-0", passed: fileCount > 0 || (after.fileRows || []).length > 0, actual: { fileCount, fileRows: after.fileRows, empty: after.empty } });

  if (assertions.every((a) => a.passed)) result = "PASS";
  else {
    result = "PARTIAL";
    firstFailure = assertions.filter((a) => !a.passed).map((a) => `${a.name}:${JSON.stringify(a.actual || false)}`).join(" | ");
  }
} catch (error) {
  result = "FAIL";
  firstFailure = error instanceof Error ? error.message : String(error);
  assertions.push({ name: "execution", passed: false, detail: firstFailure });
  try { screenshots.push(await shot("failure")); } catch {}
} finally {
  await client.close();
}

const evidencePath = resolve(runDir, "evidence.json");
await writeFile(evidencePath, JSON.stringify({ caseId: "EXPLORE-E2E-SIDEEFFECT", timestamp: new Date().toISOString(), environment: { repository: repo, port, mode: "sideeffect-retry" }, actions, assertions, result, firstFailure, screenshots }, null, 2));
console.log(JSON.stringify({ evidencePath, result, firstFailure, assertions }, null, 2));
