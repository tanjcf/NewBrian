const { readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

exports.default = async function msiProjectCreated(projectFile) {
  // light.exe runs from the generated project's directory, not the desktop root.
  writeFileSync(join(dirname(projectFile), "newbrain-localization.wxl"), readFileSync(join(__dirname, "msi-localization.wxl")));
  let xml = readFileSync(projectFile, "utf8");
  const explicitInstallDir = process.env.NEWBRAIN_MSI_INSTALL_DIR;
  if (explicitInstallDir) {
    const normalizedInstallDir = explicitInstallDir.replace(/\//g, "\\").replace(/\\+$/, "");
    const installDirProperty = `<Property Id="APPLICATIONFOLDER" Value="${escapeXmlAttr(normalizedInstallDir)}"/>`;

    if (!xml.includes('<Property Id="APPLICATIONFOLDER"')) {
      xml = xml.replace(
        /(<Property Id="ApplicationFolderName" Value="[^"]*"\/>)/,
        `$1\n    ${installDirProperty}`
      );
    }
  }

  if (!explicitInstallDir) {
    xml = xml.replace(/\n\s*<Property Id="APPLICATIONFOLDER" Value="[^"]*"\/>/g, "");

    xml = xml.replace(
      /(<Property Id="ApplicationFolderName" Value=")[^"]*("\/>)/,
      '$1.newbrain$2'
    );

    xml = xml.replace(
      /<Directory Id="ProgramFiles64Folder">\s*<Directory Id="APPLICATIONFOLDER" Name="[^"]*"\/>\s*<\/Directory>/,
      '<Directory Id="LocalAppDataFolder">\n                      <Directory Id="APPLICATIONFOLDER" Name=".newbrain"/>\n              </Directory>'
    );
    // Older installers record the selected directory here. Standalone chat files
    // live below that directory, so changing it during an upgrade loses continuity.
    xml = xml.replace(/(<\/Product>)/, `
    <Property Id="APPLICATIONFOLDER" Secure="yes">
      <RegistrySearch Id="PreviousNewbrainInstallDirectory" Root="HKCU" Key="Environment" Name="NEWBRAIN_HOME" Type="raw"/>
    </Property>
$1`);
  }

  xml = xml
    .replace(/\n\s*<Property Id="NEWBRAIN_USERPROFILE">[\s\S]*?<\/Property>/g, "")
    .replace(/\n\s*<CustomAction Id="SetApplicationFolderToNewbrainHome"[\s\S]*?<\/InstallExecuteSequence>/g, "");

  xml = xml
    .replace(/\n\s*<CustomAction Id="runAfterFinish"[^>]*\/>/g, "")
    .replace(/\n\s*<Property Id="WIXUI_EXITDIALOGOPTIONALCHECKBOX"[^>]*\/>/g, "")
    .replace(/\n\s*<Property Id="WIXUI_EXITDIALOGOPTIONALCHECKBOXTEXT"[^>]*\/>/g, "")
    .replace(/\n\s*<UI>\s*<Publish Dialog="ExitDialog" Control="Finish" Event="DoAction" Value="runAfterFinish">[\s\S]*?<\/Publish>\s*<\/UI>/g, "");

  if (!xml.includes('<Property Id="ROOTDRIVE"')) {
    xml = xml.replace(
      /(<Property Id="ApplicationFolderName" Value="[^"]*"\/>)/,
      `$1\n    <Property Id="ROOTDRIVE" Value="C:\\\\"/>`
    );
  }
  // Remove old products inside the MSI transaction, before writing replacement files.
  // Keep the existing UpgradeCode so already-installed versions are discovered.
  if (!/<MajorUpgrade\b[^>]*\/>/.test(xml)) {
    throw new Error("MSI template is missing MajorUpgrade; refusing a side-by-side install.");
  }
  xml = xml.replace(/<MajorUpgrade\b[^>]*\/>/, '<MajorUpgrade AllowSameVersionUpgrades="yes" Schedule="afterInstallInitialize" DowngradeErrorMessage="A newer version of [ProductName] is already installed."/>');
  xml = addStopRunningApplicationAction(xml);
  xml = addNewbrainHomeEnvironmentActions(xml);
  xml = addUninstallCleanupAction(xml);
  xml = addLaunchAfterInstallAction(xml);
  xml = addDesktopShortcutAction(xml);
  xml = stabilizeApplicationShortcuts(xml);

  assertApplicationFolder(xml, explicitInstallDir);

  if (process.env.NEWBRAIN_MSI_DEBUG_PROJECT) {
    writeFileSync(`${projectFile}.newbrain.wxs`, xml, "utf8");
  }

  writeFileSync(projectFile, xml, "utf8");
};

function escapeXmlAttr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Insert XML before </Product> without interpreting $-patterns in the snippet (PowerShell uses $vars). */
function appendBeforeProductClose(xml, snippet) {
  const marker = "</Product>";
  const index = xml.lastIndexOf(marker);
  if (index < 0) throw new Error("MSI project is missing </Product>.");
  return `${xml.slice(0, index)}${snippet}\n${xml.slice(index)}`;
}

function stabilizeApplicationShortcuts(xml) {
  return xml.replace(
    /(<Shortcut Id="(?:desktopShortcut|startMenuShortcut)")([^>]*?)\sAdvertise="yes"/g,
    '$1$2 Advertise="no"'
  );
}

/**
 * WiX advertised shortcuts often miss the Desktop after APPLICATIONFOLDER is
 * rewritten under LocalAppData\\.newbrain, and leftover Program Files / NSIS
 * links keep pointing at the old install. Always rewrite Desktop + Start Menu
 * .lnk files after InstallFinalize.
 *
 * Executable may be newbrain.exe (executableName) or NewBrain.exe (productName);
 * resolve either. Fall back to %LOCALAPPDATA%\\.newbrain when APPLICATIONFOLDER
 * formatting fails so Return="ignore" does not silently skip the Desktop icon.
 */
function addDesktopShortcutAction(xml) {
  if (xml.includes('Id="CreateNewbrainDesktopShortcut"')) return xml;
  // Avoid regex end-anchor "$'" inside ExeCommand — String.replace would treat $' as a pattern.
  const command = [
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command",
    "\"$ErrorActionPreference='SilentlyContinue';",
    "$folder=[Environment]::ExpandEnvironmentVariables('[APPLICATIONFOLDER]').Trim().TrimEnd('\\');",
    "if(-not $folder -or $folder -like '*APPLICATIONFOLDER*'){$folder=Join-Path $env:LOCALAPPDATA '.newbrain'};",
    "$exe=$null; foreach($n in @('NewBrain.exe','newbrain.exe')){$c=Join-Path $folder $n; if(Test-Path -LiteralPath $c){$exe=$c; break}};",
    "if(-not $exe){$hit=Get-ChildItem -LiteralPath $folder -Filter '*.exe' -File -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -ieq 'newbrain' } | Select-Object -First 1; if($hit){$exe=$hit.FullName}};",
    "if(-not $exe -or -not (Test-Path -LiteralPath $exe)){exit 0};",
    "$folder=Split-Path -Parent $exe;",
    "$ico=Join-Path $folder 'resources\\newbrain.ico'; if(-not (Test-Path -LiteralPath $ico)){$ico=$exe};",
    "$w=New-Object -ComObject WScript.Shell;",
    "$desk=[Environment]::GetFolderPath('Desktop');",
    "$menu=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs';",
    "foreach($p in @((Join-Path $desk 'NewBrain.lnk'),(Join-Path $menu 'NewBrain.lnk'))){",
    "$dir=Split-Path -Parent $p; if(-not (Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null};",
    "$s=$w.CreateShortcut($p); $s.TargetPath=$exe; $s.WorkingDirectory=$folder; $s.Description='NewBrain'; $s.IconLocation=$ico+',0'; $s.Save()",
    "}; exit 0\""
  ].join(" ");
  const action = `\n    <CustomAction Id="CreateNewbrainDesktopShortcut" Directory="APPLICATIONFOLDER" ExeCommand="${escapeXmlAttr(command)}" Execute="immediate" Impersonate="yes" Return="ignore"/>`;
  xml = appendBeforeProductClose(xml, action);
  xml = insertInstallExecuteSequenceAction(
    xml,
    '<Custom Action="CreateNewbrainDesktopShortcut" After="InstallFinalize">NOT REMOVE AND (NOT Installed OR REINSTALL OR UPGRADINGPRODUCTCODE)</Custom>'
  );
  return xml;
}

function addStopRunningApplicationAction(xml) {
  if (xml.includes('Id="StopRunningNewbrain"')) return xml;
  // Force-kill any historical NewBrain still holding locks under .newbrain /
  // Programs. Cover both casing variants plus the Rust sidecar; brief ping wait
  // lets Windows release file handles before InstallFiles.
  // Directory must be TARGETDIR (always present in electron-builder WiX); SystemFolder
  // is not defined in this template and fails light.exe with LGHT0094.
  const command = [
    "cmd.exe /C",
    "taskkill /F /IM NewBrain.exe /T >NUL 2>NUL &",
    "taskkill /F /IM newbrain.exe /T >NUL 2>NUL &",
    "taskkill /F /IM brain-core.exe /T >NUL 2>NUL &",
    "ping -n 2 127.0.0.1 >NUL &",
    "exit /B 0",
  ].join(" ");
  const action = `\n    <CustomAction Id="StopRunningNewbrain" Directory="TARGETDIR" ExeCommand="${escapeXmlAttr(command)}" Execute="immediate" Impersonate="yes" Return="ignore"/>`;
  xml = appendBeforeProductClose(xml, action);
  // Run on every install/upgrade/repair (not pure uninstall). NOT Installed alone
  // misses same-product REINSTALL; UPGRADINGPRODUCTCODE covers MajorUpgrade remove.
  xml = insertInstallExecuteSequenceAction(
    xml,
    '<Custom Action="StopRunningNewbrain" Before="InstallInitialize">NOT REMOVE</Custom>'
  );
  return xml;
}

/**
 * Persist the chosen APPLICATIONFOLDER as user env NEWBRAIN_HOME (and lowercase alias).
 * Uses HKCU\\Environment so per-user MSI installs do not need admin rights.
 * Existing shells/apps only see the new value after relaunch (Explorer broadcast via setx).
 */
function addNewbrainHomeEnvironmentActions(xml) {
  if (xml.includes('Id="SetNewbrainHomeEnv"')) return xml;
  // Trim trailing backslash: setx / REG_SZ paths with trailing \\ can be mis-parsed.
  const setCommand = [
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command",
    "\"$ErrorActionPreference='SilentlyContinue';",
    "$p=[Environment]::ExpandEnvironmentVariables('[APPLICATIONFOLDER]').TrimEnd('\\');",
    "if([string]::IsNullOrWhiteSpace($p)){exit 0};",
    "[Environment]::SetEnvironmentVariable('NEWBRAIN_HOME',$p,'User');",
    "[Environment]::SetEnvironmentVariable('newbrain_home',$p,'User');",
    "exit 0\""
  ].join(" ");
  const clearCommand = [
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command",
    "\"$ErrorActionPreference='SilentlyContinue';",
    "[Environment]::SetEnvironmentVariable('NEWBRAIN_HOME',$null,'User');",
    "[Environment]::SetEnvironmentVariable('newbrain_home',$null,'User');",
    "exit 0\""
  ].join(" ");
  const setAction = `\n    <CustomAction Id="SetNewbrainHomeEnv" Directory="TARGETDIR" ExeCommand="${escapeXmlAttr(setCommand)}" Execute="immediate" Return="ignore"/>`;
  const clearAction = `\n    <CustomAction Id="ClearNewbrainHomeEnv" Directory="TARGETDIR" ExeCommand="${escapeXmlAttr(clearCommand)}" Execute="immediate" Return="ignore"/>`;
  xml = appendBeforeProductClose(xml, `${setAction}${clearAction}`);
  xml = insertInstallExecuteSequenceAction(
    xml,
    '<Custom Action="SetNewbrainHomeEnv" After="InstallFinalize">NOT REMOVE AND (NOT Installed OR REINSTALL)</Custom>'
  );
  xml = insertInstallExecuteSequenceAction(
    xml,
    '<Custom Action="ClearNewbrainHomeEnv" After="RemoveFiles">REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE</Custom>'
  );
  return xml;
}

function addUninstallCleanupAction(xml) {
  if (xml.includes('Id="RemoveNewbrainUserDataOnUninstall"')) return xml;
  const command = "cmd.exe /C rmdir /S /Q [LocalAppDataFolder]..\\..\\.newbrain >NUL 2>NUL & rmdir /S /Q [APPLICATIONFOLDER] >NUL 2>NUL & exit /B 0";
  const action = `\n    <CustomAction Id="RemoveNewbrainUserDataOnUninstall" Directory="TARGETDIR" ExeCommand="${escapeXmlAttr(command)}" Execute="immediate" Return="ignore"/>`;
  xml = appendBeforeProductClose(xml, action);
  xml = insertInstallExecuteSequenceAction(xml, '<Custom Action="RemoveNewbrainUserDataOnUninstall" After="RemoveFiles">REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE</Custom>');
  return xml;
}

function addLaunchAfterInstallAction(xml) {
  if (xml.includes('Id="LaunchNewbrainAfterInstall"')) return xml;
  const command = 'cmd.exe /C if exist "[APPLICATIONFOLDER]NewBrain.exe" start "" /D "[APPLICATIONFOLDER]" "[APPLICATIONFOLDER]NewBrain.exe" & exit /B 0';
  const action = `\n    <CustomAction Id="LaunchNewbrainAfterInstall" Directory="TARGETDIR" ExeCommand="${escapeXmlAttr(command)}" Execute="immediate" Return="asyncNoWait"/>`;
  xml = appendBeforeProductClose(xml, action);
  xml = insertInstallExecuteSequenceAction(xml, '<Custom Action="LaunchNewbrainAfterInstall" After="InstallFinalize">NOT REMOVE AND (NOT Installed OR REINSTALL) AND NOT NEWBRAIN_UPDATE_RUNNER</Custom>');
  return xml;
}

function insertInstallExecuteSequenceAction(xml, actionXml) {
  if (xml.includes(actionXml)) return xml;
  if (xml.includes("</InstallExecuteSequence>")) {
    return xml.replace(/<\/InstallExecuteSequence>/, `    ${actionXml}\n  </InstallExecuteSequence>`);
  }
  return xml.replace(/(<\/Product>)/, `\n  <InstallExecuteSequence>\n    ${actionXml}\n  </InstallExecuteSequence>\n$1`);
}

function assertApplicationFolder(xml, explicitInstallDir) {
  if (explicitInstallDir) {
    const normalizedInstallDir = explicitInstallDir.replace(/\//g, "\\").replace(/\\+$/, "");
    const expectedProperty = `<Property Id="APPLICATIONFOLDER" Value="${escapeXmlAttr(normalizedInstallDir)}"/>`;
    if (!xml.includes(expectedProperty)) {
      throw new Error(`MSI APPLICATIONFOLDER was not set to the requested install dir: ${normalizedInstallDir}`);
    }
    return;
  }

  if (!xml.includes('<Property Id="ApplicationFolderName" Value=".newbrain"/>')) {
    throw new Error('MSI ApplicationFolderName was not rewritten to ".newbrain".');
  }
  if (!xml.includes('<Directory Id="LocalAppDataFolder">') || !xml.includes('<Directory Id="APPLICATIONFOLDER" Name=".newbrain"/>')) {
    throw new Error('MSI APPLICATIONFOLDER was not rewritten under LocalAppDataFolder/.newbrain.');
  }
  if (/<Directory Id="ProgramFiles64Folder">\s*<Directory Id="APPLICATIONFOLDER"/.test(xml)) {
    throw new Error("MSI APPLICATIONFOLDER still points under ProgramFiles64Folder.");
  }
}
