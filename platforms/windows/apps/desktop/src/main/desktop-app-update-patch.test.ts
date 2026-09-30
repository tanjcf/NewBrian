import assert from "node:assert/strict";
import test from "node:test";

const {
  buildDeferredProcessExitWaitPowerShell,
  buildDeferredUlitZipApplyScript,
  normalizeDesktopUpdateVersionLabel,
  resolveDesktopUpdatePackageKind,
  safeDesktopUpdateFileName
} = await import(new URL("./desktop-app-update-patch.ts", import.meta.url).href);

test("normalizes confusing admin version labels like 1.2.9.ulit", () => {
  assert.equal(normalizeDesktopUpdateVersionLabel("1.2.9.ulit"), "1.2.9");
  assert.equal(normalizeDesktopUpdateVersionLabel("v1.2.9-ulit"), "1.2.9");
  assert.equal(normalizeDesktopUpdateVersionLabel("1.2.9ulit"), "1.2.9");
});

test("resolves ulit zip/msi package kinds from metadata and filenames", () => {
  assert.equal(
    resolveDesktopUpdatePackageKind({ downloadUrl: "https://cdn/1.2.8ulit.zip" }),
    "ulit-zip"
  );
  assert.equal(
    resolveDesktopUpdatePackageKind({ packageKind: "patch", downloadUrl: "https://cdn/x.zip" }),
    "ulit-zip"
  );
  assert.equal(
    resolveDesktopUpdatePackageKind({ downloadUrl: "https://cdn/1.2.8ulit.msi" }),
    "ulit-msi"
  );
  assert.equal(
    resolveDesktopUpdatePackageKind({ downloadUrl: "https://cdn/NewBrain-1.2.8.msi" }),
    "full-msi"
  );
  assert.equal(
    resolveDesktopUpdatePackageKind({ downloadUrl: "https://cdn/NewBrain%201.4.10-setup.exe" }),
    "full-nsis"
  );
  assert.equal(
    resolveDesktopUpdatePackageKind({ packageKind: "nsis", downloadUrl: "https://cdn/api/releases/x/download" }),
    "full-nsis"
  );
  assert.equal(
    resolveDesktopUpdatePackageKind({
      version: "1.2.9.ulit",
      packageKind: "patch",
      downloadUrl: "https://cdn/api/releases/abc/download"
    }),
    "ulit-msi"
  );
  assert.equal(
    resolveDesktopUpdatePackageKind({
      version: "1.2.9",
      downloadUrl: "https://cdn/files/1.2.9ulit.msi?token=1"
    }),
    "ulit-msi"
  );
  assert.equal(
    resolveDesktopUpdatePackageKind({
      packageKind: "full",
      localPath: "C:\\updates\\1.2.9ulit.msi"
    }),
    "ulit-msi"
  );
});

test("names local download artifacts for ulit packages without double ulit", () => {
  assert.equal(
    safeDesktopUpdateFileName({
      version: "1.4.10",
      downloadUrl: "https://cdn/NewBrain 1.4.10-setup.exe"
    }),
    "NewBrain 1.4.10-setup.exe"
  );
  assert.equal(
    safeDesktopUpdateFileName({
      version: "1.2.8",
      downloadUrl: "https://cdn/1.2.8ulit.zip"
    }),
    "1.2.8ulit.zip"
  );
  assert.equal(
    safeDesktopUpdateFileName({
      version: "1.2.8",
      downloadUrl: "https://cdn/1.2.8ulit.msi"
    }),
    "1.2.8ulit.msi"
  );
  assert.equal(
    safeDesktopUpdateFileName({
      version: "1.2.9.ulit",
      packageKind: "patch",
      downloadUrl: "https://cdn/1.2.9ulit.msi"
    }),
    "1.2.9ulit.msi"
  );
});

test("deferred wait uses hidden Get-Process and never find /I", () => {
  const wait = buildDeferredProcessExitWaitPowerShell({
    processImageName: "NewBrain.exe",
    maxWaitSeconds: 30,
    forceKillOnTimeout: false
  });
  assert.match(wait, /Get-Process -Name \$name/);
  assert.match(wait, /WindowStyle Hidden/);
  assert.match(wait, /等待 NewBrain 退出超时/);
  assert.doesNotMatch(wait, /find \/I/i);
  assert.doesNotMatch(wait, /tasklist/i);

  const forceWait = buildDeferredProcessExitWaitPowerShell({
    processImageName: "NewBrain.exe",
    processId: 4242,
    maxWaitSeconds: 30
  });
  assert.match(forceWait, /WaitForExit\(30000\)/);
  assert.match(forceWait, /Stop-Process -Id 4242/);
  assert.doesNotMatch(forceWait, /find \/I/i);

  const script = buildDeferredUlitZipApplyScript({
    zipPath: "C:\\updates\\1.2.8ulit.zip",
    installRoot: "C:\\Users\\Ada\\AppData\\Local\\.newbrain",
    stagingDir: "C:\\updates\\ulit-stage"
  });
  assert.match(script, /Expand-Archive/);
  assert.match(script, /apply\.cmd/);
  assert.match(script, /Get-Process -Name/);
  assert.doesNotMatch(script, /find \/I/i);
  assert.match(script, /Local\\.newbrain/);
  assert.match(script, /title NewBrain update/);
});
