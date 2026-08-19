param(
  [string]$SourceRoot,
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$platformRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  $SourceRoot = if ([string]::IsNullOrWhiteSpace($env:CODECN_SOURCE_ROOT)) { $platformRoot } else { $env:CODECN_SOURCE_ROOT }
}
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$manifestPath = Join-Path $SourceRoot "rust\brain-core\Cargo.toml"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Rust Core manifest is unavailable: $manifestPath"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $platformRoot "apps\desktop\build\rust-core\brain-core.exe"
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
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
