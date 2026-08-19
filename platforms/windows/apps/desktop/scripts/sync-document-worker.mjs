import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(desktopRoot, "src/main/document-worker.js");
const target = resolve(desktopRoot, "document-worker.js");
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
