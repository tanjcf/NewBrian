import { readdir } from "node:fs/promises";
import path from "node:path";
import { validateMaterializedApplicationEntries } from "./verify-layout-policy.mjs";

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
    // Local install/build junk must not count as source, but must not block layout
    // verification on developer machines that accidentally ran pnpm inside overlays.
    if (forbidden.has(entry.name)) continue;
    if (entry.isDirectory()) files.push(...await walk(relativeRoot, relative));
    else files.push(relative.split(path.sep).join("/"));
  }
  return files;
}

const [shared, macosCommon, macosArm64, macosX64, ubuntuCommon, ubuntuArm64, ubuntuX64, windows] = await Promise.all(layers.map((layer) => walk(layer)));
const sharedSet = new Set(shared);
// These Windows E2E scripts intentionally mirror shared helpers so the
// platform package can run them from its own overlay. They are kept in sync
// byte-for-byte; platform-specific implementations remain subject to the
// collision check below.
const intentionalWindowsMirrors = new Set([
  "apps/desktop/scripts/electron-e2e-session.mjs",
  "apps/desktop/scripts/test-electron-brain-document-revision.mjs",
  "apps/desktop/scripts/test-electron-brain-pdf-annotation.mjs",
  "apps/desktop/scripts/test-openclaw-media-gateway-e2e.mjs"
]);
const collisions = [...macosCommon, ...ubuntuCommon, ...windows]
  .filter((file) => sharedSet.has(file) && !(windows.includes(file) && intentionalWindowsMirrors.has(file)));
if (collisions.length) throw new Error(`Shared/overlay path collision: ${collisions[0]}`);

for (const [platform, overlay] of [["macos", macosCommon], ["ubuntu", ubuntuCommon], ["windows", windows]]) {
  if (!sharedSet.has("package.json") && !overlay.includes("package.json")) {
    throw new Error(`Missing package.json for ${platform}`);
  }
}

for (const [arch, overlay] of [["arm64", macosArm64], ["x64", macosX64]]) {
  if (!overlay.includes("newbrain.arch.json")) throw new Error(`Missing newbrain.arch.json for macOS ${arch}`);
}

for (const [arch, overlay] of [["arm64", ubuntuArm64], ["x64", ubuntuX64]]) {
  if (!overlay.includes("newbrain.arch.json")) throw new Error(`Missing newbrain.arch.json for Ubuntu ${arch}`);
}

const mergeLayers = (...sourceLayers) => [...new Set(sourceLayers.flat())];
validateMaterializedApplicationEntries("macos-arm64", mergeLayers(shared, macosCommon, macosArm64));
validateMaterializedApplicationEntries("macos-x64", mergeLayers(shared, macosCommon, macosX64));
validateMaterializedApplicationEntries("ubuntu-arm64", mergeLayers(shared, ubuntuCommon, ubuntuArm64));
validateMaterializedApplicationEntries("ubuntu-x64", mergeLayers(shared, ubuntuCommon, ubuntuX64));
validateMaterializedApplicationEntries("windows", mergeLayers(shared, windows));

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
