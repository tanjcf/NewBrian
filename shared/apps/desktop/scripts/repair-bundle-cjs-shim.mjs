import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pattern =
  /,\s*"\s*\r?\n\/\/ -- CommonJS Shims --[\s\S]*?\r?\n([A-Za-z0-9_]+)"\)/g;

export function repairMainBundleDir(mainDir) {
  if (!fs.existsSync(mainDir)) return 0;
  let fixedFiles = 0;
  for (const file of fs.readdirSync(mainDir).filter((name) => name.endsWith(".js"))) {
    const target = path.join(mainDir, file);
    const original = fs.readFileSync(target, "utf8");
    if (!original.includes("// -- CommonJS Shims --")) continue;
    const repaired = original.replace(pattern, ', "$1")');
    if (repaired === original) continue;
    fs.writeFileSync(target, repaired);
    const count = (original.match(pattern) || []).length;
    console.log(`[repair-bundle-cjs-shim] ${file}: fixed ${count} site(s)`);
    fixedFiles += 1;
  }
  return fixedFiles;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const mainDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out/main");
  repairMainBundleDir(mainDir);
}
