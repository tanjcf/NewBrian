import { cp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const platform = process.argv[2];
const supported = new Set(["macos", "windows"]);

if (!supported.has(platform)) {
  console.error("Usage: node scripts/materialize.mjs <macos|windows>");
  process.exit(1);
}

const shared = path.join(root, "shared");
const overlay = path.join(root, "platforms", platform);
const outputRoot = path.join(root, ".materialized");
const output = path.join(outputRoot, platform);
const temporary = path.join(outputRoot, `.${platform}-${process.pid}`);

for (const required of [shared, overlay]) {
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
await cp(overlay, temporary, { recursive: true, force: true });

const metadata = {
  platform,
  generatedAt: new Date().toISOString(),
  sourceLayers: ["shared", `platforms/${platform}`]
};
await writeFile(path.join(temporary, ".codecn-source.json"), `${JSON.stringify(metadata, null, 2)}\n`);
await rm(output, { recursive: true, force: true });
await rename(temporary, output);

console.log(output);
