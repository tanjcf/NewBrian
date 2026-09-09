import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const {
  MAC_ASAR_HOTFIX_FORMAT,
  applyMacAsarHotfix,
  createMacAsarHotfixArchive,
  parseMacAsarHotfixManifest,
  resolveUpdatePackageKind
} = await import(new URL("./desktop-app-asar-hotfix.ts", import.meta.url).href);

test("detects hotfix package kind from payload and URL", () => {
  assert.equal(resolveUpdatePackageKind({ package_kind: "hotfix" }, "https://x/a.zip"), "hotfix");
  assert.equal(resolveUpdatePackageKind({}, "https://cdn/NewBrain-0.1.66-arm64.hotfix.zip"), "hotfix");
  assert.equal(resolveUpdatePackageKind({ package_kind: "full" }, "https://cdn/a.hotfix.zip"), "full");
  assert.equal(resolveUpdatePackageKind({}, "https://cdn/NewBrain.dmg"), "full");
});

test("parses and rejects invalid hotfix manifests", () => {
  assert.equal(parseMacAsarHotfixManifest(null), null);
  const valid = {
    format: MAC_ASAR_HOTFIX_FORMAT,
    platform: "darwin",
    arch: "arm64",
    version: "0.1.66",
    minVersion: "0.1.65",
    appId: "cn.newbrain.mac.desktop",
    files: [{ path: "Resources/app.asar", sha256: "abc", size: 1 }],
    asarIntegrity: { "Resources/app.asar": { algorithm: "SHA256", hash: "abc" } }
  };
  assert.equal(parseMacAsarHotfixManifest(valid)?.version, "0.1.66");
  assert.equal(parseMacAsarHotfixManifest({
    ...valid,
    files: [{ path: "../evil", sha256: "abc", size: 1 }]
  }), null);
});

test("creates and applies an asar hotfix zip into a fake app bundle", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS only");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "newbrain-hotfix-test-"));
  const resources = join(root, "Contents", "Resources");
  const infoPlist = join(root, "Contents", "Info.plist");
  mkdirSync(resources, { recursive: true });
  const asarBytes = Buffer.from("fake-asar-payload-v2");
  writeFileSync(join(resources, "app.asar"), Buffer.from("fake-asar-payload-v1"));
  writeFileSync(infoPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>0.1.65</string>
  <key>CFBundleVersion</key><string>0.1.65</string>
  <key>ElectronAsarIntegrity</key>
  <dict>
    <key>Resources/app.asar</key>
    <dict>
      <key>algorithm</key><string>SHA256</string>
      <key>hash</key><string>${createHash("sha256").update("fake-asar-payload-v1").digest("hex")}</string>
    </dict>
  </dict>
</dict></plist>
`);

  const sourceResources = join(root, "source-resources");
  mkdirSync(sourceResources, { recursive: true });
  writeFileSync(join(sourceResources, "app.asar"), asarBytes);

  const archivePath = join(root, "patch.hotfix.zip");
  const built = createMacAsarHotfixArchive({
    appResourcesPath: sourceResources,
    outputPath: archivePath,
    version: "0.1.66",
    minVersion: "0.1.65",
    appId: "cn.newbrain.mac.desktop",
    arch: process.arch,
    notes: "test hotfix"
  });
  assert.equal(built.manifest.files[0]?.path, "Resources/app.asar");

  const applied = await applyMacAsarHotfix({
    archivePath,
    resourcesPath: resources,
    infoPlistPath: infoPlist,
    currentVersion: "0.1.65",
    currentAppId: "cn.newbrain.mac.desktop",
    expectedArch: process.arch
  });
  assert.equal(applied.ok, true, applied.detail);
  assert.equal(readFileSync(join(resources, "app.asar")).toString(), "fake-asar-payload-v2");

  const plist = spawnSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", infoPlist], { encoding: "utf8" });
  assert.equal(String(plist.stdout || "").trim(), "0.1.66");
  const hash = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :ElectronAsarIntegrity:Resources/app.asar:hash", infoPlist], {
    encoding: "utf8"
  });
  assert.equal(String(hash.stdout || "").trim(), createHash("sha256").update(asarBytes).digest("hex"));

  rmSync(root, { recursive: true, force: true });
});

test("refuses hotfix when current version is already newer", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS only");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "newbrain-hotfix-refuse-"));
  const resources = join(root, "Contents", "Resources");
  const infoPlist = join(root, "Contents", "Info.plist");
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(resources, "app.asar"), Buffer.from("current"));
  writeFileSync(infoPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>0.1.66</string>
  <key>CFBundleVersion</key><string>0.1.66</string>
</dict></plist>`);
  const sourceResources = join(root, "source");
  mkdirSync(sourceResources, { recursive: true });
  writeFileSync(join(sourceResources, "app.asar"), Buffer.from("next"));
  const archivePath = join(root, "a.hotfix.zip");
  createMacAsarHotfixArchive({
    appResourcesPath: sourceResources,
    outputPath: archivePath,
    version: "0.1.66",
    minVersion: "0.1.65",
    appId: "cn.newbrain.mac.desktop",
    arch: process.arch
  });
  const applied = await applyMacAsarHotfix({
    archivePath,
    resourcesPath: resources,
    infoPlistPath: infoPlist,
    currentVersion: "0.1.66",
    currentAppId: "cn.newbrain.mac.desktop",
    expectedArch: process.arch
  });
  assert.equal(applied.ok, false);
  assert.match(applied.detail, /已不低于/);
  rmSync(root, { recursive: true, force: true });
});
