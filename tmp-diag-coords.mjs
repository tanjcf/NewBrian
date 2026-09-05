import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { osMouseClick, osKeyCombo } from "./platforms/windows/apps/desktop/scripts/scene-test-os-input.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]);

const winInfo = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRect {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
$p = Get-Process electron | Where-Object { $_.MainWindowTitle -eq 'codeCN' } | Select-Object -First 1
$wr = New-Object WinRect+RECT
$cr = New-Object WinRect+RECT
[void][WinRect]::GetWindowRect($p.MainWindowHandle, [ref]$wr)
[void][WinRect]::GetClientRect($p.MainWindowHandle, [ref]$cr)
$pt = New-Object WinRect+POINT
$pt.X = 0; $pt.Y = 0
[void][WinRect]::ClientToScreen($p.MainWindowHandle, [ref]$pt)
$dpi = 96
try {
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class Dpi { [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd); }
"@
  $dpi = [Dpi]::GetDpiForWindow($p.MainWindowHandle)
} catch {}
Write-Output ("hwnd=" + $p.MainWindowHandle)
Write-Output ("windowRect=" + $wr.Left + "," + $wr.Top + "," + $wr.Right + "," + $wr.Bottom)
Write-Output ("clientOrigin=" + $pt.X + "," + $pt.Y)
Write-Output ("clientSize=" + $cr.Right + "," + $cr.Bottom)
Write-Output ("dpi=" + $dpi)
`]);
console.log(winInfo.stdout);

const client = await createSceneTestCdpClient(9356);
await client.waitForAppReady();
const js = await client.evaluate(`(() => ({
  screenX: window.screenX, screenY: window.screenY,
  outerW: window.outerWidth, outerH: window.outerHeight,
  innerW: window.innerWidth, innerH: window.innerHeight,
  dpr: window.devicePixelRatio,
  textarea: (() => { const r=document.querySelector('[data-testid="composer-input"]').getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()
}))()`);
console.log("js", JSON.stringify(js, null, 2));

// Parse OS client origin
const mOrigin = /clientOrigin=(-?\d+),(-?\d+)/.exec(winInfo.stdout);
const mDpi = /dpi=(\d+)/.exec(winInfo.stdout);
const clientOriginX = Number(mOrigin[1]);
const clientOriginY = Number(mOrigin[2]);
const dpi = Number(mDpi?.[1] || 96);
const scale = dpi / 96;

// Click using OS client origin + CSS coords * scale
const cx = js.textarea.left + 20;
const cy = js.textarea.top + 10;
const candidates = [
  { name: "css+origin", x: Math.round(clientOriginX + cx), y: Math.round(clientOriginY + cy) },
  { name: "css*dpr+origin", x: Math.round(clientOriginX + cx * js.dpr), y: Math.round(clientOriginY + cy * js.dpr) },
  { name: "css*dpiScale+origin", x: Math.round(clientOriginX + cx * scale), y: Math.round(clientOriginY + cy * scale) },
  { name: "screenXY", x: Math.round(js.screenX + cx), y: Math.round(js.screenY + cy) }
];

async function paste(text) {
  const b64 = Buffer.from(text, "utf16le").toString("base64");
  await execFileAsync("powershell.exe", ["-NoProfile", "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`], { windowsHide: true });
  await osKeyCombo(true, "v");
}

for (const c of candidates) {
  await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]);
  await osMouseClick(c.x, c.y);
  await new Promise((r) => setTimeout(r, 250));
  const active = await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`);
  console.log(c.name, c, "active=", active);
  if (active === "composer-input") {
    await osKeyCombo(true, "a");
    await paste(`OK-${c.name}`);
    await new Promise((r) => setTimeout(r, 300));
    console.log("VALUE", await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.value || ""`));
    break;
  }
}

await client.close({ keepProcess: true });
