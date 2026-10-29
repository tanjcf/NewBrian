import assert from "node:assert/strict";
import test from "node:test";
import {
  isTempNsisOldInstallPath,
  resolveCanonicalNewBrainExecutable
} from "./desktop-install-path.ts";

test("detects electron-builder nsn/nsm/nss old-install temp trees", () => {
  assert.equal(
    isTempNsisOldInstallPath(
      "C:\\Users\\Ada\\AppData\\Local\\Temp\\nsmEAB5.tmp\\old-install\\NewBrain.exe"
    ),
    true
  );
  assert.equal(
    isTempNsisOldInstallPath(
      "C:\\Users\\Ada\\AppData\\Local\\Temp\\nsn1234.tmp\\old-install\\NewBrain.exe"
    ),
    true
  );
  assert.equal(
    isTempNsisOldInstallPath("C:\\Users\\Ada\\AppData\\Local\\.newbrain\\NewBrain.exe"),
    false
  );
});

test("canonical exe prefers Local\\.newbrain over Temp old-install", () => {
  const local = process.env.LOCALAPPDATA || "";
  if (!local) return;
  const resolved = resolveCanonicalNewBrainExecutable({
    execPath: `${local}\\Temp\\nsmEAB5.tmp\\old-install\\NewBrain.exe`,
    localAppData: local
  });
  // When the real install exists on this machine, it must win.
  if (resolved) {
    assert.equal(isTempNsisOldInstallPath(resolved), false);
    assert.match(resolved.replace(/\//g, "\\"), /\\.newbrain\\NewBrain\.exe$/i);
  }
});
