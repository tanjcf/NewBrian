import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osKeyCombo } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";

const execFileAsync = promisify(execFile);
const c = await createSceneTestCdpClient(9350);

async function pasteText(text) {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$value=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Set-Clipboard -Value $value`], { windowsHide: true });
  await osKeyCombo(true, "v");
}

async function composerSelector() {
  return c.evaluate(`(() => {
    const items = [...document.querySelectorAll('textarea,[contenteditable="true"]')];
    const el = items.find((item) => item.offsetWidth > 0 && item.offsetHeight > 0 && !item.closest('[aria-hidden="true"]'));
    if (!el) return null;
    el.setAttribute('data-quant-e2e-composer', 'true');
    return '[data-quant-e2e-composer="true"]';
  })()`);
}

async function submit(text) {
  const selector = await composerSelector();
  if (!selector) throw new Error("Visible composer not found");
  await c.mouseClickSelector(selector);
  await osKeyCombo(true, "a");
  await pasteText(text);
  await c.pressEnter();
}

async function approveVisible() {
  const found = await c.evaluate(`(() => {
    const labels = ['批准','批准并继续','允许','确认执行','继续执行'];
    const button = [...document.querySelectorAll('button')].find((item) => item.offsetWidth > 0 && item.offsetHeight > 0 && labels.includes(item.textContent?.trim() || ''));
    if (!button) return false;
    button.setAttribute('data-quant-e2e-approve', 'true');
    return true;
  })()`);
  if (found) {
    await c.mouseClickSelector('[data-quant-e2e-approve="true"]');
    return true;
  }
  return false;
}

async function waitSettled(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let approved = 0;
  let lastText = "";
  let stable = 0;
  await new Promise((r) => setTimeout(r, 2500));
  while (Date.now() < deadline) {
    if (await approveVisible()) { approved += 1; await new Promise((r) => setTimeout(r, 700)); continue; }
    const state = await c.evaluate(`(() => ({
      busy: Boolean(document.querySelector('[data-generating="true"], .is-generating, button[aria-label*="停止"]')),
      text: document.body.innerText.slice(-5000)
    }))()`);
    if (!state.busy && state.text === lastText) stable += 1;
    else stable = 0;
    lastText = state.text;
    if (stable >= 4) return { approved, text: state.text };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Conversation did not settle");
}

async function evidence(name) {
  const state = await c.evaluate(`(() => ({
    selectedScene: (() => { try { return JSON.parse(localStorage.getItem('brain.workspaceSelection.v2') || '{}').selectedWorkspaceKey; } catch { return null; } })(),
    activeView: document.querySelector('[data-testid="brain-quant-workspace"]')?.getAttribute('data-active-view'),
    marketStatus: document.querySelector('[data-testid="brain-quant-market-status"]')?.textContent,
    quantText: document.querySelector('[data-testid="brain-quant-workspace"]')?.innerText,
    bodyTail: document.body.innerText.slice(-7000)
  }))()`);
  const shot = await c.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`evidence-${name}.png`, Buffer.from(shot.data, "base64"));
  await writeFile(`evidence-${name}.json`, JSON.stringify(state, null, 2), "utf8");
  return state;
}

const mode = process.argv[2] || "inspect";
await c.waitForAppReady();
try {
  if (mode === "inspect") {
    console.log(JSON.stringify(await evidence("inspect"), null, 2));
  } else if (mode === "watch-init") {
    console.log(JSON.stringify(await c.evaluate(`(() => {
      window.__quantEvents = [];
      window.__quantMarketOff?.(); window.__quantPortfolioOff?.();
      window.__quantMarketOff = window.codecn?.onQuantMarketUpdated?.((payload) => window.__quantEvents.push({ type: 'market', payload }));
      window.__quantPortfolioOff = window.codecn?.onQuantPortfolioUpdated?.((payload) => window.__quantEvents.push({ type: 'portfolio', payload }));
      return { market: typeof window.codecn?.onQuantMarketUpdated, portfolio: typeof window.codecn?.onQuantPortfolioUpdated };
    })()`), null, 2));
  } else if (mode === "watch-read") {
    console.log(JSON.stringify(await c.evaluate(`window.__quantEvents || []`), null, 2));
  } else if (mode === "diagnose-project") {
    console.log(JSON.stringify(await c.evaluate(`(async () => ({
      projects: await window.codecn.listBrainProjects({ workspaceKey: 'quant', includeArchived: false }),
      workspaces: await window.codecn.listWorkspaces(),
      selection: localStorage.getItem('brain.workspaceSelection.v2')
    }))()`), null, 2));
  } else if (mode === "switch-quant") {
    await c.switchWorkspace("quant");
    console.log(JSON.stringify(await evidence("switch-quant"), null, 2));
  } else if (mode === "new-chat") {
    await c.mouseClickSelector('[data-testid="new-chat-button"]');
    await new Promise((r) => setTimeout(r, 1000));
    console.log(JSON.stringify(await evidence("new-chat"), null, 2));
  } else if (mode === "submit") {
    await submit(process.argv.slice(3).join(" "));
    console.log(JSON.stringify(await waitSettled(), null, 2));
    console.log(JSON.stringify(await evidence(`case-${Date.now()}`), null, 2));
  } else if (mode === "approve-current") {
    if (!await approveVisible()) throw new Error("Visible approval action not found");
    console.log(JSON.stringify(await waitSettled(), null, 2));
    console.log(JSON.stringify(await evidence(`approved-${Date.now()}`), null, 2));
  } else if (mode === "click-tab") {
    await c.mouseClickButtonText(process.argv[3], ".brain-resource-scene-nav");
    await new Promise((r) => setTimeout(r, 1000));
    console.log(JSON.stringify(await evidence(`tab-${process.argv[3]}`), null, 2));
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
} finally {
  await c.close();
}
