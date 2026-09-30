import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const source = path.resolve(process.argv[2] ?? "");
const macSource = path.join(source, "mac");
const windowsSource = path.join(source, "windows");

const rootFiles = new Set([
  "README.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "tsconfig.base.json", "newbrain.config.json", "newbrain.features.json",
  "newbrain.workspaces.json"
]);
const sourceRootSharedFiles = new Set(["newbrain.bootstrap.json"]);
const allowedTopDirectories = {
  macos: new Set(["apps", "packages"]),
  windows: new Set(["apps", "packages", "docs", "references", "scripts", "skills"])
};
const excludedNames = new Set([
  "node_modules", "out", "release", "dist", ".pnpm-store", ".DS_Store",
  "__pycache__", "integration-artifacts", "sandbox", "config"
]);
const excludedExtensions = new Set([".msi", ".exe", ".dmg", ".zip", ".log", ".pyc"]);

async function assertDirectory(directory) {
  if (!(await stat(directory)).isDirectory()) throw new Error(`Not a directory: ${directory}`);
}

async function collect(base, platform, current = "") {
  const result = new Map();
  for (const entry of await readdir(path.join(base, current), { withFileTypes: true })) {
    if (excludedNames.has(entry.name)) continue;
    const relative = path.join(current, entry.name);
    const top = relative.split(path.sep)[0];
    if (!current && !rootFiles.has(entry.name) && !allowedTopDirectories[platform].has(entry.name)) continue;
    if (entry.isDirectory()) {
      for (const [file, info] of await collect(base, platform, relative)) result.set(file, info);
      continue;
    }
    if (excludedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const normalized = relative.split(path.sep).join("/");
    // Local diagnostic dumps and transient lock copies are not managed source.
    if (/^apps\/desktop\/_[^/]+\.txt(\.err)?$/.test(normalized)) continue;
    if (normalized === "apps/desktop/composer-attachment-errors-test-out.txt") continue;
    if (/^apps\/desktop\/pnpm-lock\.yaml\.\d+$/.test(normalized)) continue;
    if (/\.workspaces\.json\.\d+\./.test(normalized)) continue;
    const absolute = path.join(base, relative);
    const content = await readFile(absolute);
    result.set(normalized, {
      absolute,
      hash: createHash("sha256").update(content).digest("hex")
    });
  }
  return result;
}

if (!process.argv[2]) {
  console.error("Usage: node scripts/import-upstream.mjs <newbrain-source-root>");
  process.exit(1);
}
await Promise.all([assertDirectory(macSource), assertDirectory(windowsSource)]);

const [macFiles, windowsFiles] = await Promise.all([
  collect(macSource, "macos"),
  collect(windowsSource, "windows")
]);
const targets = [
  path.join(root, "shared"),
  path.join(root, "platforms", "macos", "common"),
  path.join(root, "platforms", "windows")
];
await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));

async function copyFile(info, targetRoot, relative) {
  const target = path.join(targetRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(info.absolute, target, { preserveTimestamps: true });
}

const paths = new Set([...macFiles.keys(), ...windowsFiles.keys()]);
let sharedCount = 0;
let macCount = 0;
let windowsCount = 0;
for (const relative of [...paths].sort()) {
  const mac = macFiles.get(relative);
  const windows = windowsFiles.get(relative);
  if (mac && windows && mac.hash === windows.hash) {
    await copyFile(mac, targets[0], relative);
    sharedCount += 1;
  } else {
    if (mac) {
      await copyFile(mac, targets[1], relative);
      macCount += 1;
    }
    if (windows) {
      await copyFile(windows, targets[2], relative);
      windowsCount += 1;
    }
  }
}

for (const relative of sourceRootSharedFiles) {
  const absolute = path.join(source, relative);
  try {
    if (!(await stat(absolute)).isFile()) continue;
    await copyFile({ absolute }, targets[0], relative);
    sharedCount += 1;
  } catch {
    // Optional repository-root resources may not exist in older upstream snapshots.
  }
}

console.log(JSON.stringify({ shared: sharedCount, macos: macCount, windows: windowsCount }, null, 2));
