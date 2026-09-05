Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FocusWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
$p = Get-Process electron | Where-Object { $_.MainWindowTitle -eq 'codeCN' } | Select-Object -First 1
if (-not $p) { $p = Get-Process | Where-Object { $_.MainWindowTitle -eq 'codeCN' } | Select-Object -First 1 }
if (-not $p -or $p.MainWindowHandle -eq [IntPtr]::Zero) {
  Write-Host "FOCUS_FAIL"
  exit 2
}
Write-Host "FOCUS_PID=$($p.Id) HWND=$($p.MainWindowHandle)"
if ([FocusWin]::IsIconic($p.MainWindowHandle)) { [void][FocusWin]::ShowWindow($p.MainWindowHandle, 9) }
[void][FocusWin]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 300
$w = New-Object -ComObject WScript.Shell
[void]$w.AppActivate($p.Id)
Write-Host "FOCUS_OK"
