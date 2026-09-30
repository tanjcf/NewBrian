export interface MsiUpdateRunnerInput {
  msiPath: string;
  args: string[];
  executablePath: string;
  processId: number;
  dataRoot: string;
  chatRoot: string;
  downloadDir: string;
  backupRoot: string;
  resultPath: string;
  fullMsi?: boolean;
  expectedVersion?: string;
}

/** Runs outside Electron so no live SQLite database is copied during backup. */
export function buildMsiUpdateRunner(input: MsiUpdateRunnerInput): string {
  const payload = Buffer.from(JSON.stringify(input), "utf8").toString("base64");
  return `$ErrorActionPreference = 'Stop'
$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$result = [ordered]@{ status = 'waiting'; backupRoot = $config.backupRoot; msiPath = $config.msiPath; exitCode = $null; detail = '' }
function Save-Result {
  [IO.File]::WriteAllText($config.resultPath, ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
try {
  Save-Result
  if ($config.fullMsi) {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($config.msiPath, 0)
    $properties = @{}
    $view = $database.OpenView('SELECT Property, Value FROM Property')
    $view.Execute()
    while ($row = $view.Fetch()) { $properties[[string]$row.StringData(1)] = [string]$row.StringData(2) }
    $view.Close()
    if (([string]$properties.UpgradeCode).Trim('{}') -ne '2D97097C-03A2-54F7-B1D4-7E34233F7A65') { throw 'The update is not a compatible NewBrain installer.' }
    $version = (([string]$properties.ProductVersion).Split('.')[0..2] -join '.')
    if ($version -ne $config.expectedVersion) { throw "Installer version $version does not match the published release." }
    $view = $database.OpenView("SELECT ActionProperty FROM Upgrade WHERE ActionProperty = 'WIX_UPGRADE_DETECTED'")
    $view.Execute()
    if (-not $view.Fetch()) { throw 'Installer has no major-upgrade rule; refusing to create another installation.' }
    $view.Close()
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) | Out-Null
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) | Out-Null
  }
  $running = Get-Process -Id $config.processId -ErrorAction SilentlyContinue
  if ($running) {
    if (-not $running.WaitForExit(90000)) {
      # Soft quit can leave a headless Electron process alive; force-release locks.
      Stop-Process -Id $config.processId -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      $still = Get-Process -Id $config.processId -ErrorAction SilentlyContinue
      if ($still) { throw 'Application did not exit; update cancelled without changing files.' }
    }
  }
  $result.status = 'backing-up'
  Save-Result
  New-Item -ItemType Directory -Force -Path $config.backupRoot | Out-Null
  foreach ($entry in @(@{ source = $config.dataRoot; name = 'user-data' }, @{ source = $config.chatRoot; name = 'chat-files' })) {
    if (-not (Test-Path -LiteralPath $entry.source -PathType Container)) { continue }
    $destination = Join-Path $config.backupRoot $entry.name
    & robocopy.exe $entry.source $destination /E /COPY:DAT /DCOPY:DAT /XJ /R:1 /W:1 /XD $config.downloadDir /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "User data backup failed with robocopy exit code $LASTEXITCODE; installation cancelled." }
  }
  $result.status = 'installing'
  Save-Result
  $logPath = Join-Path $config.backupRoot 'install.log'
  $installArgs = @($config.args)
  # Insert logging before ALLUSERS=, which must remain the last MSI argument.
  $installArgs = @('/L*v', $logPath, 'NEWBRAIN_UPDATE_RUNNER=1') + $installArgs
  & msiexec.exe @installArgs | Out-Null
  $result.exitCode = $LASTEXITCODE
  if ($LASTEXITCODE -notin @(0, 3010)) { throw "MSI installation failed: $LASTEXITCODE. See $logPath" }
  $result.status = 'installed'
  Save-Result
} catch {
  $result.status = 'error'
  $result.detail = $_.Exception.Message + [Environment]::NewLine + $_.ScriptStackTrace
  Save-Result
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($result.detail + [Environment]::NewLine + 'Backup: ' + $config.backupRoot, 'NewBrain update') | Out-Null
}
if (Test-Path -LiteralPath $config.executablePath) {
  Start-Process -FilePath $config.executablePath -WorkingDirectory (Split-Path -Parent $config.executablePath)
}
`;
}
