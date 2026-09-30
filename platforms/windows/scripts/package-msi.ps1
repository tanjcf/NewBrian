param(
  [string]$Channel,
  [string]$Version,
  [switch]$AllowUnsigned
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "msi-version.ps1")

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "scripts\materialize.mjs"))) {
  throw "Run this entry point from the BRAIN source repository."
}

function Resolve-MsiChannel {
  param([string]$Raw)
  $value = ([string]$Raw).Trim().ToLowerInvariant()
  switch -Regex ($value) {
    '^(test|t|1|测试)$' { return "Test" }
    '^(production|prod|p|2|生产|线上)$' { return "Production" }
    default { return $null }
  }
}

$current = (Get-Content -LiteralPath (Join-Path $sourceRoot "platforms\windows\apps\desktop\package.json") -Raw | ConvertFrom-Json).version

$resolvedChannel = Resolve-MsiChannel $Channel
if (-not $resolvedChannel) {
  Write-Host ""
  Write-Host "Current source version: $current"
  Write-Host "Select MSI environment:"
  Write-Host "  1) test        -> http://203.0.113.10:8790/v1"
  Write-Host "  2) production  -> https://api.sinnauze.cn/v1"
  $channelInput = (Read-Host "Enter environment (test/production or 1/2)").Trim()
  $resolvedChannel = Resolve-MsiChannel $channelInput
  if (-not $resolvedChannel) {
    throw "Unknown environment '$channelInput'. Use test or production."
  }
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  Write-Host "Current source version: $current"
  $hint = if ($resolvedChannel -eq "Production") { "example: 1.4.4" } else { "example: 1.4.4 (no -test suffix)" }
  $Version = (Read-Host "Enter $resolvedChannel MSI version ($hint)").Trim()
}
Assert-MsiVersion $Version

foreach ($tool in @("node", "pnpm", "cargo")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Missing $tool. Install it and reopen this terminal."
  }
}

$isProduction = $resolvedChannel -eq "Production"
$names = @(
  "NEWBRAIN_SOURCE_ROOT",
  "NEWBRAIN_TEST_GATEWAY_BASE_URL",
  "NEWBRAIN_TEST_PREVIEW_URL",
  "NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL",
  "NEWBRAIN_PRODUCTION_PREVIEW_URL"
)
$saved = @{}
foreach ($name in $names) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
  $env:NEWBRAIN_SOURCE_ROOT = $sourceRoot
  if ($isProduction) {
    $env:NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL = "https://api.sinnauze.cn/v1"
    $env:NEWBRAIN_PRODUCTION_PREVIEW_URL = "https://www.sinnauze.cn"
    $gateway = $env:NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL
  } else {
    $env:NEWBRAIN_TEST_GATEWAY_BASE_URL = "http://203.0.113.10:8790/v1"
    $env:NEWBRAIN_TEST_PREVIEW_URL = "http://203.0.113.10:3000"
    $gateway = $env:NEWBRAIN_TEST_GATEWAY_BASE_URL
  }

  $packageArgs = @{
    Channel = $resolvedChannel
    Version = $Version
  }
  $hasSigningMaterial = -not [string]::IsNullOrWhiteSpace($env:CSC_LINK) `
    -or -not [string]::IsNullOrWhiteSpace($env:WINDOWS_CSC_LINK) `
    -or -not [string]::IsNullOrWhiteSpace($env:CSC_KEY_PASSWORD)
  if ($isProduction -and ($AllowUnsigned -or -not $hasSigningMaterial)) {
    if (-not $hasSigningMaterial -and -not $AllowUnsigned) {
      Write-Host "No code-signing certificate configured; packaging unsigned production MSI." -ForegroundColor Yellow
    }
    $packageArgs.AllowUnsigned = $true
  }

  Write-Host "$resolvedChannel MSI $Version -> $gateway" -ForegroundColor Cyan
  & node (Join-Path $sourceRoot "scripts\verify-layout.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Repository layout verification failed." }
  & node (Join-Path $sourceRoot "scripts\materialize.mjs") windows
  if ($LASTEXITCODE -ne 0) { throw "Windows materialization failed." }

  $workspace = Join-Path $sourceRoot ".materialized\windows"
  Push-Location $workspace
  try {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
    & (Join-Path $workspace "scripts\package-win-msi.ps1") @packageArgs
    if ($LASTEXITCODE -ne 0) { throw "$resolvedChannel MSI packaging failed." }
  } finally {
    Pop-Location
  }

  $channelSlug = $resolvedChannel.ToLowerInvariant()
  Write-Host "Output: $workspace\apps\desktop\release\$channelSlug" -ForegroundColor Green
} finally {
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process")
  }
}
