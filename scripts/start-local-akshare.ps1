# Start local quant upstream used by spring-app → AKShare → BRAIN desktop.
# Desktop must call Spring /api/desktop/v1/market-bars (never 5001 directly).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$akshare = Join-Path (Split-Path -Parent $root) "stock-quant-platform\adapters\akshare"
if (-not (Test-Path (Join-Path $akshare "app.py"))) {
  throw "AKShare adapter not found at $akshare"
}

$health = $null
try { $health = Invoke-RestMethod "http://127.0.0.1:5001/health" -TimeoutSec 2 } catch { $health = $null }
if ($health -and $health.status -eq "ok") {
  Write-Host "AKShare already healthy on 127.0.0.1:5001"
  exit 0
}

Write-Host "Starting AKShare adapter on 127.0.0.1:5001 ..."
Start-Process -FilePath "python" -ArgumentList @("-m","uvicorn","app:app","--host","127.0.0.1","--port","5001") -WorkingDirectory $akshare -WindowStyle Minimized
$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:5001/health" -TimeoutSec 2
    if ($health.status -eq "ok") {
      Write-Host "AKShare ready: $($health | ConvertTo-Json -Compress)"
      exit 0
    }
  } catch { }
} while ((Get-Date) -lt $deadline)

throw "AKShare failed to become healthy on 127.0.0.1:5001"
