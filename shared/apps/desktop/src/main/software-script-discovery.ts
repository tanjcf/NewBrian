import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrainSoftwareOperation, BrainSoftwareScript } from "@codex-forge/protocol";
const allowed: Array<[string, BrainSoftwareOperation]> = [["test", "test"], ["build", "build"], ["format", "format"], ["lint", "lint"], ["deploy", "deploy"]];
export async function discoverSoftwareScripts(projectRoot: string): Promise<BrainSoftwareScript[]> { let parsed: any; try { parsed = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")); } catch { return []; } if (!parsed || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) return []; return allowed.flatMap(([id, operation]) => typeof parsed.scripts[id] === "string" && parsed.scripts[id].trim() ? [{ id, label: id, operation, executable: "npm", args: ["run", id], cwd: ".", source: "package-json" as const }] : []); }
