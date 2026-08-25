import assert from "node:assert/strict";
import { ensureElectronE2ESession } from "./electron-e2e-session.mjs";
import { osKeyCombo, osMouseClick, osPressEnter, osPressEscape, osTypeText } from "./scene-test-os-input.mjs";

const SCENE_LABELS = {
  quant: "量化交易",
  game: "游戏制作",
  video: "视频制作",
  music: "音乐创作",
  data: "数据与决策",
  software: "软件与自动化",
  document: "文档创作",
  explore: "场景学习探索"
};

export { SCENE_LABELS };

export async function createSceneTestCdpClient(debugPort = 9350) {
  const session = await ensureElectronE2ESession(debugPort);
  const page = session.pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  assert.ok(page, "No debuggable Electron renderer page was found.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  function command(method, params = {}, timeoutMs = 45_000) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      const listener = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener("message", listener);
        if (payload.error || payload.result?.exceptionDetails) {
          reject(new Error(payload.error?.message || payload.result?.exceptionDetails?.exception?.description || payload.result.exceptionDetails.text));
        } else {
          resolve(payload.result);
        }
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 只读：查 DOM 状态，不触发点击 */
  const evaluate = async (expression) => (await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

  /** 元素屏幕坐标（含窗口标题栏偏移） */
  async function screenPointFor(locator) {
    const point = await evaluate(`(() => {
      ${typeof locator === "string" ? `
        const el = document.querySelector(${JSON.stringify(locator)});
        if (!el) return null;
      ` : Array.isArray(locator.selectors) ? `
        const list = ${JSON.stringify(locator.selectors)};
        let el = null;
        for (const sel of list) { el = document.querySelector(sel); if (el) break; }
        if (!el) return null;
      ` : `
        const root = document.querySelector(${JSON.stringify(locator.root || "body")}) || document.body;
        const el = [...root.querySelectorAll("button,a,input,textarea,[role=button]")].find((n) => n.textContent?.includes(${JSON.stringify(locator.text)}));
        if (!el) return null;
      `}
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const frameTop = Math.max(0, window.outerHeight - window.innerHeight);
      const frameLeft = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));
      return {
        x: Math.round(window.screenX + frameLeft + cx),
        y: Math.round(window.screenY + frameTop + cy)
      };
    })()`);
    if (!point) {
      const label = typeof locator === "string" ? locator : locator.text || locator.selectors?.join("|");
      throw new Error(`element not found: ${label}`);
    }
    return point;
  }

  async function mouseClickSelector(selector) {
    const pt = await screenPointFor(typeof selector === "string" ? selector : selector);
    await osMouseClick(pt.x, pt.y);
    return { ...pt, method: "osMouseClick", selector };
  }

  async function mouseClickAny(selectors) {
    const pt = await screenPointFor({ selectors });
    await osMouseClick(pt.x, pt.y);
    return { ...pt, method: "osMouseClick", selectors };
  }

  async function mouseClickButtonText(text, rootSelector = "body") {
    const pt = await screenPointFor({ text, root: rootSelector });
    await osMouseClick(pt.x, pt.y);
    return { ...pt, method: "osMouseClick", text };
  }

  async function mouseClick(x, y) {
    await osMouseClick(x, y);
    return { x, y, method: "osMouseClick" };
  }

  async function clearAndType(selector, text) {
    await mouseClickSelector(selector);
    await command("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await command("Input.insertText", { text });
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  async function dismissOverlays() {
    const searchOpen = await evaluate("Boolean(document.querySelector('.global-search, [class*=search-dialog], .search-panel'))");
    if (searchOpen) await osPressEscape();
  }

  async function openSidebarOrganizeMenu() {
    await dismissOverlays();
    await mouseClickSelector(".chat-subsection-head");
    await mouseClickSelector(".sidebar-organize-button");
  }

  async function keyCombo(keyChar, withCtrl = false) {
    await osKeyCombo(withCtrl, keyChar);
  }

  async function pressEnter() {
    await osPressEnter();
  }

  async function waitFor(expression, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.body?.innerText?.slice(0,600)")}`);
  }

  async function waitForAppReady() {
    await waitFor("Boolean(document.querySelector('.brain-workspace-switcher'))", 120_000);
  }

  async function getSelectedWorkspaceKey() {
    return evaluate(`(() => {
      try {
        const raw = localStorage.getItem("brain.workspaceSelection.v2");
        return raw ? JSON.parse(raw).selectedWorkspaceKey : null;
      } catch { return null; }
    })()`);
  }

  async function openWorkspaceMenu() {
    const open = await evaluate("Boolean(document.querySelector('.brain-workspace-menu'))");
    if (!open) {
      await mouseClickSelector(".brain-workspace-trigger");
      await waitFor("Boolean(document.querySelector('.brain-workspace-menu'))", 10_000);
    }
  }

  async function switchWorkspace(sceneKey) {
    const label = SCENE_LABELS[sceneKey];
    assert.ok(label, sceneKey);
    await openWorkspaceMenu();
    await waitFor("Boolean(document.querySelector('.brain-workspace-menu'))", 10_000);
    await mouseClickButtonText(label, ".brain-workspace-menu");
    await waitFor(`(() => {
      try {
        const raw = localStorage.getItem("brain.workspaceSelection.v2");
        return raw && JSON.parse(raw).selectedWorkspaceKey === ${JSON.stringify(sceneKey)};
      } catch { return false; }
    })()`, 15_000);
  }

  async function reload() {
    await command("Page.reload", { ignoreCache: true });
    await waitForAppReady();
  }

  return {
    session,
    socket,
    evaluate,
    waitFor,
    waitForAppReady,
    mouseClick,
    mouseClickSelector,
    mouseClickAny,
    mouseClickButtonText,
    clearAndType,
    keyCombo,
    pressEnter,
    dismissOverlays,
    openSidebarOrganizeMenu,
    getSelectedWorkspaceKey,
    openWorkspaceMenu,
    switchWorkspace,
    reload,
    command,
    close: async (options) => {
      socket.close();
      session.close(options);
    }
  };
}
