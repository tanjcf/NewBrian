/**
 * OS mouse/keyboard smoke for Skills / Plugins / Automation / Settings MCP.
 * Uses CDP for inspection + screenshots; repository WinInput for real clicks/typing.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSceneTestCdpClient } from "./scene-test-cdp-client.mjs";
import { osTypeText } from "./scene-test-os-input.mjs";

const caseId = "CAPABILITY-CATALOG-SMOKE-001";
const debugPort = Number(process.env.NEWBRAIN_E2E_REMOTE_DEBUG_PORT || 9566);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(import.meta.dirname, "..", "evidence", caseId, stamp);
mkdirSync(evidenceDir, { recursive: true });

const actions = [];
const assertions = [];
let result = "PASS";
let firstFailure = null;

function recordAction(entry) {
  actions.push({ at: new Date().toISOString(), ...entry });
}

function assertVisible(label, ok, detail = "") {
  assertions.push({ label, ok: Boolean(ok), detail });
  if (!ok) {
    if (!firstFailure) firstFailure = `${label}${detail ? `: ${detail}` : ""}`;
    throw new Error(firstFailure);
  }
}

const client = await createSceneTestCdpClient(debugPort);
try {
  await client.waitForAppReady();
  await client.dismissOverlays();

  // Dismiss any leftover settings / overlays from prior sessions.
  const onSettings = await client.evaluate(`Boolean(document.querySelector('.settings-workspace-body'))`);
  if (onSettings) {
    const back = await client.evaluate(`Boolean([...document.querySelectorAll('button')].some((b) => b.textContent?.includes('返回应用')))`);
    if (back) {
      const click = await client.mouseClickButtonText("返回应用");
      recordAction({ kind: "osMouseClick", target: "返回应用", ...click });
      await client.waitFor(`Boolean(document.querySelector('.brain-workspace-switcher'))`, 30_000);
    }
  }

  async function shot(name) {
    const capture = await client.command("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(join(evidenceDir, name), Buffer.from(capture.data, "base64"));
    recordAction({ kind: "screenshot", file: name });
  }

  async function openFeature(label, readyExpression) {
    await client.dismissOverlays();
    const click = await client.mouseClickButtonText(label, ".feature-nav");
    recordAction({ kind: "osMouseClick", target: `feature-nav:${label}`, ...click });
    await client.waitFor(readyExpression, 30_000);
    const text = await client.evaluate(`document.body?.innerText?.slice(0, 400) || ""`);
    assertVisible(`${label} surface`, Boolean(await client.evaluate(readyExpression)), text.slice(0, 120));
  }

  // --- Skills ---
  await openFeature("技能", `Boolean(document.querySelector('.skills-page, .capability-catalog.skills-page'))`);
  await shot("01-skills.png");
  const skillsTab = await client.mouseClickButtonText("可安装", ".skills-page, .capability-catalog");
  recordAction({ kind: "osMouseClick", target: "skills:可安装", ...skillsTab });
  await new Promise((r) => setTimeout(r, 400));
  const searchSkill = await client.mouseClickSelector(".skills-page .catalog-search input, .capability-catalog.skills-page .catalog-search input, .skills-page input[placeholder], .capability-catalog input[placeholder]");
  recordAction({ kind: "osMouseClick", target: "skills:search", ...searchSkill });
  await osTypeText("smoke");
  recordAction({ kind: "osTypeText", text: "smoke", surface: "skills" });
  await shot("02-skills-search.png");

  // --- Plugins ---
  await openFeature("插件", `Boolean(document.querySelector('.plugins-page, .capability-catalog.plugins-page'))`);
  await shot("03-plugins.png");
  const installedTab = await client.mouseClickButtonText("已安装", ".plugins-page, .capability-catalog");
  recordAction({ kind: "osMouseClick", target: "plugins:已安装", ...installedTab });
  await new Promise((r) => setTimeout(r, 400));
  await shot("04-plugins-installed.png");

  // --- Automation ---
  await openFeature("自动化", `Boolean(document.querySelector('.automation-page, .capability-catalog.automation-page, .create-automation'))`);
  await shot("05-automation.png");
  const createAuto = await client.evaluate(`Boolean(document.querySelector('.create-automation, button.catalog-create'))`);
  if (createAuto) {
    const click = await client.mouseClickAny([".create-automation", ".automation-page .catalog-create", "button.catalog-create"]);
    recordAction({ kind: "osMouseClick", target: "automation:新建", ...click });
    await new Promise((r) => setTimeout(r, 800));
    await shot("06-automation-create.png");
    // Return to automation list if creator switched to chat.
    const stillAuto = await client.evaluate(`Boolean(document.querySelector('.automation-page, .capability-catalog.automation-page'))`);
    if (!stillAuto) {
      const back = await client.mouseClickButtonText("自动化", ".feature-nav");
      recordAction({ kind: "osMouseClick", target: "feature-nav:自动化(return)", ...back });
      await client.waitFor(`Boolean(document.querySelector('.automation-page, .capability-catalog.automation-page'))`, 20_000);
    }
  }

  // --- Settings → MCP ---
  const gear = await client.mouseClickSelector(".sidebar-account-settings");
  recordAction({ kind: "osMouseClick", target: "sidebar-account-settings", ...gear });
  await client.waitFor(`Boolean(document.querySelector('.sidebar-account-menu'))`, 10_000);
  const settings = await client.mouseClickButtonText("设置", ".sidebar-account-menu");
  recordAction({ kind: "osMouseClick", target: "account-menu:设置", ...settings });
  await client.waitFor(`Boolean(document.querySelector('.settings-workspace-body'))`, 30_000);
  await shot("07-settings.png");
  const mcpNav = await client.mouseClickButtonText("MCP 服务器", ".settings-workspace-nav");
  recordAction({ kind: "osMouseClick", target: "settings-nav:MCP 服务器", ...mcpNav });
  await client.waitFor(`Boolean(document.querySelector('.mcp-proto-page, .settings-workspace-body'))`, 20_000);
  const mcpOk = await client.evaluate(`Boolean(document.querySelector('.mcp-proto-page')) || (document.body?.innerText || '').includes('MCP 服务器')`);
  assertVisible("MCP settings surface", mcpOk, await client.evaluate(`document.body?.innerText?.slice(0, 200) || ""`));
  await shot("08-mcp.png");

  // Optional: open new MCP draft via mouse if button present.
  const addMcp = await client.evaluate(`Boolean([...document.querySelectorAll('button')].some((b) => /自定义 MCP|添加 MCP|\\+ MCP|新建/.test(b.textContent || '')))`);
  if (addMcp) {
    const click = await client.mouseClickButtonText("自定义 MCP", ".mcp-proto-page, .settings-workspace-body");
    recordAction({ kind: "osMouseClick", target: "mcp:自定义", ...click });
    await new Promise((r) => setTimeout(r, 500));
    await shot("09-mcp-draft.png");
  }

  const screenshots = [
    "01-skills.png",
    "02-skills-search.png",
    "03-plugins.png",
    "04-plugins-installed.png",
    "05-automation.png",
    "06-automation-create.png",
    "07-settings.png",
    "08-mcp.png",
    "09-mcp-draft.png"
  ].filter((name) => existsSync(join(evidenceDir, name)));

  const evidence = {
    caseId,
    timestamp: stamp,
    result: "PASS",
    environment: {
      debugPort,
      appDirectory: process.env.NEWBRAIN_E2E_APP_DIRECTORY || null,
      platform: process.platform,
      runtimeCopy: process.env.NEWBRAIN_E2E_APP_DIRECTORY || "script-relative"
    },
    actions,
    assertions,
    screenshots,
    firstFailure: null,
    notes: "UI navigation via OS mouse; skills search via OS keyboard. MCP verified in Settings."
  };

  writeFileSync(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ result: "PASS", evidenceDir, actions: actions.length, assertions }, null, 2));
} catch (error) {
  result = "FAIL";
  firstFailure = error instanceof Error ? error.message : String(error);
  try {
    const capture = await client.command("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(join(evidenceDir, "failure.png"), Buffer.from(capture.data, "base64"));
  } catch {
    // ignore
  }
  const body = await client.evaluate(`document.body?.innerText?.slice(0, 800) || ""`).catch(() => "");
  const evidence = {
    caseId,
    timestamp: stamp,
    result,
    firstFailure,
    actions,
    assertions,
    bodySnippet: body,
    environment: {
      debugPort,
      appDirectory: process.env.NEWBRAIN_E2E_APP_DIRECTORY || null
    }
  };
  writeFileSync(join(evidenceDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.error(JSON.stringify({ result, firstFailure, evidenceDir }, null, 2));
  process.exitCode = 1;
} finally {
  await client.close({ preserveWorkspace: true });
}
