import { readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const layers = [
  "shared",
  "platforms/macos/common",
  "platforms/macos/arm64",
  "platforms/macos/x64",
  "platforms/ubuntu/common",
  "platforms/ubuntu/arm64",
  "platforms/ubuntu/x64",
  "platforms/windows"
];
const forbidden = new Set(["node_modules", "out", "release", "dist", ".pnpm-store", ".DS_Store", "__pycache__"]);

async function walk(relativeRoot, current = "") {
  const absolute = path.join(root, relativeRoot, current);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(current, entry.name);
    if (forbidden.has(entry.name)) throw new Error(`Forbidden path: ${path.join(relativeRoot, relative)}`);
    if (entry.isDirectory()) files.push(...await walk(relativeRoot, relative));
    else files.push(relative.split(path.sep).join("/"));
  }
  return files;
}

const [shared, macosCommon, macosArm64, macosX64, ubuntuCommon, ubuntuArm64, ubuntuX64, windows] = await Promise.all(layers.map((layer) => walk(layer)));
const sharedSet = new Set(shared);
const collisions = [...macosCommon, ...ubuntuCommon, ...windows].filter((file) => sharedSet.has(file));
if (collisions.length) throw new Error(`Shared/overlay path collision: ${collisions[0]}`);

for (const [platform, overlay] of [["macos", macosCommon], ["ubuntu", ubuntuCommon], ["windows", windows]]) {
  if (!sharedSet.has("package.json") && !overlay.includes("package.json")) {
    throw new Error(`Missing package.json for ${platform}`);
  }
}

for (const [arch, overlay] of [["arm64", macosArm64], ["x64", macosX64]]) {
  if (!overlay.includes("codecn.arch.json")) throw new Error(`Missing codecn.arch.json for macOS ${arch}`);
}

for (const [arch, overlay] of [["arm64", ubuntuArm64], ["x64", ubuntuX64]]) {
  if (!overlay.includes("codecn.arch.json")) throw new Error(`Missing codecn.arch.json for Ubuntu ${arch}`);
}

console.log(JSON.stringify({
  shared: shared.length,
  macosCommon: macosCommon.length,
  macosArm64: macosArm64.length,
  macosX64: macosX64.length,
  ubuntuCommon: ubuntuCommon.length,
  ubuntuArm64: ubuntuArm64.length,
  ubuntuX64: ubuntuX64.length,
  windows: windows.length,
  status: "ok"
}, null, 2));
