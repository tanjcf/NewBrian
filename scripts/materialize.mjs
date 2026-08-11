import { cp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
const overlayPaths = targetLayers[target].map((layer) => path.join(root, layer));
const outputRoot = path.join(root, ".materialized");
const output = path.join(outputRoot, target);
const temporary = path.join(outputRoot, `.${target}-${process.pid}`);

for (const required of [shared, ...overlayPaths]) {
  try {
    if (!(await stat(required)).isDirectory()) throw new Error();
  } catch {
    console.error(`Missing source layer: ${path.relative(root, required)}`);
    process.exit(1);
  }
}

await mkdir(outputRoot, { recursive: true });
await rm(temporary, { recursive: true, force: true });
await cp(shared, temporary, { recursive: true, force: true });
for (const overlay of overlayPaths) {
  await cp(overlay, temporary, { recursive: true, force: true });
}

const metadata = {
  target,
  platform: target.startsWith("macos-") ? "macos" : target.startsWith("ubuntu-") ? "ubuntu" : target,
  arch: target.endsWith("-arm64") ? "arm64" : target.endsWith("-x64") ? "x64" : null,
  generatedAt: new Date().toISOString(),
  sourceLayers: ["shared", ...targetLayers[target]]
};
await writeFile(path.join(temporary, ".codecn-source.json"), `${JSON.stringify(metadata, null, 2)}\n`);
await rm(output, { recursive: true, force: true });
await rename(temporary, output);

console.log(output);
