param(
  [string]$Version,
  [switch]$SkipBuild,
  [ValidateSet("Test", "Production")]
  [string]$Channel = "Test",
  # Transitional upgrade substitute package ("升级文件替代包"): emit {version}ulit.MSI
  [switch]$Ulit,
  # Allow Production artifacts without Authenticode when no signing cert is configured.
  [switch]$AllowUnsigned
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RceditPath {
  $cacheRoot = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
  if (-not (Test-Path -LiteralPath $cacheRoot)) {
    throw "electron-builder winCodeSign cache is missing: $cacheRoot"
  }
  $hit = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter "rcedit-x64.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if ($null -eq $hit) {
    throw "rcedit-x64.exe was not found under $cacheRoot"
  }
  return $hit.FullName
}

function Set-NewBrainExecutableIcon {
  param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][string]$IconPath
  )
  if (-not (Test-Path -LiteralPath $ExecutablePath)) {
    throw "Executable missing for icon edit: $ExecutablePath"
  }
  if (-not (Test-Path -LiteralPath $IconPath)) {
    throw "Icon missing for executable edit: $IconPath"
  }
  $rcedit = Resolve-RceditPath
  & $rcedit $ExecutablePath --set-icon $IconPath
  if ($LASTEXITCODE -ne 0) {
    throw "rcedit failed while setting icon on $ExecutablePath (exit $LASTEXITCODE)"
  }
}

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
. (Join-Path $PSScriptRoot "msi-version.ps1")
if (-not [string]::IsNullOrWhiteSpace($Version)) {
  Assert-MsiVersion $Version
  $desktopPackage.version = $Version
  # Persist version with Node JSON round-trip (PowerShell ConvertTo-Json corrupts nested package.json).
  $desktopPackageJsonPath = Join-Path $desktopRoot "package.json"
  $nodeSetter = @'
const fs = require("fs");
const path = process.argv[2];
const version = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
pkg.version = version;
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n", "utf8");
'@
  $nodeSetterPath = Join-Path $env:TEMP "newbrain-set-desktop-version.js"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($nodeSetterPath, $nodeSetter, $utf8NoBom)
  & node $nodeSetterPath $desktopPackageJsonPath $Version
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to persist desktop package.json version $Version"
  }
  Write-Host "Desktop package.json version set to $($desktopPackage.version)" -ForegroundColor Cyan
}
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
$msiInstallDir = $env:NEWBRAIN_MSI_INSTALL_DIR
$rootConfigPath = Join-Path $repoRoot "newbrain.config.json"
$featureConfigPath = Join-Path $repoRoot "newbrain.features.json"
$bootstrapConfigPath = Join-Path $repoRoot "newbrain.bootstrap.json"
$documentWorkerSourcePath = Join-Path $desktopRoot "src\main\document-worker.js"
$documentWorkerPath = Join-Path $desktopRoot "document-worker.js"
$packageResourcesDir = Join-Path $desktopRoot "build\package-resources"
$packageConfigPath = Join-Path $packageResourcesDir "newbrain.config.json"
$packageFeatureConfigPath = Join-Path $packageResourcesDir "newbrain.features.json"
$iconPath = Join-Path $desktopRoot "build\icon.ico"
$rustCoreBuildScript = Join-Path $repoRoot "scripts\build-rust-core.ps1"
$rustCorePackagePath = Join-Path $desktopRoot "build\rust-core\brain-core.exe"
$sourceRoot = if ([string]::IsNullOrWhiteSpace($env:NEWBRAIN_SOURCE_ROOT)) { $repoRoot } else { $env:NEWBRAIN_SOURCE_ROOT }
$gatewayBaseUrl = if ($isProduction) { $env:NEWBRAIN_PRODUCTION_GATEWAY_BASE_URL } else { $env:NEWBRAIN_TEST_GATEWAY_BASE_URL }
$previewUrl = if ($isProduction) { $env:NEWBRAIN_PRODUCTION_PREVIEW_URL } else { $env:NEWBRAIN_TEST_PREVIEW_URL }
# Test keeps the known-live Spring IP. Production uses separate API and web domains;
# retired *.wangjietech.com hosts stay in rewrite lists for legacy asar cleanup only.
if ([string]::IsNullOrWhiteSpace($gatewayBaseUrl)) {
  $gatewayBaseUrl = if ($isProduction) { "https://api.sinnauze.cn/v1" } else { "http://203.0.113.10:8790/v1" }
}
if ([string]::IsNullOrWhiteSpace($previewUrl)) {
  $previewUrl = if ($isProduction) { "https://www.sinnauze.cn" } else { "http://203.0.113.10:3000" }
}
$allowUnsigned = $AllowUnsigned -or ($env:NEWBRAIN_ALLOW_UNSIGNED -eq "true")
$requireSignature = ($isProduction -or ($env:NEWBRAIN_REQUIRE_SIGNATURE -eq "true")) -and -not $allowUnsigned
$hasSigningMaterial = -not [string]::IsNullOrWhiteSpace($env:CSC_LINK) `
  -or -not [string]::IsNullOrWhiteSpace($env:WINDOWS_CSC_LINK) `
  -or -not [string]::IsNullOrWhiteSpace($env:CSC_KEY_PASSWORD)
if ($requireSignature -and -not $hasSigningMaterial) {
  throw "Production MSI requires Authenticode signing, but CSC_LINK / WINDOWS_CSC_LINK is not configured. Re-run with -AllowUnsigned to emit an unsigned production package, or configure a code-signing certificate."
}

foreach ($endpoint in @($gatewayBaseUrl, $previewUrl)) {
  $endpointUri = $null
  if (-not [Uri]::TryCreate($endpoint, [UriKind]::Absolute, [ref]$endpointUri) -or $endpointUri.Scheme -notin @("http", "https")) {
    throw "Invalid $Channel endpoint: $endpoint"
  }
  if ($endpointUri.IsLoopback) {
    throw "$Channel MSI endpoint must not use a loopback host: $endpoint"
  }
}

if ($isProduction -and -not $allowUnsigned) {
  $gitStatus = @(& git -C $sourceRoot status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw "Unable to verify Git status for the production release." }
  if ($gitStatus.Count -gt 0) { throw "Production release requires a clean Git worktree." }
}
if ($isProduction -and $allowUnsigned -and (@(& git -C $sourceRoot status --porcelain)).Count -gt 0) {
  Write-Host "Unsigned production package: continuing with a dirty Git worktree." -ForegroundColor Yellow
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

Write-Host "Keeping installed NewBrain processes running; packaging uses an isolated output directory." -ForegroundColor DarkGray

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
        systemPrompt = "You are a helpful coding assistant for the NewBrain desktop workspace."
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
        if ($text.Contains("127.0.0.1") -or $text.Contains("203.0.113.10") -or $text.Contains("wangjietech.com") -or $text.Contains("sinnauze.cn")) {
          # Tokenize gateway URLs first so later preview host rewrites cannot turn
          # https://api.sinnauze.cn/v1 into https://www.sinnauze.cn/v1.
          $gatewayToken = "__NEWBRAIN_GATEWAY_BASE_URL__"
          $updated = $text.
            Replace("http://127.0.0.1:8790/v1", $gatewayToken).
            Replace("http://203.0.113.10:8790/v1", $gatewayToken).
            Replace("https://api.sinnauze.cn/v1", $gatewayToken).
            Replace("https://test.wangjietech.com/v1", $gatewayToken).
            Replace("https://api.wangjietech.com/v1", $gatewayToken).
            Replace("http://test.wangjietech.com/v1", $gatewayToken).
            Replace("http://api.wangjietech.com/v1", $gatewayToken).
            Replace("http://127.0.0.1:3000", $previewUrl).
            Replace("http://203.0.113.10:3000", $previewUrl).
            Replace("https://www.sinnauze.cn", $previewUrl).
            Replace("https://api.sinnauze.cn", $previewUrl).
            Replace("https://test.wangjietech.com", $previewUrl).
            Replace("https://api.wangjietech.com", $previewUrl).
            Replace($gatewayToken, $gatewayBaseUrl)
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
        $env:NEWBRAIN_MSI_INSTALL_DIR = $msiInstallDir
      }
      $dirArgs = @("--win", "dir", "--config.directories.output=$builderOutRel", "--config.npmRebuild=false")
      $dirArgs += "--config.extraMetadata.version=$($desktopPackage.version)"
      if (-not $requireSignature) { $dirArgs += "--config.win.signAndEditExecutable=false" }
      $builderStage = "application"
      $builderLog = Join-Path $builderOut "electron-builder-application.log"
      & node $electronBuilder @dirArgs 2>&1 | Tee-Object -FilePath $builderLog
      $lastBuilderExit = $LASTEXITCODE
      if ($lastBuilderExit -eq 0) {
        $unpackedRoot = Join-Path $builderOut "win-unpacked"
        $unpackedExe = Join-Path $unpackedRoot "$productName.exe"
        $packagedIcon = Join-Path $unpackedRoot "resources\\newbrain.ico"
        $packagedAsar = Join-Path $unpackedRoot "resources\\app.asar"
        $packagedRustCore = Join-Path $unpackedRoot "resources\\brain-core\\brain-core.exe"
        $packagedBootstrap = Join-Path $unpackedRoot "resources\\newbrain.bootstrap.json"
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
const packagedVersion = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8')).version;
if (packagedVersion !== process.argv[5]) {
  console.error('Packaged application version does not match requested MSI version.');
  process.exit(6);
}
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
"@ $asarPackageRoot $packagedAsar "out/main/index.js" $gatewayBaseUrl $desktopPackage.version
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

        # Unsigned builds disable electron-builder's signAndEditExecutable to avoid Authenticode
        # failures, which also skips embedding the app icon into the .exe (taskbar falls back to
        # the Electron atom). Always re-apply the NewBrain icon with rcedit for unsigned packages.
        if (-not $requireSignature) {
          Set-NewBrainExecutableIcon -ExecutablePath $unpackedExe -IconPath $iconPath
          Write-Host "Applied NewBrain icon to unsigned executable via rcedit." -ForegroundColor DarkGray
        }

        Write-Host "Verified packaged NewBrain executable and icon resource." -ForegroundColor DarkGray

        $msiArgs = @("--win", "msi", "--prepackaged=$unpackedRoot", "--config.directories.output=$builderOutRel", "--config.npmRebuild=false")
        $msiArgs += "--config.extraMetadata.version=$($desktopPackage.version)"
        if (-not $requireSignature) { $msiArgs += "--config.win.signAndEditExecutable=false" }
        $builderStage = "msi"
        $builderLog = Join-Path $builderOut "electron-builder-msi.log"
        & node $electronBuilder @msiArgs 2>&1 | Tee-Object -FilePath $builderLog
        $lastBuilderExit = $LASTEXITCODE
        if ($lastBuilderExit -eq 0) {
          $nsisArgs = @("--win", "nsis", "--prepackaged=$unpackedRoot", "--config.directories.output=$builderOutRel", "--config.npmRebuild=false")
          $nsisArgs += "--config.extraMetadata.version=$($desktopPackage.version)"
          if (-not $requireSignature) { $nsisArgs += "--config.win.signAndEditExecutable=false" }
          $builderStage = "nsis"
          $builderLog = Join-Path $builderOut "electron-builder-nsis.log"
          Write-Host "Packaging NSIS setup (electron-builder)..." -ForegroundColor Cyan
          & node $electronBuilder @nsisArgs 2>&1 | Tee-Object -FilePath $builderLog
          $lastBuilderExit = $LASTEXITCODE
        }
      }
    } finally {
      Remove-Item Env:\NEWBRAIN_MSI_INSTALL_DIR -ErrorAction SilentlyContinue
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
  throw "electron-builder failed at stage '$builderStage' with exit code $lastBuilderExit after $maxPackageAttempts attempts. Full log: $builderLog"
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
    $unsignedSuffix = if ($isProduction) { "production-unsigned" } else { "test-unsigned" }
    $unsignedPath = Join-Path $releaseRoot ("{0} {1}-{2}.msi" -f $productName, $desktopPackage.version, $unsignedSuffix)
    try {
      if (Test-Path -LiteralPath $unsignedPath) {
        Remove-Item -LiteralPath $unsignedPath -Force -ErrorAction Stop
      }
      Move-Item -LiteralPath $msiOut -Destination $unsignedPath -ErrorAction Stop
    } catch {
      $unsignedPath = Join-Path $releaseRoot ("{0} {1}-{2}-{3}.msi" -f $productName, $desktopPackage.version, $unsignedSuffix, (Get-Date -Format "yyyyMMdd-HHmmss"))
      Move-Item -LiteralPath $msiOut -Destination $unsignedPath -ErrorAction Stop
      Write-Host "Default unsigned MSI path was locked; wrote timestamped artifact instead." -ForegroundColor Yellow
    }
    $msiOut = $unsignedPath
  }
  Write-Host "MSI signature status: $($signature.Status)" -ForegroundColor DarkGray
  Write-Host "MSI generated: $msiOut" -ForegroundColor Green
  Write-Host "Builder artifacts kept at: $builderOut" -ForegroundColor DarkGray

  $generatedNsis = Get-ChildItem -LiteralPath $builderOut -Filter "*-setup.exe" -File -Recurse |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $generatedNsis) {
    $generatedNsis = Get-ChildItem -LiteralPath $builderOut -Filter "*.exe" -File -Recurse |
      Where-Object { $_.Name -match 'setup' -or $_.Name -match '\.exe$' } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
  }
  $nsisOut = $null
  if ($null -ne $generatedNsis) {
    $unsignedSuffix = if ($isProduction) { "production-unsigned" } else { "test-unsigned" }
    $nsisName = if ($requireSignature) {
      "{0} {1}-setup.exe" -f $productName, $desktopPackage.version
    } else {
      "{0} {1}-setup-{2}.exe" -f $productName, $desktopPackage.version, $unsignedSuffix
    }
    $nsisOut = Join-Path $releaseRoot $nsisName
    Copy-Item -LiteralPath $generatedNsis.FullName -Destination $nsisOut -Force
    $nsisHash = (Get-FileHash -LiteralPath $nsisOut -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "NSIS setup generated: $nsisOut" -ForegroundColor Green
    Write-Host "NSIS SHA-256: $nsisHash" -ForegroundColor Cyan
    $springSummary = [ordered]@{
      available = $true
      latest_version = $desktopPackage.version
      download_url = "<upload-and-paste-public-url>"
      sha256 = $nsisHash
      notes = "<paste release notes markdown>"
      package_kind = "nsis"
      channel = $channelSlug
      local_path = $nsisOut
    }
    $springSummaryPath = Join-Path $releaseRoot ("app-update-spring-{0}.json" -f $desktopPackage.version)
    $springSummary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $springSummaryPath -Encoding UTF8
    Write-Host "Spring app-update summary: $springSummaryPath" -ForegroundColor Cyan
  } else {
    Write-Host "NSIS setup artifact not found under builder output; MSI-only release." -ForegroundColor Yellow
  }

# -Ulit no longer renames the full Electron MSI. Real small patches are produced by
# windows/scripts/package-win-ulit-patch.ps1 (bsdiff of app.asar + tiny applicator).
$emitUlit = $Ulit -or ($env:NEWBRAIN_ULIT_PACKAGE -eq "1") -or ($env:NEWBRAIN_ULIT_PACKAGE -eq "true")
if ($emitUlit) {
  Write-Host "REFUSING to emit {version}ulit.MSI as a renamed full Electron MSI." -ForegroundColor Red
  Write-Host "Build a real patch instead:" -ForegroundColor Yellow
  Write-Host "  powershell -File windows/scripts/package-win-ulit-patch.ps1 -BaseVersion <prev> -TargetVersion $($desktopPackage.version)" -ForegroundColor Yellow
  throw "Use package-win-ulit-patch.ps1 for ulit packages (full MSI rename is not a patch)."
}
} else {
  throw "MSI build finished, but no MSI artifact was found under: $builderOut"
}
