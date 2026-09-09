param(
  [string]$BaseMsi = "",
  [string]$TargetMsi = "",
  [string]$BaseAsar = "",
  [string]$TargetAsar = "",
  [string]$BaseVersion = "1.2.7",
  [string]$TargetVersion = "1.4.0",
  [string]$OutDir = "",
  [switch]$SkipMsiApplicator,
  [switch]$RebuildBspatch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$desktopRoot = Join-Path $repoRoot "apps\desktop"
$releaseRoot = if ([string]::IsNullOrWhiteSpace($OutDir)) {
  Join-Path $desktopRoot "release"
} else {
  $OutDir
}
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$templateRoot = Join-Path $scriptRoot "ulit-patch"
$toolsRoot = Join-Path $templateRoot "tools"
# bsdiff/bspatch executables do not reliably handle non-ASCII Windows paths.
$workRoot = Join-Path $env:TEMP ("newbrain-ulit-patch-build-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Resolve-DefaultMsi([string]$version) {
  $candidates = @(
    (Join-Path $releaseRoot ("NewBrain {0}-unsigned.msi" -f $version)),
    (Join-Path $releaseRoot ("NewBrain {0}.msi" -f $version))
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  $hit = Get-ChildItem -LiteralPath $releaseRoot -Filter ("*{0}*.msi" -f $version) -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch 'ulit' -and $_.Length -gt 50MB } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $hit) { throw "Cannot find MSI for version $version under $releaseRoot" }
  return $hit.FullName
}

function Expand-MsiAdmin([string]$msi, [string]$dest) {
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $p = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/a", "`"$msi`"", "/qn", "TARGETDIR=`"$dest`"") -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "msiexec /a failed ($($p.ExitCode)) for $msi" }
}

function Ensure-BspatchExe {
  New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
  $bspatch = Join-Path $toolsRoot "bspatch.exe"
  if ((Test-Path -LiteralPath $bspatch) -and -not $RebuildBspatch) {
    return $bspatch
  }
  Write-Host "Building tools/bspatch.exe via PyInstaller + bsdiff4..." -ForegroundColor Cyan
  & python -m pip install --quiet bsdiff4 pyinstaller
  if ($LASTEXITCODE -ne 0) { throw "pip install bsdiff4/pyinstaller failed" }
  $src = Join-Path $workRoot "bspatch_main.py"
  New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
  @(
    "import sys",
    "import bsdiff4",
    "def main():",
    "    if len(sys.argv) != 4:",
    "        print('usage: bspatch <oldfile> <newfile> <patchfile>', file=sys.stderr)",
    "        return 2",
    "    bsdiff4.file_patch(sys.argv[1], sys.argv[2], sys.argv[3])",
    "    print('ok', sys.argv[2])",
    "    return 0",
    "if __name__ == '__main__':",
    "    raise SystemExit(main())"
  ) | Set-Content -LiteralPath $src -Encoding utf8
  $dist = Join-Path $workRoot "bspatch-dist"
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & python -m PyInstaller --onefile --console --name bspatch `
    --distpath $dist `
    --workpath (Join-Path $workRoot "bspatch-build") `
    --specpath (Join-Path $workRoot "bspatch-spec") `
    $src
  $ErrorActionPreference = $prevEap
  $built = Join-Path $dist "bspatch.exe"
  if (-not (Test-Path -LiteralPath $built)) { throw "PyInstaller did not produce bspatch.exe" }
  Copy-Item -LiteralPath $built -Destination $bspatch -Force
  return $bspatch
}

New-Item -ItemType Directory -Force -Path $workRoot, $releaseRoot, $toolsRoot | Out-Null
$bspatchExe = Ensure-BspatchExe

$asarBasePath = ""
$asarTargetPath = ""
if (-not [string]::IsNullOrWhiteSpace($BaseAsar) -and -not [string]::IsNullOrWhiteSpace($TargetAsar)) {
  if (-not (Test-Path -LiteralPath $BaseAsar)) { throw "BaseAsar missing: $BaseAsar" }
  if (-not (Test-Path -LiteralPath $TargetAsar)) { throw "TargetAsar missing: $TargetAsar" }
  $asarBasePath = (Resolve-Path -LiteralPath $BaseAsar).Path
  $asarTargetPath = (Resolve-Path -LiteralPath $TargetAsar).Path
  Write-Host "Base asar:   $asarBasePath" -ForegroundColor Cyan
  Write-Host "Target asar: $asarTargetPath" -ForegroundColor Cyan
} else {
  if ([string]::IsNullOrWhiteSpace($BaseMsi)) { $BaseMsi = Resolve-DefaultMsi $BaseVersion }
  if ([string]::IsNullOrWhiteSpace($TargetMsi)) { $TargetMsi = Resolve-DefaultMsi $TargetVersion }
  Write-Host "Base MSI:   $BaseMsi" -ForegroundColor Cyan
  Write-Host "Target MSI: $TargetMsi" -ForegroundColor Cyan
  $exBase = Join-Path $workRoot "msi-base"
  $exTarget = Join-Path $workRoot "msi-target"
  Expand-MsiAdmin $BaseMsi $exBase
  Expand-MsiAdmin $TargetMsi $exTarget
  $asarBase = Get-ChildItem -LiteralPath $exBase -Recurse -Filter "app.asar" -File | Select-Object -First 1
  $asarTarget = Get-ChildItem -LiteralPath $exTarget -Recurse -Filter "app.asar" -File | Select-Object -First 1
  if ($null -eq $asarBase -or $null -eq $asarTarget) {
    throw "app.asar missing from administrative MSI extract"
  }
  $asarBasePath = $asarBase.FullName
  $asarTargetPath = $asarTarget.FullName
}

$baseHash = (Get-FileHash -LiteralPath $asarBasePath -Algorithm SHA256).Hash.ToLowerInvariant()
$targetHash = (Get-FileHash -LiteralPath $asarTargetPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "base asar sha256=$baseHash" -ForegroundColor DarkGray
Write-Host "target asar sha256=$targetHash" -ForegroundColor DarkGray

function Resolve-ElectronAsarPackageRoot {
  $candidates = @(
    (Join-Path $repoRoot "node_modules\@electron\asar"),
    (Join-Path $desktopRoot "node_modules\@electron\asar")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $candidate "package.json")) {
      return $candidate
    }
  }
  $pnpmRoot = Join-Path $repoRoot "node_modules\.pnpm"
  if (Test-Path -LiteralPath $pnpmRoot) {
    $hit = Get-ChildItem -LiteralPath $pnpmRoot -Directory -Filter "@electron+asar@*" |
      Sort-Object Name -Descending |
      Select-Object -First 1
    if ($null -ne $hit) {
      $nested = Join-Path $hit.FullName "node_modules\@electron\asar"
      if (Test-Path -LiteralPath (Join-Path $nested "package.json")) {
        return $nested
      }
    }
  }
  throw "Missing @electron/asar. Install deps first (pnpm install)."
}

function Assert-AsarRuntimeDeps([string]$asarPath, [string]$label) {
  $asarPackageRoot = Resolve-ElectronAsarPackageRoot
  $required = @(
    "\node_modules\exceljs\package.json",
    "\node_modules\jszip\package.json",
    "\node_modules\jszip\lib\index.js"
  )
  $entries = @(& node (Join-Path $asarPackageRoot "bin\asar.js") list $asarPath)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to list $label asar entries: $asarPath"
  }
  foreach ($requiredEntry in $required) {
    if ($entries -notcontains $requiredEntry) {
      throw ("Refusing to build ulit patch: {0} asar is missing required runtime dependency {1}. " +
        "Rebuild the full MSI via windows/scripts/package-win-msi.ps1 so app.asar contains jszip/exceljs.") -f $label, $requiredEntry
    }
  }

  # Fail closed on the exact post-install crash: main process Cannot find module 'jszip'.
  $probeExeCandidates = @(
    (Join-Path $desktopRoot "release\win-unpacked\NewBrain.exe"),
    (Join-Path $desktopRoot "release\win-unpacked\newbrain.exe"),
    (Join-Path $env:ProgramFiles "NewBrain\NewBrain.exe"),
    (Join-Path $env:LOCALAPPDATA ".newbrain\NewBrain.exe")
  )
  $probeExe = $probeExeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not [string]::IsNullOrWhiteSpace($probeExe)) {
    $prevRunAsNode = $env:ELECTRON_RUN_AS_NODE
    $env:ELECTRON_RUN_AS_NODE = "1"
    try {
      $asarPosix = ($asarPath -replace '\\', '/')
      $probe = & $probeExe -e @"
const path = require('path');
const asarPath = process.argv[1];
try {
  require(path.join(asarPath, 'node_modules', 'jszip'));
  require(path.join(asarPath, 'node_modules', 'exceljs'));
  console.log('ok');
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(2);
}
"@ $asarPosix
      if ($LASTEXITCODE -ne 0) {
        throw ("Refusing to build ulit patch: {0} asar failed runtime require probe for jszip/exceljs. Output: {1}" -f $label, ($probe -join ' '))
      }
    } finally {
      if ($null -eq $prevRunAsNode) {
        Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
      } else {
        $env:ELECTRON_RUN_AS_NODE = $prevRunAsNode
      }
    }
  } else {
    Write-Host "Skipped Electron require probe (no NewBrain.exe available); asar entry checks still passed." -ForegroundColor Yellow
  }
  Write-Host ("Verified {0} asar runtime deps (exceljs + jszip)." -f $label) -ForegroundColor DarkGray
}

Assert-AsarRuntimeDeps -asarPath $asarTargetPath -label "target"
# Base fleets from 1.2.9+ also ship these modules; warn-only would let a bad base slip into docs.
Assert-AsarRuntimeDeps -asarPath $asarBasePath -label "base"

& python -m pip install --quiet bsdiff4
$bsdiffOut = Join-Path $workRoot "app.asar.bsdiff"
$diffPy = Join-Path $workRoot "mkbsdiff.py"
@(
  "import bsdiff4, sys",
  "bsdiff4.file_diff(sys.argv[1], sys.argv[2], sys.argv[3])",
  "print('bsdiff_bytes', __import__('os').path.getsize(sys.argv[3]))"
) | Set-Content -LiteralPath $diffPy -Encoding utf8
Write-Host "Computing app.asar bsdiff (may take a few minutes)..." -ForegroundColor Green
& python $diffPy $asarBasePath $asarTargetPath $bsdiffOut
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $bsdiffOut)) {
  throw "bsdiff generation failed"
}

# Round-trip verify
$verifyOut = Join-Path $workRoot "verify.asar"
$bspatchProc = Start-Process -FilePath $bspatchExe -ArgumentList @(
  $asarBasePath, $verifyOut, $bsdiffOut
) -Wait -PassThru -NoNewWindow
if ($bspatchProc.ExitCode -ne 0) { throw "bspatch verification run failed ($($bspatchProc.ExitCode))" }
$verifyDeadline = (Get-Date).AddSeconds(60)
while (-not (Test-Path -LiteralPath $verifyOut) -and (Get-Date) -lt $verifyDeadline) {
  Start-Sleep -Milliseconds 250
}
if (-not (Test-Path -LiteralPath $verifyOut)) {
  throw "bspatch verification output did not become available: $verifyOut"
}
# Wait until the file size stops changing and is readable (bspatch may still flush).
$verifyHash = $null
$verifyReadDeadline = (Get-Date).AddSeconds(120)
$lastSize = -1
$stableCount = 0
do {
  try {
    $info = Get-Item -LiteralPath $verifyOut -ErrorAction Stop
    if ($info.Length -gt 0 -and $info.Length -eq $lastSize) {
      $stableCount += 1
    } else {
      $stableCount = 0
      $lastSize = $info.Length
    }
    if ($stableCount -ge 2) {
      $verifyHash = (Get-FileHash -LiteralPath $verifyOut -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
    } else {
      Start-Sleep -Milliseconds 500
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
} while ($null -eq $verifyHash -and (Get-Date) -lt $verifyReadDeadline)
if ($null -eq $verifyHash) {
  throw "bspatch verification output remained locked: $verifyOut"
}
if ($verifyHash -ne $targetHash) {
  throw "bspatch verification hash mismatch: $verifyHash vs $targetHash"
}
Write-Host "bsdiff round-trip OK ($((Get-Item $bsdiffOut).Length) bytes)" -ForegroundColor Green

$stage = Join-Path $workRoot "stage"
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "tools") | Out-Null
Copy-Item -LiteralPath $bsdiffOut -Destination (Join-Path $stage "app.asar.bsdiff") -Force
Copy-Item -LiteralPath $bspatchExe -Destination (Join-Path $stage "tools\bspatch.exe") -Force
Copy-Item -LiteralPath (Join-Path $templateRoot "apply-ulit-patch.cjs") -Destination (Join-Path $stage "apply-ulit-patch.cjs") -Force
# cmd.exe cannot parse UTF-8 BOM / CJK in .cmd; force ASCII-safe copy without BOM.
$applyCmdSrc = Join-Path $templateRoot "apply.cmd"
$applyCmdDst = Join-Path $stage "apply.cmd"
$applyBytes = [System.IO.File]::ReadAllBytes($applyCmdSrc)
if ($applyBytes.Length -ge 3 -and $applyBytes[0] -eq 0xEF -and $applyBytes[1] -eq 0xBB -and $applyBytes[2] -eq 0xBF) {
  $applyBytes = $applyBytes[3..($applyBytes.Length - 1)]
}
[System.IO.File]::WriteAllBytes($applyCmdDst, $applyBytes)
Copy-Item -LiteralPath (Join-Path $templateRoot "resolve-install-root.ps1") -Destination (Join-Path $stage "resolve-install-root.ps1") -Force
Copy-Item -LiteralPath (Join-Path $templateRoot "show-ulit-failure.ps1") -Destination (Join-Path $stage "show-ulit-failure.ps1") -Force
Copy-Item -LiteralPath (Join-Path $templateRoot "run-ulit-bootstrap.ps1") -Destination (Join-Path $stage "run-ulit-bootstrap.ps1") -Force

$manifest = [ordered]@{
  format           = "newbrain-ulit-patch-v1"
  packageKind      = "patch"
  patchMethod      = "bsdiff-asar"
  baseVersion      = $BaseVersion
  targetVersion    = $TargetVersion
  baseAsarSha256   = $baseHash
  targetAsarSha256 = $targetHash
  bsdiffFile       = "app.asar.bsdiff"
  notes            = ("{0} -> {1} ulit patch: binary delta of resources/app.asar. Requires base asar sha256={2}. Not a full Electron MSI." -f $BaseVersion, $TargetVersion, $baseHash)
}
[System.IO.File]::WriteAllText(
  (Join-Path $stage "manifest.json"),
  ($manifest | ConvertTo-Json -Depth 6),
  [System.Text.UTF8Encoding]::new($false)
)

$ulitZip = Join-Path $releaseRoot ("{0}ulit.zip" -f $TargetVersion)
if (Test-Path -LiteralPath $ulitZip) { Remove-Item -LiteralPath $ulitZip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $ulitZip -CompressionLevel Optimal
$zipSize = (Get-Item -LiteralPath $ulitZip).Length
$zipSha = (Get-FileHash -LiteralPath $ulitZip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ("Ulit zip: {0} ({1:N2} MB) sha256={2}" -f $ulitZip, ($zipSize / 1MB), $zipSha) -ForegroundColor Green
if ($zipSize -gt 30MB) {
  Write-Host "WARNING: patch zip exceeds 30 MB." -ForegroundColor Yellow
}

$msiOut = $null
if (-not $SkipMsiApplicator) {
  $msiBuilder = Join-Path $scriptRoot "build-ulit-msi-applicator.py"
  $msiOut = Join-Path $releaseRoot ("{0}ulit.msi" -f $TargetVersion)
  # msilib breaks on non-ASCII output paths; build under %TEMP% then copy.
  $asciiMsi = Join-Path $env:TEMP ("newbrain-{0}ulit.msi" -f $TargetVersion)
  $asciiStage = Join-Path $env:TEMP ("newbrain-ulit-stage-{0}" -f $TargetVersion)
  $asciiBuilder = Join-Path $env:TEMP "build-ulit-msi-applicator.py"
  if (Test-Path -LiteralPath $asciiMsi) { Remove-Item -LiteralPath $asciiMsi -Force }
  if (Test-Path -LiteralPath $asciiStage) { Remove-Item -LiteralPath $asciiStage -Recurse -Force }
  Copy-Item -LiteralPath $stage -Destination $asciiStage -Recurse -Force
  Copy-Item -LiteralPath $msiBuilder -Destination $asciiBuilder -Force
  & python $asciiBuilder --stage $asciiStage --output $asciiMsi --version $TargetVersion --base-version $BaseVersion
  if ($LASTEXITCODE -ne 0) { throw "ulit MSI applicator build failed" }
  Copy-Item -LiteralPath $asciiMsi -Destination $msiOut -Force
  $msiSize = (Get-Item -LiteralPath $msiOut).Length
  $msiSha = (Get-FileHash -LiteralPath $msiOut -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host ("Ulit MSI applicator: {0} ({1:N2} MB) sha256={2}" -f $msiOut, ($msiSize / 1MB), $msiSha) -ForegroundColor Green
  if ($msiSize -gt 40MB) {
    Write-Host "WARNING: applicator MSI is large; it should only embed the patch, not Electron." -ForegroundColor Yellow
  }

  # Double-click-safe wrapper: msiexec with verbose log + pause on error.
  $installCmd = Join-Path $releaseRoot ("{0}ulit-install.cmd" -f $TargetVersion)
  $msiLeaf = Split-Path -Leaf $msiOut
  $installLines = @(
    "@echo off",
    "setlocal EnableExtensions",
    "title NewBrain ulit install",
    "set `"HERE=%~dp0`"",
    "if `"%HERE:~-1%`"==`"\`" set `"HERE=%HERE:~0,-1%`"",
    "set `"MSI=%HERE%\{0}`"" -f $msiLeaf,
    "set `"LOG=%TEMP%\newbrain-ulit-msi.log`"",
    "if not exist `"%MSI%`" (",
    "  echo ERROR: missing %MSI%",
    "  pause",
    "  exit /B 1",
    ")",
    "echo Installing %MSI%",
    "echo Log: %LOG%",
    "echo Please quit NewBrain (tray included) before continuing.",
    "msiexec /i `"%MSI%`" /qb! /l*v `"%LOG%`"",
    "set `"ERR=%ERRORLEVEL%`"",
    "if not `"%ERR%`"==`"0`" (",
    "  echo.",
    "  echo Install failed exit=%ERR%",
    "  echo See %LOG%",
    "  echo See %TEMP%\newbrain-ulit-patch.log",
    "  pause",
    "  exit /B %ERR%",
    ")",
    "echo Install finished OK.",
    "exit /B 0",
    ""
  )
  $installText = ($installLines -join "`r`n")
  [System.IO.File]::WriteAllBytes($installCmd, [System.Text.Encoding]::ASCII.GetBytes($installText))
  Write-Host ("Install wrapper: {0}" -f $installCmd) -ForegroundColor Green
}

Write-Host "Work dir: $workRoot" -ForegroundColor DarkGray
[pscustomobject]@{
  zipPath = $ulitZip
  zipBytes = $zipSize
  zipSha256 = $zipSha
  msiPath = $msiOut
  baseAsarSha256 = $baseHash
  targetAsarSha256 = $targetHash
  bsdiffBytes = (Get-Item $bsdiffOut).Length
}
