# codeCN ulit MSI entry (UTF-8). Prefer this over bootstrap.cmd for msiexec CAs:
# stale UTF-8-BOM / CJK .cmd files exit 255 instantly on Chinese Windows (flash-quit).
param(
  [Parameter(Mandatory = $false)][string]$RequestedRoot = ""
)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $here "_payload"
$zip = Join-Path $here "payload.ulit.zip"
$log = Join-Path $env:TEMP "codecn-ulit-patch.log"
$failUi = Join-Path $here "show-ulit-failure.ps1"

function Write-Log([string]$line) {
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Show-Failure([int]$code) {
  $ui = $failUi
  if (-not (Test-Path -LiteralPath $ui)) {
    $ui = Join-Path $stage "show-ulit-failure.ps1"
  }
  if (Test-Path -LiteralPath $ui) {
    try {
      & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $ui -ExitCode $code -LogPath $log | Out-Null
    } catch {
      Write-Host "ulit failure UI error: $($_.Exception.Message)"
    }
  } else {
    try {
      Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
      $null = [System.Windows.Forms.MessageBox]::Show(
        ("错误：codeCN 升级补丁失败（退出码 {0}）。`n日志：{1}" -f $code, $log),
        "codeCN Ulit Patch",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
      )
    } catch {
      # silent /qn
    }
  }
}

if ([string]::IsNullOrWhiteSpace($RequestedRoot) -or $RequestedRoot -eq ".") {
  $RequestedRoot = ""
}
if (-not [string]::IsNullOrWhiteSpace($RequestedRoot)) {
  $RequestedRoot = $RequestedRoot.TrimEnd(".", "\", "/")
}
if ([string]::IsNullOrWhiteSpace($RequestedRoot) -and -not [string]::IsNullOrWhiteSpace($env:CODECN_INSTALL_ROOT)) {
  $RequestedRoot = $env:CODECN_INSTALL_ROOT.TrimEnd("\", "/")
}

try {
  Set-Content -LiteralPath $log -Value ("===== codeCN ulit bootstrap {0} =====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding utf8
} catch {
  # continue even if log recreate fails
}

function Read-RegistryEnv([string]$name) {
  foreach ($hive in @(
      "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
      "HKCU:\Environment"
    )) {
    if (-not (Test-Path -LiteralPath $hive)) { continue }
    try {
      $props = Get-ItemProperty -LiteralPath $hive -ErrorAction SilentlyContinue
      if ($null -eq $props) { continue }
      $prop = $props.PSObject.Properties[$name]
      if ($null -ne $prop -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
        return ([string]$prop.Value).Trim()
      }
    } catch {}
  }
  return ""
}

# msiexec CA process often lacks refreshed machine env; hydrate from registry.
foreach ($envName in @("CODECN_HOME", "codecn_home", "CODECN_INSTALL_ROOT")) {
  $current = [Environment]::GetEnvironmentVariable($envName, "Process")
  if (-not [string]::IsNullOrWhiteSpace($current)) { continue }
  $fromReg = Read-RegistryEnv $envName
  if (-not [string]::IsNullOrWhiteSpace($fromReg)) {
    Set-Item -Path "Env:$envName" -Value $fromReg
  }
}
if ([string]::IsNullOrWhiteSpace($RequestedRoot)) {
  foreach ($candidate in @($env:CODECN_INSTALL_ROOT, $env:CODECN_HOME, $env:codecn_home)) {
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      $RequestedRoot = $candidate.TrimEnd("\", "/")
      break
    }
  }
}

Write-Log ("HERE={0}" -f $here)
Write-Log ("ZIP={0}" -f $zip)
Write-Log ("STAGE={0}" -f $stage)
Write-Log ("REQUESTED_ROOT={0}" -f $RequestedRoot)
Write-Log ("CODECN_INSTALL_ROOT={0}" -f $env:CODECN_INSTALL_ROOT)
Write-Log ("CODECN_HOME={0}" -f $env:CODECN_HOME)
Write-Log ("USERNAME={0}" -f $env:USERNAME)
Write-Log ("USERPROFILE={0}" -f $env:USERPROFILE)
Write-Log ("LOCALAPPDATA={0}" -f $env:LOCALAPPDATA)
Write-Log ("ProgramFiles={0}" -f $env:ProgramFiles)

if (-not (Test-Path -LiteralPath $zip)) {
  Write-Log "[codeCN ulit] missing payload.ulit.zip"
  Write-Host "ERROR: missing payload.ulit.zip. See $log"
  Show-Failure 1
  exit 1
}

Write-Log "[codeCN ulit] expanding payload..."
Write-Host "[codeCN ulit] expanding patch payload..."
if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$expandOk = $false
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if ($null -ne $tar) {
  & tar.exe -xf $zip -C $stage 2>> $log
  if ($LASTEXITCODE -eq 0) { $expandOk = $true }
}
if (-not $expandOk) {
  try {
    Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
    $expandOk = $true
  } catch {
    Write-Log ("[codeCN ulit] Expand-Archive failed: {0}" -f $_.Exception.Message)
  }
}

if (-not $expandOk) {
  Write-Log "[codeCN ulit] expand failed"
  Write-Host "ERROR: failed to expand ulit payload. See $log"
  Show-Failure 1
  exit 1
}

$applyCmd = Join-Path $stage "apply.cmd"
if (-not (Test-Path -LiteralPath $applyCmd)) {
  Write-Log "[codeCN ulit] apply.cmd missing after expand"
  Write-Host "ERROR: incomplete payload, apply.cmd missing. See $log"
  Show-Failure 1
  exit 1
}

# Ensure failure UI is available beside payload for apply.cmd / nested calls.
$payloadFail = Join-Path $stage "show-ulit-failure.ps1"
if ((Test-Path -LiteralPath $failUi) -and -not (Test-Path -LiteralPath $payloadFail)) {
  Copy-Item -LiteralPath $failUi -Destination $payloadFail -Force
}

Write-Log "[codeCN ulit] calling apply.cmd"
Write-Host "[codeCN ulit] applying patch..."
# Avoid cmd nested-quote hell ("apply.cmd" "") which exits 255 with "语法不正确".
# Use argument array + call; omit root arg when empty.
$stdoutLog = Join-Path $env:TEMP "codecn-ulit-apply-stdout.log"
$stderrLog = Join-Path $env:TEMP "codecn-ulit-apply-stderr.log"
$cmdArgs = @("/d", "/c", "call", $applyCmd)
if (-not [string]::IsNullOrWhiteSpace($RequestedRoot)) {
  $cmdArgs += $RequestedRoot
}
$p = Start-Process -FilePath "$env:ComSpec" -ArgumentList $cmdArgs `
  -WorkingDirectory $stage -Wait -PassThru -NoNewWindow `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog
try {
  if (Test-Path -LiteralPath $stdoutLog) {
    Get-Content -LiteralPath $stdoutLog -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Log $_; Write-Host $_ }
  }
  if (Test-Path -LiteralPath $stderrLog) {
    Get-Content -LiteralPath $stderrLog -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Log $_; Write-Host $_ }
  }
} catch {}

$err = 0
if ($null -ne $p) { $err = [int]$p.ExitCode }
Write-Log ("[codeCN ulit] apply exit={0}" -f $err)
if ($err -ne 0) {
  Show-Failure $err
  exit $err
}
exit 0
