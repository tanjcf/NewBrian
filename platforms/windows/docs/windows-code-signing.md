# Windows MSI signing

Production packages are signed with the NewBrain code-signing certificate. That certificate is created on the packaging machine by `scripts/ensure-newbrain-codesign.ps1`. Apple Developer ID and commercial Windows Authenticode certificates are not required.

The private key stays in `%LOCALAPPDATA%\NewBrain\codesign\`. The public certificate is `platforms/windows/certs/newbrain-codesign.cer`. Packaging accepts the MSI when the signer thumbprint matches this certificate. Windows does not have to report `Valid`, because this certificate is not issued by a public CA.

Test packages stay unsigned and use the `test-unsigned` file name. A production package whose signer is not the NewBrain certificate is rejected.
