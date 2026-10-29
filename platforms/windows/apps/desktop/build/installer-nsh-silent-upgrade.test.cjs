/**
 * NSIS-SILENT-UPGRADE-SMOKE-001
 * Packaging must run this case and stop when it fails.
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const CASE_ID = "NSIS-SILENT-UPGRADE-SMOKE-001";

test(`${CASE_ID} installer.nsh kills NewBrain without cmd.exe console flash`, () => {
  const text = readFileSync(join(__dirname, "installer.nsh"), "utf8");
  assert.match(text, /nsExec::ExecToStack 'taskkill \/F \/IM NewBrain\.exe \/T'/);
  assert.match(text, /nsExec::ExecToStack 'taskkill \/F \/IM brain-core\.exe \/T'/);
  assert.doesNotMatch(text, /ExecWait\s+'cmd\.exe/i);
  assert.match(text, /\$LOCALAPPDATA\\.newbrain/);
  assert.match(text, /silentKillNewBrainProcesses/);
});

test(`${CASE_ID} installer.nsh rewrites Desktop shortcuts away from Temp old-install`, () => {
  const text = readFileSync(join(__dirname, "installer.nsh"), "utf8");
  assert.match(text, /!macro customInstall/);
  assert.match(text, /CreateShortCut "\$DESKTOP\\NewBrain\.lnk"/);
  assert.match(text, /CreateShortCut "\$SMPROGRAMS\\NewBrain\.lnk"/);
  assert.match(text, /old-install/);
});
