import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick, osKeyCombo, osPressEscape } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]);
const client = await createSceneTestCdpClient(9356);
await client.waitForAppReady();

async function paste(text) {
  const b64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`], { windowsHide: true });
  await osKeyCombo(true, "v");
}

for (let i = 0; i < 5; i++) {
  const open = await client.evaluate(`Boolean(document.querySelector('.composer-add-menu,.composer-picker-menu')?.offsetParent) || [...document.querySelectorAll('.composer-builtin-plugin')].some(x=>x.offsetParent)`);
  console.log("menuOpen", open);
  if (!open) break;
  await osPressEscape();
  await new Promise((r) => setTimeout(r, 250));
}

const hit = await client.evaluate(`(() => {
  const el = document.querySelector('[data-testid="composer-input"]');
  const r = el.getBoundingClientRect();
  for (let y = 4; y < r.height - 4; y += 4) {
    for (let x = 12; x < Math.min(120, r.width); x += 8) {
      const cx = r.left + x, cy = r.top + y;
      const h = document.elementFromPoint(cx, cy);
      if (h === el || el.contains(h)) {
        return { x: Math.round(window.screenX + cx), y: Math.round(window.screenY + cy), testid: h.getAttribute('data-testid') };
      }
    }
  }
  return null;
})()`);
console.log("hit", hit);
await osMouseClick(hit.x, hit.y);
await new Promise((r) => setTimeout(r, 250));
console.log("active", await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`));
await paste("HELLO-AFTER-CLOSE-MENU");
await new Promise((r) => setTimeout(r, 400));
console.log("value", await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.value || ""`));
await client.close({ keepProcess: true });
