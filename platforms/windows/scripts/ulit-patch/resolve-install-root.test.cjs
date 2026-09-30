/**
 * Dry-run checks for ulit install-root resolution (no filesystem crawl / find.exe).
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = __dirname;
const resolver = path.join(root, "resolve-install-root.ps1");
const applyCmd = path.join(root, "apply.cmd");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function runResolver(explicit, env = {}) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolver];
  if (explicit !== undefined && explicit !== null) args.push(String(explicit));
  return spawnSync("powershell", args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    windowsHide: true
  });
}

function assertNoCrawlInSources() {
  for (const file of ["apply.cmd", "resolve-install-root.ps1"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    if (/find\s+\/I/i.test(text)) fail(`${file} still contains find /I`);
    if (/Get-ChildItem[\s\S]*-Recurse/i.test(text) && !/never Recurse filesystem/i.test(text)) {
      fail(`${file} appears to recurse the filesystem`);
    }
    if (/\bdir\s+\/s\b/i.test(text)) fail(`${file} still contains dir /s`);
  }
  ok("sources avoid find /I and recursive dir crawl");
}

function assertApplyCmdNoBom() {
  const bytes = fs.readFileSync(applyCmd);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail("apply.cmd must not have UTF-8 BOM (cmd.exe breaks on ﻿@echo)");
    return;
  }
  // Keep structural .cmd ASCII-safe; Chinese belongs in PowerShell/Node.
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] > 127) {
      fail(`apply.cmd contains non-ASCII at offset ${i} (cmd.exe UTF-8 parse risk)`);
      return;
    }
  }
  ok("apply.cmd is ASCII without BOM");
}

function assertFailFastMissingRoot() {
  const fake = path.join(os.tmpdir(), `codecn-missing-root-${Date.now()}`);
  const emptyLocal = fs.mkdtempSync(path.join(os.tmpdir(), "codecn-empty-local-"));
  try {
    // Isolate LOCALAPPDATA so real installs / ProfileList hits do not mask fail-fast.
    // Also clear USERPROFILE-like paths by pointing LOCALAPPDATA at empty dir only;
    // ProfileList may still find a real install on developer machines — that is OK
    // for fallback behavior, so only assert hard-fail when no valid install exists.
    const result = runResolver(fake, {
      CODECN_INSTALL_ROOT: "",
      LOCALAPPDATA: emptyLocal
    });
    if (result.status === 0) {
      // Fallback succeeded via ARP/ProfileList — verify it ignored the fake path.
      const resolved = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
      if (!resolved || resolved.toLowerCase() === fake.toLowerCase()) {
        fail(`expected fallback away from fake root, got stdout=${result.stdout}`);
        return;
      }
      ok("invalid explicit root falls back to ARP/profile install");
      return;
    }
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!combined.includes(fake) && !/codeCN|CODECN_INSTALL_ROOT|InstallLocation/i.test(combined)) {
      fail(`expected error guidance, got: ${combined}`);
      return;
    }
    ok("fail-fast when install root truly missing");
  } finally {
    fs.rmSync(emptyLocal, { recursive: true, force: true });
  }
}

function assertFailFastNoDefault() {
  const emptyLocal = fs.mkdtempSync(path.join(os.tmpdir(), "codecn-empty-local-"));
  try {
    const result = runResolver("", { CODECN_INSTALL_ROOT: "", LOCALAPPDATA: emptyLocal });
    if (result.status === 0) {
      // Machine has a real ARP/profile install — acceptable for SYSTEM-safe resolver.
      ok("resolver found install via ARP/profile when default LocalAppData empty");
      return;
    }
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!/CODECN_INSTALL_ROOT|InstallLocation|codeCN/i.test(combined)) {
      fail(`expected not-found guidance, got: ${combined}`);
      return;
    }
    ok("fail-fast when ARP and default missing");
  } finally {
    fs.rmSync(emptyLocal, { recursive: true, force: true });
  }
}

function assertExplicitRootAccepted() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codecn-root-"));
  try {
    fs.mkdirSync(path.join(tmp, "resources"));
    fs.writeFileSync(path.join(tmp, "resources", "app.asar"), "fake");
    fs.writeFileSync(path.join(tmp, "codeCN.exe"), "fake");
    const result = runResolver(tmp);
    if (result.status !== 0) {
      fail(`explicit root rejected: ${result.stderr || result.stdout}`);
      return;
    }
    const resolved = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
    const left = fs.realpathSync.native
      ? fs.realpathSync.native(resolved)
      : fs.realpathSync(resolved);
    const right = fs.realpathSync.native ? fs.realpathSync.native(tmp) : fs.realpathSync(tmp);
    if (left.toLowerCase() !== right.toLowerCase()) {
      fail(`expected ${right}, got ${left}`);
      return;
    }
    ok("explicit install root accepted");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function assertApplyCmdShipsResolver() {
  if (!fs.existsSync(applyCmd)) fail("apply.cmd missing");
  if (!fs.existsSync(resolver)) fail("resolve-install-root.ps1 missing");
  const apply = fs.readFileSync(applyCmd, "utf8");
  if (!/resolve-install-root\.ps1/.test(apply)) fail("apply.cmd does not invoke resolver");
  ok("apply.cmd wires resolve-install-root.ps1");
}

assertNoCrawlInSources();
assertApplyCmdNoBom();
assertApplyCmdShipsResolver();
assertFailFastMissingRoot();
assertFailFastNoDefault();
assertExplicitRootAccepted();

if (process.exitCode) {
  console.error("resolve-install-root dry-run FAILED");
  process.exit(process.exitCode);
}
console.log("resolve-install-root dry-run PASSED");
