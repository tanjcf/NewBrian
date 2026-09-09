# Register a canary desktop release against a running spring-app.
#
# Required env:
#   NEWBRAIN_ADMIN_COOKIE  - admin session cookie, OR
#   NEWBRAIN_ERRER_OUTF_TOKEN - Bearer errer_outf token
# Optional:
#   NEWBRAIN_SPRING_ORIGIN (default http://127.0.0.1:8791)
#   NEWBRAIN_MSI_URL
#   NEWBRAIN_MSI_SHA256
#   NEWBRAIN_MSI_VERSION
#   NEWBRAIN_ERROR_REPORT_ID  - if set, start auto-fix first and link job

$ErrorActionPreference = "Stop"
$origin = if ($env:NEWBRAIN_SPRING_ORIGIN) { $env:NEWBRAIN_SPRING_ORIGIN.TrimEnd("/") } else { "http://127.0.0.1:8791" }
$version = if ($env:NEWBRAIN_MSI_VERSION) { $env:NEWBRAIN_MSI_VERSION } else { "0.1.61" }
$url = if ($env:NEWBRAIN_MSI_URL) { $env:NEWBRAIN_MSI_URL } else { "http://127.0.0.1:8765/NewBrain%200.1.61-unsigned.msi" }
$sha = if ($env:NEWBRAIN_MSI_SHA256) { $env:NEWBRAIN_MSI_SHA256 } else { "2ac7e3b98db163f794070989164ba3b4e9e03dda49b5318b3ca5eb61ebe881ee" }
$headers = @{ Accept = "application/json"; "Content-Type" = "application/json" }
if ($env:NEWBRAIN_ERRER_OUTF_TOKEN) {
  $headers.Authorization = "Bearer $($env:NEWBRAIN_ERRER_OUTF_TOKEN)"
} elseif ($env:NEWBRAIN_ADMIN_COOKIE) {
  $headers.Cookie = $env:NEWBRAIN_ADMIN_COOKIE
} else {
  throw "Set NEWBRAIN_ERRER_OUTF_TOKEN or NEWBRAIN_ADMIN_COOKIE before registering canary."
}

$jobId = ""
if ($env:NEWBRAIN_ERROR_REPORT_ID) {
  $auto = Invoke-RestMethod -Method Post -Uri "$origin/api/admin/desktop-error-reports/$($env:NEWBRAIN_ERROR_REPORT_ID)/auto-fix" -Headers $headers
  $jobId = [string]$auto.job_id
  Write-Host "auto-fix job: $jobId"
}

$body = @{
  version = $version
  download_url = $url
  sha256 = $sha
  notes = "canary from local MSI package for auto-fix rollout"
  mandatory = $false
  channel = if ($jobId) { "draft" } else { "canary" }
  error_fingerprint = if ($env:NEWBRAIN_ERROR_FINGERPRINT) { $env:NEWBRAIN_ERROR_FINGERPRINT } else { "" }
  auto_fix_job_id = $jobId
} | ConvertTo-Json

$result = Invoke-RestMethod -Method Post -Uri "$origin/api/admin/desktop-app-releases" -Headers $headers -Body $body
$result | ConvertTo-Json -Depth 6
$out = "I:\G盘迁移备份\workrpase\NewBrain\integration-artifacts\usage-exception-feedback\canary-register.json"
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding UTF8
Write-Host "wrote $out"
