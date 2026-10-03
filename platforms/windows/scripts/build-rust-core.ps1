param(
  [string]$SourceRoot,
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$platformRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  $SourceRoot = if ([string]::IsNullOrWhiteSpace($env:NEWBRAIN_SOURCE_ROOT)) { $platformRoot } else { $env:NEWBRAIN_SOURCE_ROOT }
}
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $platformRoot "apps\desktop\build\rust-core\brain-core.exe"
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$manifestPath = Join-Path $SourceRoot "rust\brain-core\Cargo.toml"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  $fetchScript = Join-Path $PSScriptRoot "fetch-rust-core.mjs"
  if (-not (Test-Path -LiteralPath $fetchScript -PathType Leaf)) {
    $fetchScript = Join-Path $platformRoot "..\..\shared\scripts\fetch-rust-core.mjs"
  }
  if (-not (Test-Path -LiteralPath $fetchScript -PathType Leaf)) {
    throw "Official brain-core fetch script is unavailable: $fetchScript"
  }
  $env:NEWBRAIN_SOURCE_ROOT = $SourceRoot
  $env:BRAIN_CORE_OUTPUT = $OutputPath
  & node $fetchScript
  if ($LASTEXITCODE -ne 0) {
    throw "Official brain-core fetch failed with exit code $LASTEXITCODE"
  }
  exit 0
}
$cargoExecutable = if ([string]::IsNullOrWhiteSpace($env:CARGO)) {
  (Get-Command cargo -ErrorAction Stop).Source
} else {
  [IO.Path]::GetFullPath($env:CARGO)
}
if (-not (Test-Path -LiteralPath $cargoExecutable -PathType Leaf)) {
  throw "Cargo executable is unavailable: $cargoExecutable"
}

Write-Host "Building Rust Core release binary..." -ForegroundColor Green
& $cargoExecutable build --release --locked --manifest-path $manifestPath
if ($LASTEXITCODE -ne 0) {
  throw "Rust Core release build failed with exit code $LASTEXITCODE"
}

$builtBinary = Join-Path $SourceRoot "rust\brain-core\target\release\brain-core.exe"
if (-not (Test-Path -LiteralPath $builtBinary -PathType Leaf)) {
  throw "Rust Core release binary was not produced: $builtBinary"
}
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Copy-Item -LiteralPath $builtBinary -Destination $OutputPath -Force
if ((Get-Item -LiteralPath $OutputPath).Length -le 0) {
  throw "Rust Core packaged binary is empty: $OutputPath"
}
Write-Host "Rust Core staged: $OutputPath" -ForegroundColor DarkGray
$signer = ""
$catalogPath = Join-Path $SourceRoot "rust-core-release.json"
if (Test-Path -LiteralPath $catalogPath -PathType Leaf) {
  $catalog = Get-Content -LiteralPath $catalogPath -Raw | ConvertFrom-Json
  $signer = [string]$catalog.windows.signer
}
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath).Hash.ToLowerInvariant()
$releaseManifest = @{
  schemaVersion = 1
  fileName = "brain-core.exe"
  sha256 = $hash
  signer = $signer
} | ConvertTo-Json
$releaseManifestPath = Join-Path (Split-Path -Parent $OutputPath) "brain-core-release.json"
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($releaseManifestPath, $releaseManifest + "`n", $utf8)
