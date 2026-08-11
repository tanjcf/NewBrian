import { readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const layers = ["shared", "platforms/macos", "platforms/windows"];
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

const [shared, macos, windows] = await Promise.all(layers.map((layer) => walk(layer)));
const sharedSet = new Set(shared);
const collisions = [...macos, ...windows].filter((file) => sharedSet.has(file));
if (collisions.length) throw new Error(`Shared/overlay path collision: ${collisions[0]}`);

for (const [platform, overlay] of [["macos", macos], ["windows", windows]]) {
  if (!sharedSet.has("package.json") && !overlay.includes("package.json")) {
    throw new Error(`Missing package.json for ${platform}`);
  }
}

console.log(JSON.stringify({
  shared: shared.length,
  macos: macos.length,
  windows: windows.length,
  status: "ok"
}, null, 2));
