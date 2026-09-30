# Windows MSI signing

Formal Windows releases require an Authenticode code-signing certificate. The release workflow passes:

- `WINDOWS_CSC_LINK`: a GitHub secret containing a base64-encoded PFX/PKCS#12 certificate or a supported certificate URL.
- `WINDOWS_CSC_KEY_PASSWORD`: the corresponding certificate password.

The workflow sets `NEWBRAIN_REQUIRE_SIGNATURE=true`. Packaging fails unless `Get-AuthenticodeSignature` reports `Valid` for the final MSI. Local builds without a certificate remain available for testing, but are named `NewBrain <version>-unsigned.msi` so they cannot be confused with release artifacts.

After configuring the secrets, run the `Build Windows Installer (MSI)` workflow and verify the uploaded MSI:

```powershell
Get-AuthenticodeSignature '.\NewBrain <version>.msi' | Format-List Status,SignerCertificate,TimeStamperCertificate
```

Only artifacts with `Status: Valid` are eligible for distribution.
