# Creates or reloads the NewBrain code-signing certificate.
# The private key stays in the current user's profile. The public certificate is
# written under platforms/windows/certs so packaging can check the signer.

$ErrorActionPreference = "Stop"

function Get-NewBrainCodeSignDirectory {
  Join-Path $env:LOCALAPPDATA "NewBrain\codesign"
}

function Get-NewBrainPublicCertPath {
  $sourceRoot = if ([string]::IsNullOrWhiteSpace($env:NEWBRAIN_SOURCE_ROOT)) { "" } else { $env:NEWBRAIN_SOURCE_ROOT }
  if (-not [string]::IsNullOrWhiteSpace($sourceRoot)) {
    return Join-Path $sourceRoot "platforms\windows\certs\newbrain-codesign.cer"
  }
  return Join-Path (Split-Path -Parent $PSScriptRoot) "certs\newbrain-codesign.cer"
}

function Protect-NewBrainCodeSignFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
    "FullControl",
    "Allow"
  )
  $acl.ResetAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Import-NewBrainCodeSignPfx {
  param(
    [Parameter(Mandatory = $true)][string]$PfxPath,
    [Parameter(Mandatory = $true)][string]$PasswordFile
  )
  $secure = ConvertTo-SecureString -String (Get-Content -LiteralPath $PasswordFile -Raw).Trim() -AsPlainText -Force
  Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation "Cert:\CurrentUser\My" -Password $secure -Exportable | Out-Null
  $imported = Get-PfxData -FilePath $PfxPath -Password $secure
  return $imported.EndEntityCertificates | Select-Object -First 1
}

function Export-NewBrainPublicCertificate {
  param([Parameter(Mandatory = $true)]$Certificate)
  $publicPath = Get-NewBrainPublicCertPath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $publicPath) | Out-Null
  Export-Certificate -Cert $Certificate -FilePath $publicPath -Force | Out-Null
  Set-Content -LiteralPath ([System.IO.Path]::ChangeExtension($publicPath, ".thumbprint")) -Value $Certificate.Thumbprint -Encoding ascii -NoNewline
}

function Ensure-NewBrainCodeSignCertificate {
  $dir = Get-NewBrainCodeSignDirectory
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $pfxPath = Join-Path $dir "newbrain-codesign.pfx"
  $passwordFile = Join-Path $dir "newbrain-codesign.password"

  if ((Test-Path -LiteralPath $pfxPath) -and (Test-Path -LiteralPath $passwordFile)) {
    $existing = Import-NewBrainCodeSignPfx -PfxPath $pfxPath -PasswordFile $passwordFile
    Export-NewBrainPublicCertificate -Certificate $existing
    return [pscustomobject]@{
      Certificate = $existing
      Thumbprint = $existing.Thumbprint
      PfxPath = $pfxPath
    }
  }

  $created = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=NewBrain Code Signing, O=NewBrain, C=CN" `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(5) `
    -FriendlyName "NewBrain Code Signing"
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $passwordText = [Convert]::ToBase64String($bytes)
  Set-Content -LiteralPath $passwordFile -Value $passwordText -Encoding ascii -NoNewline
  Protect-NewBrainCodeSignFile -Path $passwordFile
  $secure = ConvertTo-SecureString -String $passwordText -AsPlainText -Force
  Export-PfxCertificate -Cert $created -FilePath $pfxPath -Password $secure | Out-Null
  Protect-NewBrainCodeSignFile -Path $pfxPath
  Export-NewBrainPublicCertificate -Certificate $created
  return [pscustomobject]@{
    Certificate = $created
    Thumbprint = $created.Thumbprint
    PfxPath = $pfxPath
  }
}

function Set-NewBrainAuthenticodeSignature {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Certificate
  )
  $signed = Set-AuthenticodeSignature -FilePath $Path -Certificate $Certificate -HashAlgorithm SHA256
  $checked = Get-AuthenticodeSignature -LiteralPath $Path
  $signer = $checked.SignerCertificate.Thumbprint
  if ($signer -ne $Certificate.Thumbprint) {
    throw "NewBrain signature missing on ${Path}. Status=$($checked.Status). Set-AuthenticodeSignature=$($signed.Status)."
  }
  return $checked
}
