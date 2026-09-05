param([string]$Version)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "msi-version.ps1")
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "scripts\materialize.mjs"))) {
  throw "Run this entry point from the BRAIN source repository."
}
$current = (Get-Content -LiteralPath (Join-Path $sourceRoot "platforms\windows\apps\desktop\package.json") -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($Version)) {
  Write-Host "Current source version: $current"
  $Version = (Read-Host "Enter Test MSI version (example: 1.4.4)").Trim()
}
Assert-MsiVersion $Version
foreach ($tool in @("node", "pnpm", "cargo")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing $tool. Install it and reopen this terminal." }
}
$names = @("CODECN_SOURCE_ROOT", "CODECN_TEST_GATEWAY_BASE_URL", "CODECN_TEST_PREVIEW_URL")
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
try {
  $env:CODECN_SOURCE_ROOT = $sourceRoot
  $env:CODECN_TEST_GATEWAY_BASE_URL = "http://120.48.151.202:8790/v1"
  $env:CODECN_TEST_PREVIEW_URL = "http://120.48.151.202:3000"
  Write-Host "Test MSI $Version -> $env:CODECN_TEST_GATEWAY_BASE_URL" -ForegroundColor Cyan
  & node (Join-Path $sourceRoot "scripts\verify-layout.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Repository layout verification failed." }
  & node (Join-Path $sourceRoot "scripts\materialize.mjs") windows
  if ($LASTEXITCODE -ne 0) { throw "Windows materialization failed." }
  $workspace = Join-Path $sourceRoot ".materialized\windows"
  Push-Location $workspace
  try {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
    & (Join-Path $workspace "scripts\package-win-msi.ps1") -Channel Test -Version $Version
  } finally { Pop-Location }
  Write-Host "Output: $workspace\apps\desktop\release\test" -ForegroundColor Green
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process") }
}
