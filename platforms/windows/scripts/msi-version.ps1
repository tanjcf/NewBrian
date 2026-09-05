function Assert-MsiVersion {
  param([string]$Version)
  if ($Version -notmatch '^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,4})$') {
    throw "Use a numeric MSI version such as 1.4.4 (no v prefix or -test suffix)."
  }
  $parts = $Version.Split('.')
  if ([int]$parts[0] -gt 255 -or [int]$parts[1] -gt 255 -or [int]$parts[2] -gt 65535) {
    throw "MSI version limits: major <= 255, minor <= 255, patch <= 65535."
  }
}
