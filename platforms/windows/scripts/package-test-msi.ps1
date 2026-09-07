param([string]$Version)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Backward-compatible Test MSI entry. Prefer package-msi.ps1 / package-msi.cmd for
# interactive environment + version selection.
& (Join-Path $PSScriptRoot "package-msi.ps1") -Channel Test -Version $Version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
