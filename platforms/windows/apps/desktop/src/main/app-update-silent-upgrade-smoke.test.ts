/**
 * APP-UPDATE-SILENT-UPGRADE-SMOKE-001
 * Packaging must run this case and stop when it fails.
 *
 * Covers in-app Cockpit-style upgrade contracts:
 * - NSIS --updated /D= without /S (progress bar; avoid real uninstall wipe)
 * - reject Temp\\nsn*\\old-install relaunch; restore if needed
 * - rewrite Desktop shortcuts after install
 * - MSI /passive progress args
 * - skipped version suppresses available until a newer release
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applySkippedVersionToUpdateStatus,
  buildDeferredSilentNsisScript,
  buildSilentDesktopMsiUpgradeArgs,
  resolveDesktopAppUpdateStatus
} from "./desktop-app-update-service.ts";

export const CASE_ID = "APP-UPDATE-SILENT-UPGRADE-SMOKE-001";

function brainSourceRoot() {
  const envRoot = String(process.env.NEWBRAIN_SOURCE_ROOT || "").trim();
  if (envRoot && existsSync(path.join(envRoot, "platforms", "windows"))) return envRoot;
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(current, "platforms", "windows")) && existsSync(path.join(current, "shared"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

test(`${CASE_ID} NSIS deferred script uses --updated with visible progress (no /S)`, () => {
  const script = buildDeferredSilentNsisScript({
    setupPath: "C:\\updates\\NewBrain 1.4.42-setup.exe",
    executablePath: "C:\\Users\\Ada\\AppData\\Local\\.newbrain\\NewBrain.exe",
    processImageName: "NewBrain.exe",
    processId: 4242,
    maxWaitSeconds: 30,
    resultPath: "C:\\updates\\last-nsis-update.json"
  });
  assert.match(script, /Arguments = '--updated \/D=' \+ \$installRoot/);
  assert.doesNotMatch(script, /Arguments = '--updated \/S/);
  assert.match(script, /UseShellExecute = \$true/);
  assert.match(script, /Repair-NewBrainShortcuts/);
  assert.match(script, /Restore-NewBrainFromTempOldInstall/);
  assert.match(script, /Stop-NewBrainOldInstallProcesses/);
  assert.match(script, /old-install/);
  assert.match(script, /ns\[nms\]/);
  assert.match(script, /NewBrain\.exe missing after silent setup/);
  assert.doesNotMatch(script, /cmd\.exe/i);
});

test(`${CASE_ID} MSI upgrade uses /passive progress bar not /qn`, () => {
  const args = buildSilentDesktopMsiUpgradeArgs(
    "C:\\updates\\NewBrain-1.4.42.msi",
    "per-user",
    { applicationFolder: "C:\\Users\\Ada\\AppData\\Local\\.newbrain\\" }
  );
  assert.ok(args.includes("/passive"));
  assert.ok(!args.includes("/qn"));
  assert.ok(args.includes("MSIINSTALLPERUSER=1"));
});

test(`${CASE_ID} skipped version suppresses prompts until a newer release`, () => {
  const available = resolveDesktopAppUpdateStatus({
    currentVersion: "1.4.41",
    release: {
      latest_version: "1.4.42",
      download_url: "https://example.test/NewBrain-1.4.42-setup.exe",
      sha256: "abc"
    }
  });
  assert.equal(available.available, true);
  const skipped = applySkippedVersionToUpdateStatus({ ...available }, "v1.4.42");
  assert.equal(skipped.available, false);
  assert.match(skipped.detail, /已跳过版本/);
  const newer = resolveDesktopAppUpdateStatus({
    currentVersion: "1.4.41",
    release: {
      latest_version: "1.4.43",
      download_url: "https://example.test/NewBrain-1.4.43-setup.exe",
      sha256: "def"
    }
  });
  const stillSkippedOld = applySkippedVersionToUpdateStatus({ ...newer }, "1.4.42");
  assert.equal(stillSkippedOld.available, true);
});

test(`${CASE_ID} installer.nsh kills without cmd flash and rewrites Desktop shortcuts`, () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root required");
  const nshPath = path.join(root, "platforms", "windows", "apps", "desktop", "build", "installer.nsh");
  const text = readFileSync(nshPath, "utf8");
  assert.match(text, /nsExec::ExecToStack 'taskkill \/F \/IM NewBrain\.exe \/T'/);
  assert.doesNotMatch(text, /ExecWait\s+'cmd\.exe/i);
  assert.match(text, /!macro customInstall/);
  assert.match(text, /CreateShortCut "\$DESKTOP\\NewBrain\.lnk"/);
  assert.match(text, /old-install/);
});

test(`${CASE_ID} composition launches PowerShell via wscript to avoid black consoles`, () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root required");
  const composition = readFileSync(
    path.join(root, "platforms", "windows", "apps", "desktop", "src", "main", "desktop-app-update-composition.ts"),
    "utf8"
  );
  assert.match(composition, /wscript\.exe/);
  assert.match(composition, /hidden-ps-/);
  assert.match(composition, /WindowStyle Hidden/);
});
