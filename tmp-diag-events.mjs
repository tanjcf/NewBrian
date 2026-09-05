import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick, osKeyCombo, osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]);
const client = await createSceneTestCdpClient(9356);
await client.waitForAppReady();
for (let i = 0; i < 4; i++) await osPressEscape();

const info = await client.evaluate(`(() => {
  const el = document.querySelector('[data-testid="composer-input"]');
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const stack = [];
  for (let y of [r.top + 8, r.top + r.height/2, r.bottom - 8]) {
    for (let x of [r.left + 20, r.left + r.width/2, r.right - 20]) {
      const h = document.elementFromPoint(x, y);
      stack.push({ x, y, tag: h?.tagName, testid: h?.getAttribute?.('data-testid'), pe: h ? getComputedStyle(h).pointerEvents : null, cls: String(h?.className||'').slice(0,60) });
    }
  }
  return {
    style: { pointerEvents: cs.pointerEvents, opacity: cs.opacity, display: cs.display, visibility: cs.visibility, zIndex: cs.zIndex },
    rect: { left:r.left, top:r.top, width:r.width, height:r.height },
    stack
  };
})()`);
console.log(JSON.stringify(info, null, 2));

// Install temporary listeners
await client.evaluate(`(() => {
  window.__clicks = [];
  const handler = (e) => window.__clicks.push({ type: e.type, t: e.target?.getAttribute?.('data-testid') || e.target?.tagName, x: e.clientX, y: e.clientY });
  document.addEventListener('mousedown', handler, true);
  document.addEventListener('click', handler, true);
  return true;
})()`);

const x = info.rect.left + 20;
const y = info.rect.top + 10;
await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
await new Promise((r) => setTimeout(r, 200));
console.log("cdp clicks", await client.evaluate(`window.__clicks`));
console.log("active", await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`));

// Try OS click and read listeners
await client.evaluate(`window.__clicks = []`);
await osMouseClick(Math.round(200 + x), Math.round(48 + y));
await new Promise((r) => setTimeout(r, 300));
console.log("os clicks", await client.evaluate(`window.__clicks`));
console.log("active2", await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`));

await client.close({ keepProcess: true });
