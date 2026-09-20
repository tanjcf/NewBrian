param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$WindowTitle = "NewBrain",
  [string]$ProcessName = "newbrain",
  [int]$ProcessId = 0,
  [string]$Name = "",
  [string]$AutomationId = "",
  [string]$Text = "",
  [string]$OutputPath = "",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0,
  [double]$MinForegroundRatio = 0.002,
  [int]$KeyDelayMs = 80
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeInput {
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetProcessDPIAware();

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION data;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT keyboard;
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public HARDWAREINPUT hardware;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT {
    public uint message;
    public ushort parameterLow;
    public ushort parameterHigh;
  }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
  public const uint KEYUP = 0x0002;
  public static void TapKey(ushort virtualKey) {
    INPUT down = new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { virtualKey = virtualKey } } };
    INPUT up = new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { virtualKey = virtualKey, flags = KEYUP } } };
    INPUT[] inputs = new INPUT[] { down, up };
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
  }
  public static void TypeUnicode(char value) {
    const uint UNICODE = 0x0004;
    INPUT down = new INPUT {
      type = 1,
      data = new INPUTUNION { keyboard = new KEYBDINPUT { scanCode = value, flags = UNICODE } }
    };
    INPUT up = new INPUT {
      type = 1,
      data = new INPUTUNION { keyboard = new KEYBDINPUT { scanCode = value, flags = UNICODE | KEYUP } }
    };
    INPUT[] inputs = new INPUT[] { down, up };
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
  }
}
"@

[void][NativeInput]::SetProcessDPIAware()

function Activate-Window([Windows.Automation.AutomationElement]$Window) {
  $handle = [IntPtr]$Window.Current.NativeWindowHandle
  [void][NativeInput]::ShowWindow($handle, 5)
  [void][NativeInput]::BringWindowToTop($handle)
  [void][NativeInput]::SetForegroundWindow($handle)
  try { $Window.SetFocus() } catch { }
  Start-Sleep -Milliseconds 250
}

function Find-Window {
  if ($ProcessId -gt 0) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process -or $process.MainWindowHandle -eq 0) {
      throw "Visible window not found for process id: $ProcessId"
    }
    return [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$process.MainWindowHandle)
  }
  if ($ProcessName) {
    $process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } |
      Select-Object -First 1
    if ($null -ne $process) {
      return [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$process.MainWindowHandle)
    }
  }
  $root = [Windows.Automation.AutomationElement]::RootElement
  $condition = New-Object Windows.Automation.PropertyCondition(
    [Windows.Automation.AutomationElement]::NameProperty,
    $WindowTitle
  )
  $window = $root.FindFirst([Windows.Automation.TreeScope]::Children, $condition)
  if ($null -eq $window) { throw "Visible window not found: $WindowTitle" }
  return $window
}

function Send-RawKeys([Windows.Automation.AutomationElement]$Window, [string]$Sequence) {
  $keyMap = @{
    "BACKSPACE" = "{BACKSPACE}"; "TAB" = "{TAB}"; "ENTER" = "{ENTER}"
    "ESC" = "{ESC}"; "SPACE" = " "; "LEFT" = "{LEFT}"; "UP" = "{UP}"
    "RIGHT" = "{RIGHT}"; "DOWN" = "{DOWN}"; "DELETE" = "{DELETE}"
    "F4" = "{F4}"; "ALT+F4" = "%{F4}"
  }
  $shell = New-Object -ComObject WScript.Shell
  if ($ProcessId -gt 0 -and -not $shell.AppActivate($ProcessId)) {
    throw "Unable to activate process id for keyboard input: $ProcessId"
  }
  Activate-Window $Window
  $sent = @()
  foreach ($tokenValue in $Sequence.Split(",")) {
    $token = $tokenValue.Trim().ToUpperInvariant()
    if (-not $token) { continue }
    $sendValue = ""
    if ($keyMap.ContainsKey($token)) {
      $sendValue = [string]$keyMap[$token]
    } elseif ($token.Length -eq 1) {
      $sendValue = $token
    } else {
      throw "Unsupported raw key token: $token"
    }
    if ($token.Length -eq 1) {
      [NativeInput]::TapKey([uint16][char]$token)
    } elseif ($token -eq "SPACE") {
      [NativeInput]::TapKey(0x20)
    } elseif ($token -eq "LEFT") {
      [NativeInput]::TapKey(0x25)
    } elseif ($token -eq "UP") {
      [NativeInput]::TapKey(0x26)
    } elseif ($token -eq "RIGHT") {
      [NativeInput]::TapKey(0x27)
    } elseif ($token -eq "DOWN") {
      [NativeInput]::TapKey(0x28)
    } else {
      $shell.SendKeys($sendValue)
    }
    $sent += $token
    if ($KeyDelayMs -gt 0) { Start-Sleep -Milliseconds $KeyDelayMs }
  }
  return $sent
}

function Find-Control([Windows.Automation.AutomationElement]$Window) {
  $conditions = New-Object System.Collections.Generic.List[Windows.Automation.Condition]
  if ($Name) {
    $conditions.Add((New-Object Windows.Automation.PropertyCondition(
      [Windows.Automation.AutomationElement]::NameProperty,
      $Name
    )))
  }
  if ($AutomationId) {
    $conditions.Add((New-Object Windows.Automation.PropertyCondition(
      [Windows.Automation.AutomationElement]::AutomationIdProperty,
      $AutomationId
    )))
  }
  if ($conditions.Count -eq 0) { throw "Name or AutomationId is required." }
  $condition = if ($conditions.Count -eq 1) { $conditions[0] } else {
    New-Object Windows.Automation.AndCondition($conditions.ToArray())
  }
  $control = $Window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
  if ($null -eq $control) { throw "Visible control not found: name=$Name automationId=$AutomationId" }
  return $control
}

function Click-Control([Windows.Automation.AutomationElement]$Window, [Windows.Automation.AutomationElement]$Control) {
  Activate-Window $Window
  $bounds = $Control.Current.BoundingRectangle
  if ($bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) { throw "Control has no clickable bounds." }
  $x = [int]($bounds.Left + ($bounds.Width / 2))
  $y = [int]($bounds.Top + ($bounds.Height / 2))
  [void][NativeInput]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 120
  [NativeInput]::mouse_event([NativeInput]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [NativeInput]::mouse_event([NativeInput]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  return @{ x = $x; y = $y; name = $Control.Current.Name; automationId = $Control.Current.AutomationId }
}

function Click-Point([Windows.Automation.AutomationElement]$Window, [int]$PointX, [int]$PointY) {
  Activate-Window $Window
  [void][NativeInput]::SetCursorPos($PointX, $PointY)
  Start-Sleep -Milliseconds 120
  [NativeInput]::mouse_event([NativeInput]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [NativeInput]::mouse_event([NativeInput]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Click-RelativePoint([Windows.Automation.AutomationElement]$Window, [int]$PointX, [int]$PointY) {
  Activate-Window $Window
  $bounds = $Window.Current.BoundingRectangle
  if ($bounds.IsEmpty -or [double]::IsInfinity($bounds.Left) -or [double]::IsInfinity($bounds.Top)) {
    throw "Window has no usable bounds after activation."
  }
  Click-Point $Window ([int]$bounds.Left + $PointX) ([int]$bounds.Top + $PointY)
}

function Type-UnicodeText([string]$Value) {
  foreach ($character in $Value.ToCharArray()) {
    [NativeInput]::TypeUnicode($character)
    if ($KeyDelayMs -gt 0) { Start-Sleep -Milliseconds $KeyDelayMs }
  }
}

if ($Action.ToLowerInvariant() -eq "list") {
  $windows = foreach ($process in Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }) {
    try {
      $element = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$process.MainWindowHandle)
      $bounds = $element.Current.BoundingRectangle
      [ordered]@{
        processId = $process.Id
        processName = $process.ProcessName
        title = $process.MainWindowTitle
        handle = $process.MainWindowHandle.ToInt64()
        bounds = @{
          left = $bounds.Left
          top = $bounds.Top
          width = $bounds.Width
          height = $bounds.Height
        }
      }
    } catch {
      # A protected process must not prevent other visible windows from being listed.
    }
  }
  @($windows) | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

$window = Find-Window
switch ($Action.ToLowerInvariant()) {
  "activate" {
    Activate-Window $window
    @{ activated = $true; targetWindow = $window.Current.NativeWindowHandle } | ConvertTo-Json -Compress
  }
  "maximize" {
    $handle = [IntPtr]$window.Current.NativeWindowHandle
    [void][NativeInput]::ShowWindow($handle, 3)
    Activate-Window $window
    @{ maximized = $true; targetWindow = $window.Current.NativeWindowHandle } | ConvertTo-Json -Compress
  }
  "clickpoint" {
    Click-Point $window $X $Y
    @{ clicked = $true; x = $X; y = $Y } | ConvertTo-Json -Compress
  }
  "clickrelative" {
    Click-RelativePoint $window $X $Y
    @{ clicked = $true; relativeX = $X; relativeY = $Y } | ConvertTo-Json -Compress
  }
  "typepoint" {
    Click-Point $window $X $Y
    [Windows.Forms.SendKeys]::SendWait("^a")
    Type-UnicodeText $Text
    @{ typed = $Text.Length; x = $X; y = $Y } | ConvertTo-Json -Compress
  }
  "typerelative" {
    Click-RelativePoint $window $X $Y
    [Windows.Forms.SendKeys]::SendWait("^a")
    Type-UnicodeText $Text
    @{ typed = $Text.Length; relativeX = $X; relativeY = $Y } | ConvertTo-Json -Compress
  }
  "snapshot" {
    $items = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
    $result = foreach ($item in $items) {
      $bounds = $item.Current.BoundingRectangle
      if ($item.Current.Name -or $item.Current.AutomationId) {
        [ordered]@{
          name = $item.Current.Name
          automationId = $item.Current.AutomationId
          controlType = $item.Current.ControlType.ProgrammaticName
          enabled = $item.Current.IsEnabled
          offscreen = $item.Current.IsOffscreen
          bounds = @{ left = $bounds.Left; top = $bounds.Top; width = $bounds.Width; height = $bounds.Height }
        }
      }
    }
    $result | ConvertTo-Json -Depth 5
  }
  "click" {
    Click-Control $window (Find-Control $window) | ConvertTo-Json -Compress
  }
  "assertvisible" {
    $control = Find-Control $window
    $bounds = $control.Current.BoundingRectangle
    if ($control.Current.IsOffscreen -or $bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0) {
      throw "Visible control is offscreen or has no bounds: name=$Name automationId=$AutomationId"
    }
    @{ visible = $true; name = $control.Current.Name; automationId = $control.Current.AutomationId } | ConvertTo-Json -Compress
  }
  "assertregion" {
    Activate-Window $window
    if ($Width -le 0 -or $Height -le 0) { throw "Width and Height must be positive for assertRegion." }
    if ($MinForegroundRatio -lt 0 -or $MinForegroundRatio -gt 1) { throw "MinForegroundRatio must be between 0 and 1." }
    $windowBounds = $window.Current.BoundingRectangle
    if ($X -lt 0 -or $Y -lt 0 -or ($X + $Width) -gt $windowBounds.Width -or ($Y + $Height) -gt $windowBounds.Height) {
      throw "assertRegion must remain inside the visible window bounds."
    }
    $bitmap = New-Object Drawing.Bitmap($Width, $Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen([int]$windowBounds.Left + $X, [int]$windowBounds.Top + $Y, 0, 0, $bitmap.Size)
      $foreground = 0
      $samples = 0
      for ($pixelY = 0; $pixelY -lt $Height; $pixelY += 2) {
        for ($pixelX = 0; $pixelX -lt $Width; $pixelX += 2) {
          $color = $bitmap.GetPixel($pixelX, $pixelY)
          $samples += 1
          if ($color.R -lt 242 -or $color.G -lt 242 -or $color.B -lt 242) { $foreground += 1 }
        }
      }
      $ratio = if ($samples -gt 0) { $foreground / $samples } else { 0 }
      if ($ratio -lt $MinForegroundRatio) {
        throw "Visible screen region foreground ratio $ratio is below required $MinForegroundRatio."
      }
      @{ visible = $true; foregroundRatio = $ratio; samples = $samples; relativeBounds = @{ x = $X; y = $Y; width = $Width; height = $Height } } | ConvertTo-Json -Depth 3 -Compress
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
  "type" {
    $control = Find-Control $window
    [void](Click-Control $window $control)
    [Windows.Forms.SendKeys]::SendWait("^a")
    Type-UnicodeText $Text
    @{ typed = $Text.Length; name = $control.Current.Name } | ConvertTo-Json -Compress
  }
  "keys" {
    Activate-Window $window
    [Windows.Forms.SendKeys]::SendWait($Text)
    @{ keys = $Text } | ConvertTo-Json -Compress
  }
  "rawkeys" {
    if ($X -ne 0 -or $Y -ne 0) {
      Click-RelativePoint $window $X $Y
    }
    @{
      keys = @(Send-RawKeys $window $Text)
      processId = $ProcessId
      targetWindow = $window.Current.NativeWindowHandle
      foregroundWindow = [NativeInput]::GetForegroundWindow().ToInt64()
    } | ConvertTo-Json -Compress
  }
  "screenshot" {
    if (-not $OutputPath) { throw "OutputPath is required for screenshot." }
    Activate-Window $window
    $directory = Split-Path -Parent $OutputPath
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $bounds = $window.Current.BoundingRectangle
    $bitmap = New-Object Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen([int]$bounds.Left, [int]$bounds.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($OutputPath, [Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    @{ outputPath = $OutputPath } | ConvertTo-Json -Compress
  }
  default { throw "Unsupported action: $Action" }
}
