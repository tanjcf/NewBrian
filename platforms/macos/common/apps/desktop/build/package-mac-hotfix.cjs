#!/usr/bin/env node
/**
 * Build a Mac asar hotfix zip (not a full DMG/ZIP installer).
 *
 * Output:
 *   release/codeCN Mac-<version>-arm64|intel.hotfix.zip
 *   release/mac-hotfix-manifest-<version>-arm64|intel.json
 *   release/SHA256SUMS-hotfix-<version>-arm64|intel.txt
 */
const { createHash } = require("node:crypto");
const { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const FORMAT = "codecn-mac-asar-hotfix/v1";
const desktopRoot = resolve(__dirname, "..");
const desktopPackage = require(join(desktopRoot, "package.json"));
const releaseDir = join(desktopRoot, "release");
const appResources = join(releaseDir, "mac-arm64", "codecn-mac.app", "Contents", "Resources");
const version = desktopPackage.version;
const arch = process.arch;
const archLabel = arch === "x64" ? "intel" : arch;
const productName = desktopPackage.build?.productName || "codeCN Mac";
const appId = desktopPackage.build?.appId || "cn.codecn.mac.desktop";
const minVersion = process.env.CODECN_HOTFIX_MIN_VERSION?.trim() || previousPatchVersion(version);
const extra = String(process.env.CODECN_HOTFIX_EXTRA_RESOURCES || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function previousPatchVersion(value) {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return "0.0.0";
  const next = [...parts];
  next[2] = Math.max(0, next[2] - 1);
  return next.join(".");
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: desktopRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensurePackagedApp() {
  if (existsSync(join(appResources, "app.asar"))) return;
  console.log("Packaged app.asar missing; running package:mac:dir first...");
  run(process.execPath, [join(__dirname, "package-mac.cjs"), "dir"]);
  if (!existsSync(join(appResources, "app.asar"))) {
    throw new Error(`Still missing ${join(appResources, "app.asar")}`);
  }
}

ensurePackagedApp();

const staging = join(tmpdir(), `codecn-hotfix-stage-${Date.now()}`);
const resourcesStaging = join(staging, "Resources");
mkdirSync(resourcesStaging, { recursive: true });

const resourceNames = ["app.asar", ...extra];
const files = [];
for (const name of resourceNames) {
  const source = join(appResources, name);
  if (!existsSync(source)) throw new Error(`Missing resource for hotfix: ${name}`);
  const destination = join(resourcesStaging, name);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  const bytes = readFileSync(destination);
  files.push({
    path: `Resources/${name.replace(/\\/g, "/")}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength
  });
}

const asarEntry = files.find((file) => file.path === "Resources/app.asar");
if (!asarEntry) throw new Error("Hotfix requires Resources/app.asar");

const notes = process.env.CODECN_HOTFIX_NOTES?.trim() || `codeCN Mac ${version} asar hotfix`;
const hotfixManifest = {
  format: FORMAT,
  platform: "darwin",
  arch,
  version,
  minVersion,
  appId,
  notes,
  files,
  asarIntegrity: {
    "Resources/app.asar": {
      algorithm: "SHA256",
      hash: asarEntry.sha256
    }
  }
};
writeFileSync(join(staging, "hotfix-manifest.json"), `${JSON.stringify(hotfixManifest, null, 2)}\n`);

mkdirSync(releaseDir, { recursive: true });
const outputName = `${productName}-${version}-${archLabel}.hotfix.zip`;
const outputPath = join(releaseDir, outputName);
rmSync(outputPath, { force: true });
const zip = spawnSync("bash", ["-lc", `cd ${JSON.stringify(staging)} && zip -qry ${JSON.stringify(outputPath)} .`], {
  encoding: "utf8"
});
rmSync(staging, { recursive: true, force: true });
if (zip.status !== 0 || !existsSync(outputPath)) {
  throw new Error(zip.stderr || "Failed to create hotfix zip");
}

const digest = sha256File(outputPath);
const size = readFileSync(outputPath).byteLength;
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: desktopRoot, encoding: "utf8" });
const publishManifest = {
  platform: "darwin",
  arch,
  arch_label: archLabel,
  version,
  min_version: minVersion,
  package_kind: "hotfix",
  productName,
  path: outputName,
  size,
  sha256: digest,
  signature: "NotSigned",
  built_at: new Date().toISOString(),
  commit: commit.status === 0 ? String(commit.stdout || "").trim() : "",
  notes,
  latest_version: version,
  download_url: "",
  channel: process.env.CODECN_HOTFIX_CHANNEL?.trim() || "canary",
  mandatory: false,
  format: FORMAT,
  minimum_system_version: "11.0"
};

writeFileSync(join(releaseDir, `mac-hotfix-manifest-${version}-${archLabel}.json`), `${JSON.stringify(publishManifest, null, 2)}\n`);
writeFileSync(join(releaseDir, `SHA256SUMS-hotfix-${version}-${archLabel}.txt`), `${digest}  ${outputName}\n`);

console.log(`Wrote hotfix: ${outputPath}`);
console.log(`sha256: ${digest}`);
console.log(`size: ${size}`);
console.log(`minVersion: ${minVersion}`);
console.log(`arch_label: ${archLabel}`);
console.log(`manifest: mac-hotfix-manifest-${version}-${archLabel}.json`);
