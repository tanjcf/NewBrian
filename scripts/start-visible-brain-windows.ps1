param(
  [string]$WorkspacePath = "",
  [int]$DebugPort = 9555
)

$repoRoot = Split-Path -Parent $PSScriptRoot

$codecnLocalDevEnv = Join-Path (Split-Path $repoRoot -Parent) "spring-app\scripts\newbrain-local-dev.ps1"
if (Test-Path -LiteralPath $codecnLocalDevEnv) {
  . $codecnLocalDevEnv
}
$appRoot = Join-Path $repoRoot ".materialized\windows\apps\desktop"
$entry = Join-Path $appRoot "out\main\index.js"
$electron = Join-Path $appRoot "node_modules\electron\dist\electron.exe"

if (-not (Test-Path -LiteralPath $entry)) {
  throw "Windows BRAIN is not built. Run 'pnpm materialize:windows' and 'pnpm build:windows' first. Do not launch platforms/windows/apps/desktop directly."
}
if (-not (Test-Path -LiteralPath $electron)) {
  throw "Electron runtime is missing under .materialized/windows. Run pnpm install in .materialized/windows."
}

if (-not $WorkspacePath) { $WorkspacePath = Join-Path $env:USERPROFILE ".newbrain" }
$env:NEWBRAIN_WORKSPACE_PATH = $WorkspacePath
$env:NEWBRAIN_E2E_REMOTE_DEBUG_PORT = [string]$DebugPort
Start-Process -FilePath $electron -ArgumentList "." -WorkingDirectory $appRoot -WindowStyle Normal
Write-Output (ConvertTo-Json @{ appRoot = $appRoot; workspacePath = $WorkspacePath; debugPort = $DebugPort })
