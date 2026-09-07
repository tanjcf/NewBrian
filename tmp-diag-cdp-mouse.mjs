import { createSceneTestCdpClient } from "./platforms/windows/apps/desktop/scripts/scene-test-cdp-client.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
await execFileAsync("powershell.exe", ["-NoProfile", "-File", join(process.cwd(), "tmp-focus-codecn.ps1")]);
const client = await createSceneTestCdpClient(9356);
await client.waitForAppReady();

const layout = await client.evaluate(`(() => {
  const ta = document.querySelector('[data-testid="composer-input"]');
  const add = document.querySelector('[data-testid="composer-add-button"]');
  const tr = ta.getBoundingClientRect();
  const ar = add.getBoundingClientRect();
  return {
    textarea: { left:tr.left, top:tr.top, right:tr.right, bottom:tr.bottom, w:tr.width, h:tr.height },
    add: { left:ar.left, top:ar.top, right:ar.right, bottom:ar.bottom, w:ar.width, h:ar.height },
    plugins: [...document.querySelectorAll('.composer-builtin-plugin')].filter(x=>x.offsetParent).map(el => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent||'').trim().slice(0,30), left:r.left, top:r.top, bottom:r.bottom, right:r.right };
    })
  };
})()`);
console.log(JSON.stringify(layout, null, 2));

// CDP mouse click into textarea (for diagnosing whether Electron accepts input at all)
const x = layout.textarea.left + 20;
const y = layout.textarea.top + 10;
await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
await new Promise((r) => setTimeout(r, 200));
console.log("active after CDP mouse", await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`));
await client.command("Input.insertText", { text: "HELLO-CDP-MOUSE" });
await new Promise((r) => setTimeout(r, 200));
console.log("value", await client.evaluate(`document.querySelector('[data-testid="composer-input"]')?.value || ""`));

// SendInput OS click with absolute coords
const absX = Math.round((200 + x) * 65535 / (1920)); // may need actual screen width
const screen = await client.evaluate(`({ w: window.screen.width, h: window.screen.height })`);
console.log("screen", screen);

const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SendInputHelper {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  public const uint INPUT_MOUSE=0; public const uint MOUSEEVENTF_LEFTDOWN=0x0002; public const uint MOUSEEVENTF_LEFTUP=0x0004;
  public static void Click(int x, int y) {
    SetCursorPos(x,y);
    System.Threading.Thread.Sleep(80);
    INPUT[] down = new INPUT[1];
    down[0].type = INPUT_MOUSE; down[0].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    INPUT[] up = new INPUT[1];
    up[0].type = INPUT_MOUSE; up[0].mi.dwFlags = MOUSEEVENTF_LEFTUP;
    SendInput(1, down, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(40);
    SendInput(1, up, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
[SendInputHelper]::Click(${Math.round(200 + x)}, ${Math.round(48 + y)})
`;
await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script]);
await new Promise((r) => setTimeout(r, 300));
console.log("active after SendInput", await client.evaluate(`document.activeElement?.getAttribute?.("data-testid") || document.activeElement?.tagName`));

await client.close({ keepProcess: true });
