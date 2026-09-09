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

function stabilizeApplicationShortcuts(xml) {
  return xml.replace(
    /(<Shortcut Id="(?:desktopShortcut|startMenuShortcut)")([^>]*?)\sAdvertise="yes"/g,
    '$1$2 Advertise="no"'
  );
}

function addStopRunningApplicationAction(xml) {
  if (xml.includes('Id="StopRunningNewbrain"')) return xml;
  const command = "cmd.exe /C taskkill /IM NewBrain.exe /T /F >NUL 2>NUL & exit /B 0";
  const action = `\n    <CustomAction Id="StopRunningNewbrain" Directory="TARGETDIR" ExeCommand="${escapeXmlAttr(command)}" Execute="immediate" Return="ignore"/>`;
  xml = xml.replace(/(<\/Product>)/, `${action}\n$1`);
  xml = insertInstallExecuteSequenceAction(xml, '<Custom Action="StopRunningNewbrain" Before="InstallInitialize">NOT REMOVE AND (NOT Installed OR REINSTALL)</Custom>');
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
  xml = xml.replace(/(<\/Product>)/, `${setAction}${clearAction}\n$1`);
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
  xml = xml.replace(/(<\/Product>)/, `${action}\n$1`);
  xml = insertInstallExecuteSequenceAction(xml, '<Custom Action="RemoveNewbrainUserDataOnUninstall" After="RemoveFiles">REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE</Custom>');
  return xml;
}

function addLaunchAfterInstallAction(xml) {
  if (xml.includes('Id="LaunchNewbrainAfterInstall"')) return xml;
  const command = 'cmd.exe /C if exist "[APPLICATIONFOLDER]NewBrain.exe" start "" /D "[APPLICATIONFOLDER]" "[APPLICATIONFOLDER]NewBrain.exe" & exit /B 0';
  const action = `\n    <CustomAction Id="LaunchNewbrainAfterInstall" Directory="TARGETDIR" ExeCommand="${escapeXmlAttr(command)}" Execute="immediate" Return="asyncNoWait"/>`;
  xml = xml.replace(/(<\/Product>)/, `${action}\n$1`);
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
