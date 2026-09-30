import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PS_MOUSE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public static void LeftClick(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(100);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }
  public static void KeyDown(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); }
  public static void KeyUp(byte vk) { keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero); }
}
"@
`;

async function runPs(script) {
  const full = `${PS_MOUSE}; ${script}`;
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", full], { windowsHide: true });
}

export async function osMouseClick(x, y) {
  await runPs(`[WinInput]::LeftClick(${Math.round(x)}, ${Math.round(y)})`);
  await new Promise((r) => setTimeout(r, 150));
}

export async function osKeyCombo(ctrl, keyChar) {
  const vk = keyChar.toUpperCase().charCodeAt(0);
  if (ctrl) {
    await runPs(`[WinInput]::KeyDown(0x11); [WinInput]::KeyDown(${vk}); [WinInput]::KeyUp(${vk}); [WinInput]::KeyUp(0x11)`);
  } else {
    await runPs(`[WinInput]::KeyDown(${vk}); [WinInput]::KeyUp(${vk})`);
  }
  await new Promise((r) => setTimeout(r, 100));
}

export async function osTypeText(text) {
  const escaped = text.replace(/'/g, "''");
  await runPs(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`);
  await new Promise((r) => setTimeout(r, 100));
}

export async function osPressEnter() {
  await runPs(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`);
  await new Promise((r) => setTimeout(r, 100));
}

export async function osPressEscape() {
  await runPs(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ESC}')`);
  await new Promise((r) => setTimeout(r, 150));
}
