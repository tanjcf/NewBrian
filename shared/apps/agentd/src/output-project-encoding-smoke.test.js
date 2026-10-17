/**
 * OUTPUT-PROJECT-ENCODING-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * A Mac zip entry whose UTF-8 Chinese name was decoded as CP437 must be
 * restored to the Chinese folder, including the name beside `_MACOSX`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { repairMojibakeTree, repairOutputPath, repairOutputPathSegment, resolveSafeWorkspacePath } from "./workspace-fs.js";

const CHINESE = "\u75c5\u5386\u6a21\u677f\u548c\u8bc4\u4f30\u91cf\u8868";
const CP437_MOJIBAKE = String.fromCodePoint(
  0x03C4, 0x00F9, 0x00E0, 0x03C3, 0x00C4, 0x00E5, 0x00B5, 0x00BF, 0x00ED, 0x00B5, 0x00A5, 0x2510,
  0x03C3, 0x00C6, 0x00EE, 0x03A6, 0x00BB, 0x00E4, 0x03A3, 0x255D, 0x2591, 0x0398, 0x00E7, 0x00C5,
  0x03A6, 0x00ED, 0x00BF
);

test("OUTPUT-PROJECT-ENCODING-SMOKE-001 restores a CP437 Chinese output folder", async () => {
  assert.notEqual(CP437_MOJIBAKE, CHINESE);
  assert.equal(repairOutputPathSegment(CP437_MOJIBAKE), CHINESE);
  assert.equal(repairOutputPathSegment(CHINESE), CHINESE);
  assert.equal(repairOutputPathSegment("backend"), "backend");
  assert.equal(repairOutputPathSegment("_MACOSX"), "_MACOSX");
  assert.equal(repairOutputPath(`${CP437_MOJIBAKE}/note.txt`), `${CHINESE}/note.txt`);
  const command = `New-Item -ItemType Directory -Name '${CP437_MOJIBAKE}'`;
  const repairedCommand = repairOutputPath(command);
  assert.match(repairedCommand, new RegExp(CHINESE));
  assert.equal(repairedCommand.includes(String.fromCodePoint(0x03C4)), false);

  const latin1 = Buffer.from(CHINESE, "utf8").toString("latin1");
  assert.equal(repairOutputPathSegment(latin1), CHINESE);

  const root = mkdtempSync(path.join(tmpdir(), "output-project-encoding-"));
  try {
    const garbled = path.join(root, CP437_MOJIBAKE);
    mkdirSync(garbled);
    writeFileSync(path.join(garbled, "note.txt"), "template", "utf8");
    mkdirSync(path.join(root, "_MACOSX"));
    mkdirSync(path.join(root, "backend"));

    const renamed = await repairMojibakeTree(root);
    assert.equal(renamed, 1);
    const names = (await readdir(root)).sort();
    assert.deepEqual(names, ["_MACOSX", "backend", CHINESE]);
    assert.equal(readFileSync(path.join(root, CHINESE, "note.txt"), "utf8"), "template");

    const resolved = await resolveSafeWorkspacePath(root, `${CP437_MOJIBAKE}/note.txt`);
    assert.equal(resolved.relativePath, `${CHINESE}/note.txt`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OUTPUT-PROJECT-ENCODING-SMOKE-001 merges into an existing Chinese folder", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "output-project-encoding-merge-"));
  try {
    mkdirSync(path.join(root, CHINESE));
    writeFileSync(path.join(root, CHINESE, "kept.txt"), "kept", "utf8");
    mkdirSync(path.join(root, CP437_MOJIBAKE));
    writeFileSync(path.join(root, CP437_MOJIBAKE, "extra.txt"), "extra", "utf8");
    await repairMojibakeTree(root);
    const names = await readdir(root);
    assert.deepEqual(names, [CHINESE]);
    assert.equal(readFileSync(path.join(root, CHINESE, "kept.txt"), "utf8"), "kept");
    assert.equal(readFileSync(path.join(root, CHINESE, "extra.txt"), "utf8"), "extra");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OUTPUT-PROJECT-ENCODING-SMOKE-001 stays on the shell and workspace write paths", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const workspaceFs = readFileSync(path.join(here, "workspace-fs.js"), "utf8");
  const registry = readFileSync(path.join(here, "tool-registry.js"), "utf8");
  const shell = readFileSync(path.join(here, "shell-process-registry.js"), "utf8");
  assert.match(workspaceFs, /const requested = repairOutputPath\(String\(targetPath/);
  assert.match(registry, /repairOutputPath\(process\.platform === "win32"/);
  assert.match(registry, /await repairMojibakeTree\(cwd\)/);
  assert.match(shell, /repairMojibakeTree\(session\.cwd\)/);
});
