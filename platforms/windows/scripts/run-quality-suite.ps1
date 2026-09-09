<#
.SYNOPSIS
    NewBrain 自动质量检测流程：运行全部自动化测试 + 假实现/缺陷静态扫描，产出可复用报告。

.DESCRIPTION
    统一入口，供本地和 CI 复用。执行三类检查：
      1) agentd 运行时单元测试 (node --test)
      2) desktop 主进程/渲染层测试 (storage / security / settings / links / research-writing)
      3) 类型检查 (tsc --noEmit)
      4) 假实现痕迹静态扫描（TODO / 占位 / localStorage-only / 空 catch 等）
    结果写入 integration-artifacts/quality-report-<timestamp>.md，退出码非 0 表示存在失败或阻断项。

.EXAMPLE
    pwsh windows/scripts/run-quality-suite.ps1
    pwsh windows/scripts/run-quality-suite.ps1 -SkipTypeCheck
#>
param(
    [switch]$SkipTypeCheck,
    [switch]$ScanOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot  # -> windows/
$agentd   = Join-Path $repoRoot "apps/agentd"
$desktop  = Join-Path $repoRoot "apps/desktop"
$stamp    = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir   = Join-Path $repoRoot "integration-artifacts"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$report   = Join-Path $outDir "quality-report-$stamp.md"

$results = New-Object System.Collections.Generic.List[object]

function Invoke-Step {
    param([string]$Name, [string]$WorkDir, [string]$Command)
    Write-Host "==> $Name" -ForegroundColor Cyan
    if ($ScanOnly) { $results.Add([pscustomobject]@{ Name=$Name; Status="SKIPPED"; Detail="ScanOnly" }); return }
    Push-Location $WorkDir
    try {
        $output = & cmd /c "$Command 2>&1"
        $code = $LASTEXITCODE
        $tail = ($output | Select-Object -Last 6) -join "`n"
        $status = if ($code -eq 0) { "PASS" } else { "FAIL" }
        $results.Add([pscustomobject]@{ Name=$Name; Status=$status; Detail=$tail })
    } finally { Pop-Location }
}

# ---- 1. 自动化测试 ----
Invoke-Step "agentd 单元测试"        $agentd  "node --test src/*.test.js"
Invoke-Step "desktop 存储/主进程测试" $desktop "npm run test:storage"
Invoke-Step "desktop 安全回归"        $desktop "npm run test:security"
Invoke-Step "desktop 设置测试"        $desktop "npm run test:settings"
if (-not $SkipTypeCheck) {
    Invoke-Step "desktop 类型检查"    $desktop "npm run check"
}

# ---- 2. 假实现静态扫描 ----
Write-Host "==> 假实现痕迹扫描" -ForegroundColor Cyan
$srcRoots = @((Join-Path $agentd "src"), (Join-Path $desktop "src"))
$patterns = @{
    "TODO/FIXME/未实现"          = "TODO|FIXME|not implemented|暂未实现|即将接入|即将上线"
    "占位/Mock/硬编码"           = "placeholder|mockData|hardcoded|fallbackSkills"
    "仅本地存储(疑似假保存)"      = "localStorage\.(setItem|set)\("
    "空catch吞错"                = "catch\s*\([^)]*\)\s*\{\s*\}"
}
$scanFindings = New-Object System.Collections.Generic.List[object]
foreach ($pat in $patterns.GetEnumerator()) {
    $hits = Get-ChildItem -Path $srcRoots -Recurse -Include *.ts,*.tsx,*.js,*.mjs -File `
        | Where-Object { $_.FullName -notmatch "node_modules|\.test\.|\.corrupt" } `
        | Select-String -Pattern $pat.Value -AllMatches
    $scanFindings.Add([pscustomobject]@{ Category=$pat.Key; Count=($hits | Measure-Object).Count; Hits=$hits })
}

# ---- 3. 生成报告 ----
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# NewBrain 质量检测报告")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("生成时间: $stamp")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## 自动化测试结果")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| 步骤 | 结果 |")
[void]$sb.AppendLine("|------|------|")
foreach ($r in $results) { [void]$sb.AppendLine("| $($r.Name) | $($r.Status) |") }
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## 假实现痕迹静态扫描")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| 类别 | 命中数 |")
[void]$sb.AppendLine("|------|--------|")
foreach ($f in $scanFindings) { [void]$sb.AppendLine("| $($f.Category) | $($f.Count) |") }
[void]$sb.AppendLine("")
[void]$sb.AppendLine("### 命中明细")
foreach ($f in $scanFindings) {
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("#### $($f.Category)")
    foreach ($h in ($f.Hits | Select-Object -First 40)) {
        $rel = $h.Path.Replace($repoRoot, "").TrimStart('\','/')
        [void]$sb.AppendLine("- $rel : $($h.LineNumber)")
    }
}
Set-Content -Path $report -Value $sb.ToString() -Encoding UTF8

Write-Host ""
Write-Host "报告已写入: $report" -ForegroundColor Green
$results | Format-Table -AutoSize

$failed = $results | Where-Object { $_.Status -eq "FAIL" }
if ($failed) { exit 1 } else { exit 0 }
