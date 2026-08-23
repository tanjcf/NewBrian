import { cp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const requestedTarget = process.argv[2];
const aliases = new Map([
  ["macos", process.arch === "x64" ? "macos-x64" : "macos-arm64"]
]);
const target = aliases.get(requestedTarget) ?? requestedTarget;
const targetLayers = {
  "macos-arm64": ["platforms/macos/common", "platforms/macos/arm64"],
  "macos-x64": ["platforms/macos/common", "platforms/macos/x64"],
  "ubuntu-arm64": ["platforms/ubuntu/common", "platforms/ubuntu/arm64"],
  "ubuntu-x64": ["platforms/ubuntu/common", "platforms/ubuntu/x64"],
  windows: ["platforms/windows"]
};

if (!Object.hasOwn(targetLayers, target)) {
  console.error("Usage: node scripts/materialize.mjs <macos-arm64|macos-x64|ubuntu-arm64|ubuntu-x64|windows>");
  process.exit(1);
}

const shared = path.join(root, "shared");
const rust = path.join(root, "rust");
const overlayPaths = targetLayers[target].map((layer) => path.join(root, layer));
const outputRoot = path.join(root, ".materialized");
const output = path.join(outputRoot, target);
const temporary = path.join(outputRoot, `.${target}-${process.pid}`);
const ignoredDirectoryNames = new Set(["node_modules", "release", "tmp"]);

function includeManagedSource(source) {
  return !source.split(path.sep).some((segment) => ignoredDirectoryNames.has(segment));
}

for (const required of [shared, rust, ...overlayPaths]) {
  try {
    if (!(await stat(required)).isDirectory()) throw new Error();
  } catch {
    console.error(`Missing source layer: ${path.relative(root, required)}`);
    process.exit(1);
  }
}

await mkdir(outputRoot, { recursive: true });
await rm(temporary, { recursive: true, force: true });
await cp(shared, temporary, { recursive: true, force: true, filter: includeManagedSource });
await cp(rust, path.join(temporary, "rust"), { recursive: true, force: true, filter: includeManagedSource });
for (const configName of ["codecn.bootstrap.json", "codecn.config.json", "codecn.features.json", "codecn.workspaces.json"]) {
  const candidates = [path.join(root, configName), path.join(shared, configName)];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (source) await cp(source, path.join(temporary, configName), { force: true });
}
for (const overlay of overlayPaths) {
  await cp(overlay, temporary, { recursive: true, force: true, filter: includeManagedSource });
}

const metadata = {
  target,
  platform: target.startsWith("macos-") ? "macos" : target.startsWith("ubuntu-") ? "ubuntu" : target,
  arch: target.endsWith("-arm64") ? "arm64" : target.endsWith("-x64") ? "x64" : null,
  generatedAt: new Date().toISOString(),
  sourceLayers: ["shared", ...targetLayers[target]]
};
await writeFile(path.join(temporary, ".codecn-source.json"), `${JSON.stringify(metadata, null, 2)}\n`);

async function publishMaterializedTree() {
  try {
    await rm(output, { recursive: true, force: true });
    await rename(temporary, output);
    return "replace";
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
    // Windows may lock .materialized/<target>/apps/desktop while Electron/Cursor holds handles.
    // Fall back to in-place overwrite so agents can keep iterating without killing the IDE/app.
    await cp(temporary, output, { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
    return "inplace";
  }
}

const publishMode = await publishMaterializedTree();
console.log(`${output} (${publishMode})`);

