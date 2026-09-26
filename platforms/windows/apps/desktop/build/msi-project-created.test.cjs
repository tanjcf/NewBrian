const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const hook = require('./msi-project-created.cjs').default;

test('upgrades retain the product family, use rollback, and skip user-data cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brain-msi-upgrade-'));
  const file = join(root, 'project.wxs');
  const installDir = process.env.NEWBRAIN_MSI_INSTALL_DIR;
  delete process.env.NEWBRAIN_MSI_INSTALL_DIR;
  try {
    const family = '2D97097C-03A2-54F7-B1D4-7E34233F7A65';
    writeFileSync(file, `<Wix><Product Id="*" UpgradeCode="${family}" Version="1.4.5.0">
    <MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="Newer version installed"/>
    <Property Id="ApplicationFolderName" Value="NewBrain"/>
    <Directory Id="ProgramFiles64Folder"><Directory Id="APPLICATIONFOLDER" Name="NewBrain"/></Directory>
    </Product></Wix>`);
    await hook(file);
    const xml = readFileSync(file, 'utf8');
    assert.ok(xml.includes(`UpgradeCode="${family}"`));
    assert.match(xml, /<MajorUpgrade AllowSameVersionUpgrades="yes" Schedule="afterInstallInitialize"/);
    assert.match(xml, /DowngradeErrorMessage=/);
    assert.doesNotMatch(xml, /DISABLEROLLBACK|CleanNewbrainInstallDir/);
    assert.match(xml, /Action="StopRunningNewbrain" Before="InstallInitialize">NOT REMOVE</);
    assert.match(xml, /taskkill \/F \/IM NewBrain\.exe \/T/);
    assert.match(xml, /taskkill \/F \/IM newbrain\.exe \/T/);
    assert.match(xml, /taskkill \/F \/IM brain-core\.exe \/T/);
    assert.match(xml, /Directory="TARGETDIR"/);
    assert.match(xml, /Action="CreateNewbrainDesktopShortcut" After="InstallFinalize"/);
    assert.match(xml, /Id="CreateNewbrainDesktopShortcut"/);
    assert.match(xml, /Directory="APPLICATIONFOLDER"/);
    assert.match(xml, /Impersonate="yes"/);
    assert.match(xml, /BaseName -ieq 'newbrain'/);
    assert.match(xml, /GetFolderPath\('Desktop'\)/);
    assert.match(xml, /NOT Installed OR REINSTALL OR UPGRADINGPRODUCTCODE/);
    assert.ok(xml.indexOf("CreateNewbrainDesktopShortcut") < xml.lastIndexOf("</Product>"));
    assert.ok(xml.includes("</Product>\n</Wix>") || /<\/Product>\s*<\/Wix>/.test(xml));
    assert.match(xml, /<Property Id="APPLICATIONFOLDER" Secure="yes">/);
    assert.match(xml, /RegistrySearch Id="PreviousNewbrainInstallDirectory" Root="HKCU" Key="Environment" Name="NEWBRAIN_HOME" Type="raw"/);
    for (const action of ['RemoveNewbrainUserDataOnUninstall', 'ClearNewbrainHomeEnv']) {
      assert.ok(xml.includes(`<Custom Action="${action}" After="RemoveFiles">REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE</Custom>`));
    }
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json')));
    assert.equal(pkg.build.msi.upgradeCode, family);
    const locIndex = pkg.build.msi.additionalLightArgs.indexOf('-loc');
    assert.ok(locIndex >= 0, 'MSI linker must load the Chinese-compatible database code page');
    const localization = readFileSync(join(root, pkg.build.msi.additionalLightArgs[locIndex + 1]), 'utf8');
    assert.match(localization, /Codepage="936"/);
    assert.match(localization, /Culture="en-us"/);
    writeFileSync(file, xml.replace(/<MajorUpgrade[^>]*\/>/, ''));
    await assert.rejects(hook(file), /missing MajorUpgrade/);
  } finally {
    if (installDir === undefined) delete process.env.NEWBRAIN_MSI_INSTALL_DIR;
    else process.env.NEWBRAIN_MSI_INSTALL_DIR = installDir;
    rmSync(root, { recursive: true, force: true });
  }
});
