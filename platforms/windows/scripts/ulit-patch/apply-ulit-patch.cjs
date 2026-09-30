#!/usr/bin/env node
/**
 * Apply a codeCN ulit patch (codecn-ulit-patch-v1) onto an installed app.asar.
 *
 * Preferred payload: binary bsdiff of resources/app.asar (tiny).
 * Fallback payload: overlay/ tree + tools/asar (extract → merge → repack).
 *
 * Usage:
 *   set ELECTRON_RUN_AS_NODE=1
 *   set ELECTRON_NO_ASAR=1
 *   "%INSTALL_ROOT%\codecn.exe" "%PATCH_ROOT%\apply-ulit-patch.cjs" --install-root "%INSTALL_ROOT%"
 *   node apply-ulit-patch.cjs --install-root "C:\\Users\\...\\AppData\\Local\\.codecn"
 */
"use strict";

// Electron-as-Node intercepts paths containing ".asar" unless disabled.
process.noAsar = true;
process.env.ELECTRON_NO_ASAR = "1";

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

function parseArgs(argv) {
  const out = { installRoot: "", patchRoot: "", force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--install-root" && argv[i + 1]) out.installRoot = argv[++i];
    else if (arg === "--patch-root" && argv[i + 1]) out.patchRoot = argv[++i];
    else if (arg === "--force") out.force = true;
  }
  return out;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let read;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function defaultInstallRoot() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, ".codecn");
}

function findBspatch(patchRoot) {
  const candidates = [
    path.join(patchRoot, "tools", "bspatch.exe"),
    path.join(patchRoot, "bspatch.exe"),
    path.join(__dirname, "tools", "bspatch.exe")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

function replaceAsarAtomically(asarPath, newAsar) {
  const backup = `${asarPath}.pre-ulit`;
  if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
  fs.renameSync(asarPath, backup);
  try {
    fs.renameSync(newAsar, asarPath);
  } catch (error) {
    try {
      if (fs.existsSync(backup)) fs.renameSync(backup, asarPath);
    } catch {
      // keep backup for manual recovery
    }
    const detail = error && error.message ? error.message : String(error);
    throw new Error(
      `无法替换 app.asar（文件可能被占用）。请完全退出 codeCN（含托盘）后重试。原始错误：${detail}`
    );
  }
  fs.rmSync(backup, { force: true });
}

function applyBsdiff(input) {
  const { asarPath, patchFile, bspatch, targetHash } = input;
  // Keep the patched file on the same volume as app.asar so replace is atomic-ish.
  const newAsar = `${asarPath}.new`;
  if (fs.existsSync(newAsar)) fs.rmSync(newAsar, { force: true });

  const result = spawnSync(bspatch, [asarPath, newAsar, patchFile], {
    windowsHide: true,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    if (fs.existsSync(newAsar)) fs.rmSync(newAsar, { force: true });
    throw new Error(
      `bspatch failed (exit ${result.status}): ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  if (!fs.existsSync(newAsar)) {
    throw new Error("bspatch did not produce output asar");
  }
  const newHash = sha256File(newAsar);
  if (targetHash && newHash !== targetHash) {
    fs.rmSync(newAsar, { force: true });
    throw new Error(`Patched asar hash mismatch: got ${newHash}, expected ${targetHash}`);
  }

  replaceAsarAtomically(asarPath, newAsar);
  return newHash;
}

function loadAsarModule(patchRoot) {
  const toolsDir = path.join(patchRoot, "tools");
  const toolsNodeModules = path.join(toolsDir, "node_modules");
  if (fs.existsSync(toolsNodeModules)) {
    const Module = require("module");
    process.env.NODE_PATH = [toolsNodeModules, process.env.NODE_PATH || ""]
      .filter(Boolean)
      .join(path.delimiter);
    Module._initPaths();
  }
  const candidates = [
    path.join(toolsDir, "electron-asar", "lib", "asar.js"),
    path.join(toolsDir, "asar", "lib", "asar.js"),
    path.join(__dirname, "tools", "electron-asar", "lib", "asar.js")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(candidate);
    }
  }
  throw new Error("Missing tools/electron-asar for overlay patch apply.");
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function stripUnpackedDuplicates(extractedRoot, asarPath) {
  // extractAll materializes app.asar.unpacked link targets into the tree.
  // Remove them before repack so natives stay outside asar (same as electron-builder).
  const unpackedRoot = path.join(path.dirname(asarPath), "app.asar.unpacked");
  if (!fs.existsSync(unpackedRoot)) return;
  const unpackedNm = path.join(unpackedRoot, "node_modules");
  const extractedNm = path.join(extractedRoot, "node_modules");
  if (!fs.existsSync(unpackedNm) || !fs.existsSync(extractedNm)) return;
  for (const entry of fs.readdirSync(unpackedNm)) {
    const target = path.join(extractedNm, entry);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
}

function applyOverlay(input) {
  const { asarPath, overlayRoot, removePaths, targetHash, patchRoot } = input;
  const asar = loadAsarModule(patchRoot);
  const packer = path.join(patchRoot, "tools", "pack-asar.cjs");
  if (!fs.existsSync(packer)) {
    throw new Error("Missing tools/pack-asar.cjs");
  }
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "codecn-ulit-overlay-"));
  const extracted = path.join(stage, "extracted");
  const newAsar = `${asarPath}.new`;
  try {
    fs.mkdirSync(extracted, { recursive: true });
    asar.extractAll(asarPath, extracted);
    stripUnpackedDuplicates(extracted, asarPath);
    for (const rel of removePaths || []) {
      const cleaned = String(rel || "").replace(/^[/\\]+/, "");
      if (!cleaned || cleaned.includes("..")) continue;
      const target = path.join(extracted, cleaned);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    }
    copyDirRecursive(overlayRoot, extracted);
    if (fs.existsSync(newAsar)) fs.rmSync(newAsar, { force: true });
    const result = spawnSync(process.execPath, [packer, extracted, newAsar], {
      windowsHide: true,
      encoding: "utf8",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        ELECTRON_NO_ASAR: "1",
        NODE_PATH: path.join(patchRoot, "tools", "node_modules")
      }
    });
    if (result.status !== 0) {
      throw new Error(
        `asar pack failed (exit ${result.status}): ${(result.stderr || result.stdout || "").trim()}`
      );
    }
    if (!fs.existsSync(newAsar)) {
      throw new Error("asar pack did not produce output");
    }
    const newHash = sha256File(newAsar);
    if (targetHash && newHash !== targetHash) {
      fs.rmSync(newAsar, { force: true });
      throw new Error(`Patched asar hash mismatch: got ${newHash}, expected ${targetHash}`);
    }
    replaceAsarAtomically(asarPath, newAsar);
    return newHash;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const patchRoot = path.resolve(args.patchRoot || __dirname);
  const installRoot = path.resolve(
    args.installRoot
      || process.env.CODECN_INSTALL_ROOT
      || process.env.CODECN_HOME
      || process.env.codecn_home
      || defaultInstallRoot()
  );
  const manifestPath = path.join(patchRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json in ${patchRoot}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.format !== "codecn-ulit-patch-v1") {
    throw new Error(`Unsupported patch format: ${manifest.format}`);
  }

  const asarPath = path.join(installRoot, "resources", "app.asar");
  if (!fs.existsSync(asarPath)) {
    throw new Error(`Installed app.asar not found: ${asarPath}`);
  }

  const targetHash = String(manifest.targetAsarSha256 || "").toLowerCase();
  const baseHash = String(manifest.baseAsarSha256 || "").toLowerCase();
  const currentHash = sha256File(asarPath);
  if (targetHash && currentHash === targetHash) {
    console.log(`Already at target asar (${manifest.targetVersion}). Nothing to do.`);
    return;
  }
  if (!args.force && baseHash && currentHash !== baseHash) {
    throw new Error(
      `拒绝应用补丁：当前 app.asar 校验和 ${currentHash} 与补丁要求的基准 ${baseHash} 不一致。` +
        `请确认本机已安装基准版本 ${manifest.baseVersion}（不要用针对其他版本的 ulit 包）。`
    );
  }

  const overlayRoot = path.join(patchRoot, "overlay");
  const hasOverlay = fs.existsSync(overlayRoot) && fs.statSync(overlayRoot).isDirectory();
  let newHash = "";
  if (hasOverlay) {
    console.log(`Applying asar overlay onto ${asarPath}`);
    newHash = applyOverlay({
      asarPath,
      overlayRoot,
      removePaths: Array.isArray(manifest.removePaths) ? manifest.removePaths : [],
      targetHash,
      patchRoot
    });
  } else {
    const bsdiffName = String(manifest.bsdiffFile || "app.asar.bsdiff");
    const bsdiffPath = path.join(patchRoot, bsdiffName);
    if (!fs.existsSync(bsdiffPath)) {
      throw new Error(`Missing bsdiff payload: ${bsdiffPath}`);
    }
    const bspatch = findBspatch(patchRoot);
    if (!bspatch) {
      throw new Error("Missing tools/bspatch.exe in the ulit patch package.");
    }
    console.log(`Applying ${bsdiffName} onto ${asarPath}`);
    newHash = applyBsdiff({
      asarPath,
      patchFile: bsdiffPath,
      bspatch,
      targetHash
    });
  }
  console.log(`Patched ${installRoot} -> ${manifest.targetVersion} (asar ${newHash})`);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
