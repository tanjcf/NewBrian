import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick, osKeyCombo } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]);
const client = await createSceneTestCdpClient(9356);
await client.waitForAppReady();

const info = await client.evaluate(`(() => {
  const el = document.querySelector('[data-testid="composer-input"]');
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  const frameTop = Math.max(0, window.outerHeight - window.innerHeight);
  const frameLeft = Math.max(0, Math.round((window.outerWidth - window.innerWidth) / 2));
  return {
    found: true,
    tag: el.tagName,
    disabled: !!el.disabled,
    readOnly: !!el.readOnly,
    valueLen: (el.value || "").length,
    placeholder: el.placeholder || "",
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    screen: { x: Math.round(window.screenX + r.left + r.width / 2), y: Math.round(window.screenY + r.top + r.height / 2) },
    screenFrame: {
      x: Math.round(window.screenX + frameLeft + r.left + r.width / 2),
      y: Math.round(window.screenY + frameTop + r.top + r.height / 2)
    },
    window: { screenX: window.screenX, screenY: window.screenY, outerW: window.outerWidth, outerH: window.outerHeight, innerW: window.innerWidth, innerH: window.innerHeight },
    active: document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName
  };
})()`);
console.log(JSON.stringify(info, null, 2));

async function paste(text) {
  const b64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`], { windowsHide: true });
  await osKeyCombo(true, "v");
}

if (info.found) {
  await osMouseClick(info.screen.x, info.screen.y);
  await new Promise((r) => setTimeout(r, 300));
  await paste("HELLO-DATA-E2E-TEST");
  await new Promise((r) => setTimeout(r, 500));
  console.log("after plain", await client.evaluate(`({ value: document.querySelector('[data-testid="composer-input"]')?.value || "", active: document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName })`));

  await osMouseClick(info.screenFrame.x, info.screenFrame.y);
  await new Promise((r) => setTimeout(r, 300));
  await osKeyCombo(true, "a");
  await paste("HELLO-FRAME-OFFSET");
  await new Promise((r) => setTimeout(r, 500));
  console.log("after frame", await client.evaluate(`({ value: document.querySelector('[data-testid="composer-input"]')?.value || "", active: document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName })`));

  // CDP insertText after OS click with frame coords
  await osMouseClick(info.screenFrame.x, info.screenFrame.y);
  await client.command("Input.insertText", { text: "HELLO-CDP-INSERT" });
  await new Promise((r) => setTimeout(r, 300));
  console.log("after cdp", await client.evaluate(`({ value: document.querySelector('[data-testid="composer-input"]')?.value || "", active: document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName })`));
}

await client.close({ keepProcess: true });
