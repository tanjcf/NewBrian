# Show Chinese-friendly ulit patch failure details (log + optional MessageBox).
# UTF-8 BOM required for Windows PowerShell 5.1 to parse Chinese string literals.
# STA required for WinForms MessageBox when launched from msiexec CA (often MTA).
param(
  [Parameter(Mandatory = $true)][int]$ExitCode,
  [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne [System.Threading.ApartmentState]::STA) {
  $self = $MyInvocation.MyCommand.Path
  $p = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList @("-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", $self, "-ExitCode", "$ExitCode", "-LogPath", $LogPath) `
    -Wait -PassThru -WindowStyle Hidden
  exit $(if ($null -ne $p) { [int]$p.ExitCode } else { 0 })
}

$tail = ""
if (Test-Path -LiteralPath $LogPath) {
  try {
    $tail = ((Get-Content -LiteralPath $LogPath -Tail 16 -ErrorAction Stop) -join [Environment]::NewLine)
  } catch {
    $tail = ""
  }
}

$line1 = ([string]::Format("错误：codeCN 升级补丁失败（退出码 {0}）。", $ExitCode))
$line2 = "请完全退出 codeCN（含托盘）后重试。"
$line3 = "若刚安装过其他版本，请确认基准版本匹配。"
$line4 = "日志：$LogPath"
$msg = @($line1, $line2, $line3, $line4, "", $tail) -join [Environment]::NewLine

Write-Host $msg -ForegroundColor Red

try {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
  $null = [System.Windows.Forms.MessageBox]::Show(
    $msg,
    "codeCN Ulit Patch",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  )
} catch {
}

exit 0
