import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick, osKeyCombo } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
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

const scan = await client.evaluate(`(() => {
  const el = document.querySelector('[data-testid="composer-input"]');
  const r = el.getBoundingClientRect();
  const hits = [];
  for (let y = 2; y < r.height; y += 4) {
    for (let x = 8; x < r.width; x += 16) {
      const cx = r.left + x;
      const cy = r.top + y;
      const hit = document.elementFromPoint(cx, cy);
      const ok = hit === el || el.contains(hit);
      if (ok) {
        hits.push({
          x: Math.round(window.screenX + cx),
          y: Math.round(window.screenY + cy),
          cx, cy, localX: x, localY: y,
          tag: hit.tagName,
          testid: hit.getAttribute('data-testid')
        });
        if (hits.length >= 8) return hits;
      }
    }
  }
  // also report what covers center
  const mid = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return {
    hits,
    midCover: mid ? { tag: mid.tagName, className: String(mid.className||'').slice(0,100), testid: mid.getAttribute('data-testid') } : null,
    rect: { left:r.left, top:r.top, width:r.width, height:r.height }
  };
})()`);
console.log(JSON.stringify(scan, null, 2));

const target = Array.isArray(scan) ? scan[0] : scan.hits?.[0];
if (target) {
  await osMouseClick(target.x, target.y);
  await new Promise((r) => setTimeout(r, 300));
  console.log("active", await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`));
  await paste("HELLO-HITTEST-OK");
  await new Promise((r) => setTimeout(r, 400));
  console.log("value", await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.value || ""`));
} else {
  // Fallback: use CDP focus + insertText (verification only) then try Tab from nearby
  await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.focus()`);
  console.log("js focus active", await client.evaluate(`document.activeElement?.getAttribute?.("data-testid")`));
  await paste("HELLO-AFTER-JS-FOCUS");
  await new Promise((r) => setTimeout(r, 400));
  console.log("value after js focus+paste", await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.value || ""`));
}

await client.close({ keepProcess: true });
