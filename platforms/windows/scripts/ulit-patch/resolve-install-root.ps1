# Resolve codeCN install root from recorded location - never filesystem crawl / find.exe.
# Preference: explicit arg > CODECN_INSTALL_ROOT > CODECN_HOME/codecn_home (process + registry)
#             > ARP (HKCU/HKLM/HKU) / DisplayIcon
#             > well-known Program Files\codeCN
#             > ProfileList LocalAppData\.codecn > %LOCALAPPDATA%\.codecn
# Critical: deferred/elevated msiexec may run as SYSTEM where %LOCALAPPDATA% / process env is wrong.
param(
  [string]$ExplicitRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Test-CodeCnInstallRoot([string]$root) {
  if ([string]::IsNullOrWhiteSpace($root)) { return $false }
  $normalized = $root.Trim().TrimEnd('\', '/')
  if (-not (Test-Path -LiteralPath $normalized -PathType Container)) { return $false }
  $exeCandidates = @(
    (Join-Path $normalized "codeCN.exe"),
    (Join-Path $normalized "codecn.exe")
  )
  $asar = Join-Path $normalized "resources\app.asar"
  foreach ($exe in $exeCandidates) {
    if (Test-Path -LiteralPath $exe -PathType Leaf) { return $true }
  }
  return (Test-Path -LiteralPath $asar -PathType Leaf)
}

function Get-RegistryEnvValue([string]$name) {
  $roots = @(
    "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    "HKCU:\Environment"
  )
  foreach ($hive in $roots) {
    if (-not (Test-Path -LiteralPath $hive)) { continue }
    try {
      $props = Get-ItemProperty -LiteralPath $hive -ErrorAction SilentlyContinue
      if ($null -eq $props) { continue }
      $val = Get-PropValue $props $name
      if (-not [string]::IsNullOrWhiteSpace($val)) { return $val.Trim() }
    } catch {
      continue
    }
  }
  # Elevated/SYSTEM: also scan loaded interactive user hives.
  $hku = Get-ChildItem -Path "Registry::HKEY_USERS" -ErrorAction SilentlyContinue
  foreach ($sidKey in @($hku)) {
    $sid = [string]$sidKey.PSChildName
    if ($sid -notmatch '^S-1-5-21-') { continue }
    if ($sid -match '_Classes$') { continue }
    $hive = "Registry::HKEY_USERS\$sid\Environment"
    if (-not (Test-Path -LiteralPath $hive)) { continue }
    try {
      $props = Get-ItemProperty -LiteralPath $hive -ErrorAction SilentlyContinue
      if ($null -eq $props) { continue }
      $val = Get-PropValue $props $name
      if (-not [string]::IsNullOrWhiteSpace($val)) { return $val.Trim() }
    } catch {
      continue
    }
  }
  return ""
}

function Try-FromWellKnownProgramFiles {
  $pfCandidates = New-Object System.Collections.Generic.List[string]
  foreach ($pf in @(
      [Environment]::GetEnvironmentVariable("ProgramW6432"),
      [Environment]::GetEnvironmentVariable("ProgramFiles"),
      [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    )) {
    if ([string]::IsNullOrWhiteSpace($pf)) { continue }
    $pfCandidates.Add((Join-Path $pf "codeCN")) | Out-Null
  }
  # Hard fallbacks when env is empty under odd msiexec contexts.
  $pfCandidates.Add("C:\Program Files\codeCN") | Out-Null
  $pfCandidates.Add("C:\Program Files (x86)\codeCN") | Out-Null
  foreach ($candidate in ($pfCandidates | Select-Object -Unique)) {
    $hit = Try-FromExplicit $candidate
    if ($hit) { return $hit }
  }
  return $null
}

function Normalize-Root([string]$root) {
  return ([System.IO.Path]::GetFullPath($root.Trim().TrimEnd('\', '/')))
}

function Try-FromExplicit([string]$root) {
  if ([string]::IsNullOrWhiteSpace($root)) { return $null }
  try {
    $normalized = Normalize-Root $root
  } catch {
    return $null
  }
  if (Test-CodeCnInstallRoot $normalized) { return $normalized }
  return $null
}

function Get-PropValue($obj, [string]$name) {
  $prop = $obj.PSObject.Properties[$name]
  if ($null -eq $prop) { return "" }
  return [string]$prop.Value
}

function Test-CodeCnDisplayName([string]$displayName) {
  if ([string]::IsNullOrWhiteSpace($displayName)) { return $false }
  # Match product ARP name; skip the ulit applicator itself.
  if ($displayName -match '(?i)^codeCN\s+Ulit\b') { return $false }
  if ($displayName -match '(?i)^codeCN$') { return $true }
  if ($displayName -match '(?i)^codeCN\s+\d') { return $true }
  return $false
}

function Try-FromUninstallKey([string]$hive) {
  if (-not (Test-Path -LiteralPath $hive)) { return $null }
  # Shallow only - Uninstall key children, never Recurse filesystem.
  $keys = @(Get-ChildItem -LiteralPath $hive -ErrorAction SilentlyContinue)
  foreach ($key in $keys) {
    $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $props) { continue }
    $displayName = Get-PropValue $props "DisplayName"
    if (-not (Test-CodeCnDisplayName $displayName)) { continue }
    $location = Get-PropValue $props "InstallLocation"
    $hit = Try-FromExplicit $location
    if ($hit) { return $hit }
    $icon = Get-PropValue $props "DisplayIcon"
    if (-not [string]::IsNullOrWhiteSpace($icon)) {
      $exePath = ($icon -split ',', 2)[0].Trim().Trim('"')
      if ($exePath -and (Test-Path -LiteralPath $exePath -PathType Leaf)) {
        $hit = Try-FromExplicit (Split-Path -Parent $exePath)
        if ($hit) { return $hit }
      }
    }
  }
  return $null
}

function Try-FromUninstallRegistry {
  $uninstallRoots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  foreach ($hive in $uninstallRoots) {
    $hit = Try-FromUninstallKey $hive
    if ($hit) { return $hit }
  }

  # SYSTEM / elevated context: scan loaded user hives under HKU.
  $hku = Get-ChildItem -Path "Registry::HKEY_USERS" -ErrorAction SilentlyContinue
  foreach ($sidKey in @($hku)) {
    $name = [string]$sidKey.PSChildName
    if ($name -notmatch '^S-1-5-21-') { continue }
    if ($name -match '_Classes$') { continue }
    $hive = "Registry::HKEY_USERS\$name\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    $hit = Try-FromUninstallKey $hive
    if ($hit) { return $hit }
  }
  return $null
}

function Try-FromUserProfiles {
  # Shallow per-profile check only (no recursive crawl).
  $profileList = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList"
  if (-not (Test-Path -LiteralPath $profileList)) { return $null }
  $keys = @(Get-ChildItem -LiteralPath $profileList -ErrorAction SilentlyContinue)
  foreach ($key in $keys) {
    $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $props) { continue }
    $img = Get-PropValue $props "ProfileImagePath"
    if ([string]::IsNullOrWhiteSpace($img)) { continue }
    if ($img -match '(?i)\\(systemprofile|ServiceProfiles)\\') { continue }
    try {
      $expanded = [Environment]::ExpandEnvironmentVariables($img)
      $candidate = Join-Path $expanded "AppData\Local\.codecn"
    } catch {
      continue
    }
    $hit = Try-FromExplicit $candidate
    if ($hit) { return $hit }
  }
  return $null
}

$warnings = New-Object System.Collections.Generic.List[string]
$resolved = $null

if (-not [string]::IsNullOrWhiteSpace($ExplicitRoot)) {
  $resolved = Try-FromExplicit $ExplicitRoot
  if (-not $resolved) {
    $warnings.Add("指定的安装目录无效，将回退到注册表/用户配置查找：$ExplicitRoot") | Out-Null
  }
}

if (-not $resolved -and -not [string]::IsNullOrWhiteSpace($env:CODECN_INSTALL_ROOT)) {
  $resolved = Try-FromExplicit $env:CODECN_INSTALL_ROOT
  if (-not $resolved) {
    $warnings.Add("环境变量 CODECN_INSTALL_ROOT 无效：$($env:CODECN_INSTALL_ROOT)") | Out-Null
  }
}

if (-not $resolved) {
  $homeCandidates = @(
    $env:CODECN_HOME,
    $env:codecn_home,
    (Get-RegistryEnvValue "CODECN_HOME"),
    (Get-RegistryEnvValue "codecn_home")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
  # Do not use $home — PowerShell's automatic $HOME is read-only.
  foreach ($homePath in $homeCandidates) {
    $resolved = Try-FromExplicit $homePath
    if ($resolved) { break }
    $warnings.Add("环境变量 CODECN_HOME/codecn_home 无效：$homePath") | Out-Null
  }
}

if (-not $resolved) {
  $resolved = Try-FromUninstallRegistry
}

if (-not $resolved) {
  $resolved = Try-FromWellKnownProgramFiles
}

if (-not $resolved) {
  $resolved = Try-FromUserProfiles
}

if (-not $resolved) {
  $defaultRoot = Join-Path $env:LOCALAPPDATA ".codecn"
  $resolved = Try-FromExplicit $defaultRoot
}

foreach ($w in $warnings) {
  Write-Host $w -ForegroundColor Yellow
}

if (-not $resolved) {
  Write-Host "错误：找不到 codeCN 安装目录。" -ForegroundColor Red
  Write-Host "请确认已安装完整版 codeCN，且进程已退出。" -ForegroundColor Red
  Write-Host "也可设置 CODECN_HOME / CODECN_INSTALL_ROOT，或运行：apply.cmd `"你的安装目录`"" -ForegroundColor Yellow
  Write-Host "诊断日志：%TEMP%\codecn-ulit-patch.log" -ForegroundColor Yellow
  exit 2
}

Write-Output $resolved
exit 0
