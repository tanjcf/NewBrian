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

const probe = await client.evaluate(`(() => {
  const el = document.querySelector('[data-testid="composer-input"]');
  const r = el.getBoundingClientRect();
  const cx = r.left + 40;
  const cy = r.top + 12;
  const hit = document.elementFromPoint(cx, cy);
  return {
    hit: hit ? { tag: hit.tagName, testid: hit.getAttribute('data-testid'), className: String(hit.className||'').slice(0,80), text: (hit.textContent||'').trim().slice(0,40) } : null,
    point: { cx, cy },
    textarea: { left:r.left, top:r.top, width:r.width, height:r.height }
  };
})()`);
console.log("elementFromPoint", JSON.stringify(probe, null, 2));

// Use CDP client's screenPointFor + os click
const clicked = await client.mouseClickSelector('[data-testid="composer-input"]');
console.log("mouseClickSelector", clicked);
await new Promise((r) => setTimeout(r, 300));
console.log("active after cdp-client click", await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`));
await paste("HELLO-VIA-CLIENT");
await new Promise((r) => setTimeout(r, 400));
console.log("value", await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.value || ""`));

// Try OS click at top-left inside textarea with manual titlebar guess 32px
const pts = await client.evaluate(`(() => {
  const el = document.querySelector('[data-testid="composer-input"]');
  const r = el.getBoundingClientRect();
  return {
    a: { x: Math.round(window.screenX + r.left + 40), y: Math.round(window.screenY + r.top + 12) },
    b: { x: Math.round(window.screenX + r.left + 40), y: Math.round(window.screenY + 32 + r.top + 12) },
    c: { x: Math.round(window.screenX + r.left + 40), y: Math.round(window.screenY + 48 + r.top + 12) }
  };
})()`);
for (const [name, p] of Object.entries(pts)) {
  await osMouseClick(p.x, p.y);
  await new Promise((r) => setTimeout(r, 250));
  const active = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`);
  console.log(name, p, "active", active);
  if (active === "composer-input") {
    await osKeyCombo(true, "a");
    await paste(`PASTE-${name}`);
    await new Promise((r) => setTimeout(r, 300));
    console.log("value", await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.value || ""`));
    break;
  }
}

await client.close({ keepProcess: true });
