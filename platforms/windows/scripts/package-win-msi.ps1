param(
  [switch]$SkipBuild,
  [ValidateSet("Test", "Production")]
  [string]$Channel = "Test",
  # Transitional upgrade substitute package ("升级文件替代包"): emit {version}ulit.MSI
  [switch]$Ulit
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$desktopRoot = Join-Path $repoRoot "apps\desktop"
$electronVite = Join-Path $desktopRoot "node_modules\electron-vite\bin\electron-vite.js"
$electronBuilder = Join-Path $desktopRoot "node_modules\electron-builder\cli.js"
$asarPackageRoot = Join-Path $repoRoot "node_modules\@electron\asar"
if (-not (Test-Path -LiteralPath $asarPackageRoot)) {
  $pnpmAsarPackage = Get-ChildItem -LiteralPath (Join-Path $repoRoot "node_modules\.pnpm") -Directory -Filter "@electron+asar@*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if ($null -ne $pnpmAsarPackage) {
    $asarPackageRoot = Join-Path $pnpmAsarPackage.FullName "node_modules\@electron\asar"
  }
}
$asarCli = Join-Path $asarPackageRoot "bin\asar.js"
$desktopPackage = Get-Content (Join-Path $desktopRoot "package.json") -Raw | ConvertFrom-Json
$isProduction = $Channel -eq "Production"
$channelSlug = $Channel.ToLowerInvariant()
$productName = $desktopPackage.name
if ($null -ne $desktopPackage.build -and -not [string]::IsNullOrWhiteSpace($desktopPackage.build.productName)) {
  $productName = $desktopPackage.build.productName
}
$builderArtifactName = "$productName $($desktopPackage.version).msi"
$artifactName = if ($isProduction) { $builderArtifactName } else { "$productName $($desktopPackage.version)-test.msi" }
$releaseRoot = Join-Path (Join-Path $desktopRoot "release") $channelSlug
$msiOut = Join-Path $releaseRoot $artifactName
$maxPackageAttempts = 3
$msiInstallDir = $env:CODECN_MSI_INSTALL_DIR
$rootConfigPath = Join-Path $repoRoot "codecn.config.json"
$featureConfigPath = Join-Path $repoRoot "codecn.features.json"
$bootstrapConfigPath = Join-Path $repoRoot "codecn.bootstrap.json"
$documentWorkerSourcePath = Join-Path $desktopRoot "src\main\document-worker.js"
$documentWorkerPath = Join-Path $desktopRoot "document-worker.js"
$packageResourcesDir = Join-Path $desktopRoot "build\package-resources"
$packageConfigPath = Join-Path $packageResourcesDir "codecn.config.json"
$packageFeatureConfigPath = Join-Path $packageResourcesDir "codecn.features.json"
$iconPath = Join-Path $desktopRoot "build\icon.ico"
$rustCoreBuildScript = Join-Path $repoRoot "scripts\build-rust-core.ps1"
$rustCorePackagePath = Join-Path $desktopRoot "build\rust-core\brain-core.exe"
$sourceRoot = if ([string]::IsNullOrWhiteSpace($env:CODECN_SOURCE_ROOT)) { $repoRoot } else { $env:CODECN_SOURCE_ROOT }
$gatewayBaseUrl = if ($isProduction) { $env:CODECN_PRODUCTION_GATEWAY_BASE_URL } else { $env:CODECN_TEST_GATEWAY_BASE_URL }
$previewUrl = if ($isProduction) { $env:CODECN_PRODUCTION_PREVIEW_URL } else { $env:CODECN_TEST_PREVIEW_URL }
# wangjietech.com domains are currently parked/blocked and cannot serve model traffic.
# Keep the known-live Spring gateway as the default until a reachable HTTPS domain is restored.
if ([string]::IsNullOrWhiteSpace($gatewayBaseUrl)) {
  $gatewayBaseUrl = "http://120.48.151.202:8790/v1"
}
if ([string]::IsNullOrWhiteSpace($previewUrl)) {
  $previewUrl = "http://120.48.151.202:3000"
}
$requireSignature = $isProduction -or ($env:CODECN_REQUIRE_SIGNATURE -eq "true")

foreach ($endpoint in @($gatewayBaseUrl, $previewUrl)) {
  $endpointUri = $null
  if (-not [Uri]::TryCreate($endpoint, [UriKind]::Absolute, [ref]$endpointUri) -or $endpointUri.Scheme -notin @("http", "https")) {
    throw "Invalid $Channel endpoint: $endpoint"
  }
  if ($endpointUri.IsLoopback) {
    throw "$Channel MSI endpoint must not use a loopback host: $endpoint"
  }
}

if ($isProduction) {
  $gitStatus = @(& git -C $sourceRoot status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw "Unable to verify Git status for the production release." }
  if ($gitStatus.Count -gt 0) { throw "Production release requires a clean Git worktree." }
}

if (-not (Test-Path -LiteralPath $electronVite)) {
  throw "Missing electron-vite at $electronVite. Install deps first (pnpm install in $repoRoot)."
}
if (-not (Test-Path -LiteralPath $electronBuilder)) {
  throw "Missing electron-builder at $electronBuilder. Install deps first (pnpm install in $repoRoot)."
}
if (-not (Test-Path -LiteralPath $asarCli)) {
  throw "Missing @electron/asar CLI at $asarCli. Install deps first (pnpm install in $repoRoot)."
}
if (-not (Test-Path -LiteralPath $iconPath)) {
  throw "Missing Windows icon: $iconPath"
}
if (-not (Test-Path -LiteralPath $bootstrapConfigPath -PathType Leaf)) {
  throw "Missing bootstrap configuration: $bootstrapConfigPath"
}
if (-not (Test-Path -LiteralPath $documentWorkerSourcePath -PathType Leaf)) {
  throw "Missing document worker source: $documentWorkerSourcePath"
}

Write-Host "Repo root: $repoRoot" -ForegroundColor Cyan
Write-Host "Desktop root: $desktopRoot" -ForegroundColor Cyan
Write-Host "Release channel: $Channel" -ForegroundColor Cyan
Write-Host "Gateway endpoint: $gatewayBaseUrl" -ForegroundColor Cyan
Write-Host "Preview endpoint: $previewUrl" -ForegroundColor Cyan
if ([string]::IsNullOrWhiteSpace($msiInstallDir)) {
  Write-Host "MSI install dir: electron-builder default" -ForegroundColor Cyan
} else {
  Write-Host "MSI install dir: $msiInstallDir" -ForegroundColor Cyan
}

Write-Host "Keeping installed codeCN processes running; packaging uses an isolated output directory." -ForegroundColor DarkGray

# pnpm leaves optional-platform symlinks (esbuild/napi-rs/etc.) that point at missing
# packages; @electron/rebuild stats them and aborts. Drop dangling links before packaging.
$danglingSweepRoots = @(
  (Join-Path $repoRoot "node_modules"),
  (Join-Path $desktopRoot "node_modules")
)
$danglingRemoved = 0
foreach ($sweepRoot in $danglingSweepRoots) {
  if (-not (Test-Path -LiteralPath $sweepRoot)) { continue }
  Get-ChildItem -LiteralPath $sweepRoot -Force -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } |
    ForEach-Object {
      try {
        if (-not (Test-Path -LiteralPath $_.FullName)) {
          Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
          $danglingRemoved += 1
        }
      } catch {
        # ignore locked / racing entries
      }
    }
}
if ($danglingRemoved -gt 0) {
  Write-Host "Removed $danglingRemoved dangling node_modules symlink(s) before packaging." -ForegroundColor DarkGray
}

if (-not $SkipBuild) {
  if (-not (Test-Path -LiteralPath $rustCoreBuildScript -PathType Leaf)) {
    throw "Missing Rust Core build script: $rustCoreBuildScript"
  }
  & $rustCoreBuildScript -SourceRoot $sourceRoot -OutputPath $rustCorePackagePath
  if ($LASTEXITCODE -ne 0) {
    throw "Rust Core build script failed with exit code $LASTEXITCODE"
  }
  Write-Host "Building desktop (electron-vite)..." -ForegroundColor Green
  Push-Location $desktopRoot
  try {
    & node $electronVite build
    if ($LASTEXITCODE -ne 0) {
      throw "electron-vite build failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Skip build: using existing out/*" -ForegroundColor Yellow
}

Write-Host "Synchronizing document worker..." -ForegroundColor Cyan
& node (Join-Path $desktopRoot "scripts\sync-document-worker.mjs")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $documentWorkerPath -PathType Leaf)) {
  throw "Unable to stage document worker: $documentWorkerPath"
}
if (-not (Test-Path -LiteralPath $rustCorePackagePath -PathType Leaf)) {
  throw "Missing staged Rust Core binary: $rustCorePackagePath"
}

$desktopMainBundle = Join-Path $desktopRoot "out\main\index.js"
if (-not (Test-Path -LiteralPath $desktopMainBundle)) {
  throw "Missing desktop main bundle: $desktopMainBundle"
}
$desktopMainText = Get-Content -LiteralPath $desktopMainBundle -Raw
if ($desktopMainText -match 'tasklist\s+/FI[\s\S]{0,240}find\s+/I') {
  throw "Desktop main bundle still contains the obsolete tasklist | find /I update wait loop. Rebuild before packaging."
}
if ($desktopMainText -notmatch "Get-Process -Name") {
  throw "Desktop main bundle is missing the hidden Get-Process update wait loop."
}
Write-Host "Verified desktop update wait loop in out/main/index.js." -ForegroundColor DarkGray

# Protocol channels must be present as concrete strings. Undefined channels register as
# ipcMain.handle(undefined) and leave the installed app process alive but UI-dead.
$requiredIpcChannels = @(
  "phase1:report-renderer-diagnostic",
  "phase1:synthesize-novel-speech"
)
foreach ($ipcChannel in $requiredIpcChannels) {
  if ($desktopMainText -notmatch [regex]::Escape($ipcChannel)) {
    throw "Desktop main bundle is missing IPC channel '$ipcChannel'. Rebuild windows/packages/protocol before packaging."
  }
}
Write-Host "Verified required system IPC channels in out/main/index.js." -ForegroundColor DarkGray

Write-Host "Packaging MSI (electron-builder)..." -ForegroundColor Green
$generatedMsi = $null
$builderOut = $null
$lastBuilderExit = 0

try {
  New-Item -ItemType Directory -Force -Path $packageResourcesDir | Out-Null
  if (Test-Path -LiteralPath $rootConfigPath) {
    # Release configuration is built from a fixed credential-free allowlist, never from developer credentials or hooks.
    $packageConfig = [ordered]@{
      llm = [ordered]@{
        provider = "DeepSeek"
        baseUrl = $gatewayBaseUrl
        apiKey = ""
        wireApi = "responses"
        model = "auto"
        reviewModel = "deepseek-v4-pro"
        reasoningEffort = "medium"
        disableResponseStorage = $true
        systemPrompt = "You are a helpful coding assistant for the codeCN desktop workspace."
      }
      preferences = [ordered]@{
        hooks = [ordered]@{
          beforeCommand = $false
          afterCommand = $false
          beforeCommit = $false
          afterTask = $false
          beforeCommandScript = ""
          afterCommandScript = ""
          beforeCommitScript = ""
          afterTaskScript = ""
        }
        environment = [ordered]@{ terminalShell = "powershell.exe"; extraEnv = @{}; autoBootstrapConda = $true }
        worktree = [ordered]@{ defaultIsolated = $true; keepArchived = $false; rootDir = "" }
        browser = [ordered]@{
          autoOpenPreview = $true
          preserveTabs = $true
          highResScreenshots = $false
          previewUrl = $previewUrl
        }
      }
      mcpServers = @()
      mcpDiscoveredTools = @()
    }
    $packageConfig | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $packageConfigPath -Encoding UTF8
    # Packaged MSI configuration must never inherit local developer endpoints.
    $serializedPackageConfig = [System.IO.File]::ReadAllText($packageConfigPath)
    [System.IO.File]::WriteAllText($packageConfigPath, $serializedPackageConfig, [System.Text.UTF8Encoding]::new($false))
    if ($serializedPackageConfig -notmatch [regex]::Escape($gatewayBaseUrl) -or $serializedPackageConfig -notmatch [regex]::Escape($previewUrl)) {
      throw "Packaged configuration is missing the selected $Channel endpoints."
    }
    if ($serializedPackageConfig -match '"apiKey"\s*:\s*"(?!")' -or $serializedPackageConfig -match '"extraEnv"\s*:\s*\{\s*"') {
      throw "Packaged configuration contains credentials or environment variables."
    }
    Write-Host "Generated sanitized $Channel packaged configuration." -ForegroundColor DarkGray
  } else {
    throw "Missing config source: $rootConfigPath"
  }

  $featureConfig = [ordered]@{
    skills = @()
    plugins = @(
      [ordered]@{
        id = "plugin-git-console"
        name = "Git Console"
        summary = "Built-in Git workspace helper."
        status = "connected"
        version = "builtin"
        source = "builtin"
        capabilities = @("git", "workspace")
      },
      [ordered]@{
        id = "plugin-shell-runner"
        name = "Shell Runner"
        summary = "Built-in shell command runner."
        status = "connected"
        version = "builtin"
        source = "builtin"
        capabilities = @("shell", "approval")
      }
    )
    automations = @()
    runtime = [ordered]@{ rustCoreTools = "disabled" }
  }
  $featureConfig | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $packageFeatureConfigPath -Encoding UTF8
  Write-Host "Sanitized packaged features: wrote portable builtin feature config" -ForegroundColor DarkGray

  # Rewrite compiled endpoint defaults to the selected channel before packaging.
  $outRoot = Join-Path $desktopRoot "out"
  if (Test-Path -LiteralPath $outRoot) {
    $rewrittenFiles = 0
    Get-ChildItem -LiteralPath $outRoot -Recurse -File |
      Where-Object { $_.Extension -in @(".js", ".cjs", ".mjs", ".html", ".json", ".css", ".map") } |
      ForEach-Object {
        $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
        $utf8 = [System.Text.Encoding]::UTF8
        $text = $utf8.GetString($bytes)
        if ($text.Contains("127.0.0.1") -or $text.Contains("120.48.151.202") -or $text.Contains("wangjietech.com")) {
          $updated = $text.Replace("http://127.0.0.1:8790/v1", $gatewayBaseUrl).
            Replace("http://120.48.151.202:8790/v1", $gatewayBaseUrl).
            Replace("https://test.wangjietech.com/v1", $gatewayBaseUrl).
            Replace("https://api.wangjietech.com/v1", $gatewayBaseUrl).
            Replace("http://test.wangjietech.com/v1", $gatewayBaseUrl).
            Replace("http://api.wangjietech.com/v1", $gatewayBaseUrl).
            Replace("http://127.0.0.1:3000", $previewUrl).
            Replace("http://120.48.151.202:3000", $previewUrl).
            Replace("https://test.wangjietech.com", $previewUrl).
            Replace("https://api.wangjietech.com", $previewUrl)
          [System.IO.File]::WriteAllText($_.FullName, $updated, [System.Text.UTF8Encoding]::new($false))
          $rewrittenFiles += 1
        }
      }
    Write-Host ("Rewrote local defaults for the {0} channel in {1} out/ file(s)" -f $Channel, $rewrittenFiles) -ForegroundColor DarkGray
  }
  for ($attempt = 1; $attempt -le $maxPackageAttempts; $attempt++) {
    $builderRunId = "{0}-{1}" -f $PID, $attempt
    $builderOutRel = Join-Path (Join-Path "release" "_p") $builderRunId
    $builderOut = Join-Path $desktopRoot $builderOutRel

    Write-Host "Isolated builder output: $builderOut" -ForegroundColor DarkGray
    if ($attempt -gt 1) {
      Write-Host "Retrying MSI packaging (attempt $attempt/$maxPackageAttempts)..." -ForegroundColor Yellow
    }
    New-Item -ItemType Directory -Force -Path $builderOut | Out-Null

    Push-Location $desktopRoot
    try {
      if (-not [string]::IsNullOrWhiteSpace($msiInstallDir)) {
        $env:CODECN_MSI_INSTALL_DIR = $msiInstallDir
      }
      $dirArgs = @("--win", "dir", "--config.directories.output=$builderOutRel", "--config.npmRebuild=false")
      if (-not $requireSignature) { $dirArgs += "--config.win.signAndEditExecutable=false" }
      & node $electronBuilder @dirArgs
      $lastBuilderExit = $LASTEXITCODE
      if ($lastBuilderExit -eq 0) {
        $unpackedRoot = Join-Path $builderOut "win-unpacked"
        $unpackedExe = Join-Path $unpackedRoot "$productName.exe"
        $packagedIcon = Join-Path $unpackedRoot "resources\\codecn.ico"
        $packagedAsar = Join-Path $unpackedRoot "resources\\app.asar"
        $packagedRustCore = Join-Path $unpackedRoot "resources\\brain-core\\brain-core.exe"
        $packagedBootstrap = Join-Path $unpackedRoot "resources\\codecn.bootstrap.json"
        $packagedDocumentWorker = Join-Path $unpackedRoot "resources\\document-worker.js"
        if (-not (Test-Path -LiteralPath $unpackedExe)) { throw "Missing unpacked executable: $unpackedExe" }
        if (-not (Test-Path -LiteralPath $packagedIcon)) { throw "Missing packaged taskbar icon: $packagedIcon" }
        if (-not (Test-Path -LiteralPath $packagedAsar)) { throw "Missing packaged application archive: $packagedAsar" }
        if (-not (Test-Path -LiteralPath $packagedRustCore)) { throw "Missing packaged Rust Core binary: $packagedRustCore" }
        if ((Get-Item -LiteralPath $packagedRustCore).Length -le 0) { throw "Packaged Rust Core binary is empty: $packagedRustCore" }
        if (-not (Test-Path -LiteralPath $packagedBootstrap -PathType Leaf)) { throw "Missing packaged bootstrap configuration: $packagedBootstrap" }
        if (-not (Test-Path -LiteralPath $packagedDocumentWorker -PathType Leaf)) { throw "Missing packaged document worker: $packagedDocumentWorker" }
        $longestPackagedPath = Get-ChildItem -LiteralPath $unpackedRoot -File -Recurse |
          Sort-Object { $_.FullName.Length } -Descending |
          Select-Object -First 1
        if ($null -ne $longestPackagedPath -and $longestPackagedPath.FullName.Length -ge 260) {
          throw "MSI packaging path exceeds the legacy Windows limit: $($longestPackagedPath.FullName)"
        }

        $rendererAsset = (& node $asarCli list $packagedAsar |
          Where-Object { $_ -match '^\\out\\renderer\\assets\\index-[^\\]+\.js$' } |
          Select-Object -First 1)
        if ([string]::IsNullOrWhiteSpace($rendererAsset)) {
          throw "Packaged renderer asset was not found in $packagedAsar"
        }
        $asarEntries = @(& node $asarCli list $packagedAsar)
        foreach ($requiredEntry in @(
          "\node_modules\exceljs\package.json",
          "\node_modules\jszip\package.json",
          "\node_modules\jszip\lib\index.js"
        )) {
          if ($asarEntries -notcontains $requiredEntry) {
            throw "Packaged runtime dependency is missing from app.asar: $requiredEntry"
          }
        }
        Write-Host "Verified packaged ExcelJS and JSZip runtime dependencies." -ForegroundColor DarkGray
        & node -e @"
const path = require('path');
const asar = require(process.argv[1]);
const archive = process.argv[2];
const file = path.join(...String(process.argv[3]).split(/[\\/]+/).filter(Boolean));
const text = asar.extractFile(archive, file).toString('utf8');
if (text.includes('http://127.0.0.1:8790') || text.includes('http://localhost:8790')) {
  console.error('Packaged app.asar still contains a local business gateway endpoint.');
  process.exit(4);
}
if (!text.includes(process.argv[4])) {
  console.error('Packaged app.asar is missing the selected remote gateway endpoint.');
  process.exit(5);
}
if (/tasklist\s+\/FI[\s\S]{0,240}find\s+\/I/.test(text)) {
  console.error('Packaged app.asar still contains the obsolete tasklist | find /I update wait loop.');
  process.exit(2);
}
if (!text.includes('Get-Process -Name')) {
  console.error('Packaged app.asar is missing the hidden Get-Process update wait loop.');
  process.exit(3);
}
"@ $asarPackageRoot $packagedAsar "out/main/index.js" $gatewayBaseUrl
        if ($LASTEXITCODE -ne 0) {
          throw "Unable to inspect the packaged desktop main bundle."
        }
        Write-Host "Verified packaged desktop update wait loop." -ForegroundColor DarkGray
        $rendererAssetPath = $rendererAsset.TrimStart("\")
        $rendererAssetText = & node -e @"
const path = require('path');
const asar = require(process.argv[1]);
const archive = process.argv[2];
const file = path.join(...String(process.argv[3]).split(/[\\/]+/).filter(Boolean));
process.stdout.write(asar.extractFile(archive, file));
"@ $asarPackageRoot $packagedAsar $rendererAssetPath
        if ($rendererAssetText -match '\bselectWorkspace\s*\(') {
          throw "Packaged renderer still contains obsolete selectWorkspace reference: $rendererAsset"
        }
        Write-Host "Verified renderer asset: $rendererAsset" -ForegroundColor DarkGray

        Write-Host "Verified packaged codeCN executable and icon resource." -ForegroundColor DarkGray

        $msiArgs = @("--win", "msi", "--prepackaged=$unpackedRoot", "--config.directories.output=$builderOutRel", "--config.npmRebuild=false")
        if (-not $requireSignature) { $msiArgs += "--config.win.signAndEditExecutable=false" }
        & node $electronBuilder @msiArgs
        $lastBuilderExit = $LASTEXITCODE
      }
    } finally {
      Remove-Item Env:\CODECN_MSI_INSTALL_DIR -ErrorAction SilentlyContinue
      Pop-Location
    }

    if ($lastBuilderExit -eq 0) {
      $generatedMsi = Join-Path $builderOut $builderArtifactName
      if (-not (Test-Path -LiteralPath $generatedMsi)) {
        $fallbackArtifact = Get-ChildItem -LiteralPath $builderOut -Filter "*.msi" -File -Recurse |
          Sort-Object LastWriteTime -Descending |
          Select-Object -First 1
        if ($null -ne $fallbackArtifact) {
          $generatedMsi = $fallbackArtifact.FullName
          $msiOut = Join-Path $releaseRoot $fallbackArtifact.Name
        }
      }
      break
    }

    if ($attempt -lt $maxPackageAttempts) {
      Write-Host "electron-builder failed with exit code $lastBuilderExit. Waiting before retry..." -ForegroundColor Yellow
      Start-Sleep -Seconds (2 * $attempt)
    }
  }
} finally {
  Write-Host "Packaged resources kept for reproducible MSI builds: $packageResourcesDir" -ForegroundColor DarkGray
}

if ($null -eq $generatedMsi) {
  throw "electron-builder failed with exit code $lastBuilderExit after $maxPackageAttempts attempts"
}

if (Test-Path -LiteralPath $generatedMsi) {
  New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
  try {
    Copy-Item -LiteralPath $generatedMsi -Destination $msiOut -Force
  } catch {
    $timestampedName = "{0} {1}-{2}-{3}.msi" -f $productName, $desktopPackage.version, $channelSlug, (Get-Date -Format "yyyyMMdd-HHmmss")
    $msiOut = Join-Path $releaseRoot $timestampedName
    Copy-Item -LiteralPath $generatedMsi -Destination $msiOut -Force
    Write-Host "Default MSI path was locked; wrote timestamped artifact instead." -ForegroundColor Yellow
  }
  if ((Get-Item -LiteralPath $msiOut).Length -le 0) {
    throw "Generated MSI is empty: $msiOut"
  }
  try {
    $signature = Get-AuthenticodeSignature -LiteralPath $msiOut
  } catch {
    if ($requireSignature) {
      throw "Unable to inspect MSI signature in Production channel: $($_.Exception.Message)"
    }
    $signature = [pscustomobject]@{ Status = "Unavailable" }
    Write-Host "MSI signature inspection unavailable; retaining Test artifact as unsigned." -ForegroundColor Yellow
  }
  if ($requireSignature -and $signature.Status -ne "Valid") {
    throw "MSI signature gate failed: $($signature.Status). Configure a signing certificate before release."
  }
  if (-not $requireSignature -and $signature.Status -ne "Valid") {
    $unsignedPath = Join-Path $releaseRoot ("{0} {1}-test-unsigned.msi" -f $productName, $desktopPackage.version)
    try {
      if (Test-Path -LiteralPath $unsignedPath) {
        Remove-Item -LiteralPath $unsignedPath -Force -ErrorAction Stop
      }
      Move-Item -LiteralPath $msiOut -Destination $unsignedPath -ErrorAction Stop
    } catch {
      $unsignedPath = Join-Path $releaseRoot ("{0} {1}-test-unsigned-{2}.msi" -f $productName, $desktopPackage.version, (Get-Date -Format "yyyyMMdd-HHmmss"))
      Move-Item -LiteralPath $msiOut -Destination $unsignedPath -ErrorAction Stop
      Write-Host "Default unsigned MSI path was locked; wrote timestamped artifact instead." -ForegroundColor Yellow
    }
    $msiOut = $unsignedPath
  }
  Write-Host "MSI signature status: $($signature.Status)" -ForegroundColor DarkGray
  Write-Host "MSI generated: $msiOut" -ForegroundColor Green
  Write-Host "Builder artifacts kept at: $builderOut" -ForegroundColor DarkGray

# -Ulit no longer renames the full Electron MSI. Real small patches are produced by
# windows/scripts/package-win-ulit-patch.ps1 (bsdiff of app.asar + tiny applicator).
$emitUlit = $Ulit -or ($env:CODECN_ULIT_PACKAGE -eq "1") -or ($env:CODECN_ULIT_PACKAGE -eq "true")
if ($emitUlit) {
  Write-Host "REFUSING to emit {version}ulit.MSI as a renamed full Electron MSI." -ForegroundColor Red
  Write-Host "Build a real patch instead:" -ForegroundColor Yellow
  Write-Host "  powershell -File windows/scripts/package-win-ulit-patch.ps1 -BaseVersion <prev> -TargetVersion $($desktopPackage.version)" -ForegroundColor Yellow
  throw "Use package-win-ulit-patch.ps1 for ulit packages (full MSI rename is not a patch)."
}
} else {
  Write-Host "MSI build finished, but no MSI artifact was found under: $builderOut" -ForegroundColor Yellow
  Write-Host "Check: $builderOut" -ForegroundColor Yellow
}
