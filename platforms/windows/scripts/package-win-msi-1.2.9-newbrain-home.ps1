param([switch]$SkipBuild)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$desktop = Join-Path $repo "apps\desktop"
$pkg = Get-Content (Join-Path $desktop "package.json") -Raw | ConvertFrom-Json
if ($pkg.version -ne "1.2.9") {
  throw "package.json version must be 1.2.9 for this script (found $($pkg.version))"
}
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:NEWBRAIN_REQUIRE_SIGNATURE = "false"
Set-Location $repo
if (-not $SkipBuild) {
  pnpm --filter @codex-forge/desktop build
}
powershell -NoLogo -ExecutionPolicy Bypass -File (Join-Path $repo "scripts\package-win-msi.ps1") -SkipBuild:$SkipBuild
Write-Host "Expected MSI: apps\desktop\release\NewBrain 1.2.9.msi (or unsigned variant)" -ForegroundColor Green
Write-Host "msi-project-created.cjs embeds NEWBRAIN_HOME / newbrain_home on install." -ForegroundColor Green
