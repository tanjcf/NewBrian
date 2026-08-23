import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { BrainGameEngine, BrainGameProjectInspection } from "@codex-forge/protocol";

const IGNORED_DIRECTORIES = new Set([".git", ".idea", ".materialized", "node_modules", "dist", "build", "Library", "Temp", "Saved", "Intermediate"]);
const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cs", ".gd", ".cpp", ".c", ".h", ".hpp", ".lua", ".py"]);
const SCENE_EXTENSIONS = new Set([".tscn", ".scn", ".unity", ".umap", ".scene", ".json"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".tga", ".psd"]);
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".m4a"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const MODEL_EXTENSIONS = new Set([".fbx", ".obj", ".gltf", ".glb", ".blend"]);

interface InspectOptions { maxEntries?: number }

function assetKind(extension: string): keyof BrainGameProjectInspection["assets"] {
  if (SCRIPT_EXTENSIONS.has(extension)) return "scripts";
  if (SCENE_EXTENSIONS.has(extension)) return "scenes";
  if (IMAGE_EXTENSIONS.has(extension)) return "images";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (MODEL_EXTENSIONS.has(extension)) return "models";
  return "other";
}

async function readSmallText(path: string, maxBytes = 256 * 1024) {
  const file = await readFile(path);
  if (file.byteLength > maxBytes) throw new Error("GAME_PROJECT_METADATA_TOO_LARGE");
  return file.toString("utf8");
}

function godotName(source: string) {
  return /^config\/name\s*=\s*"([^"]+)"/mu.exec(source)?.[1]?.trim() || "";
}

export async function inspectGameProject(projectRoot: string, options: InspectOptions = {}): Promise<BrainGameProjectInspection> {
  const rootStat = await lstat(projectRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("GAME_PROJECT_ROOT_INVALID");
  const maxEntries = Math.max(1, Math.min(10_000, Math.floor(options.maxEntries ?? 4_000)));
  const assets: BrainGameProjectInspection["assets"] = { scripts: 0, scenes: 0, images: 0, audio: 0, video: 0, models: 0, other: 0 };
  const markers = new Set<string>();
  const queue = [projectRoot];
  let scannedEntries = 0;
  let skippedEntries = 0;
  let truncated = false;
  let packageJsonPath = "";
  let godotProjectPath = "";

  while (queue.length && !truncated) {
    const directory = queue.shift()!;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (scannedEntries >= maxEntries) { truncated = true; break; }
      scannedEntries += 1;
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(projectRoot, absolutePath).replace(/\\/gu, "/");
      if (entry.isSymbolicLink()) { skippedEntries += 1; continue; }
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) { skippedEntries += 1; continue; }
        queue.push(absolutePath);
        if (relativePath === "ProjectSettings") markers.add("ProjectSettings/");
        continue;
      }
      if (!entry.isFile()) { skippedEntries += 1; continue; }
      if (relativePath === "package.json") { markers.add("package.json"); packageJsonPath = absolutePath; continue; }
      if (relativePath === "project.godot") { markers.add("project.godot"); godotProjectPath = absolutePath; }
      if (entry.name.endsWith(".uproject")) markers.add(relativePath);
      assets[assetKind(extname(entry.name).toLowerCase())] += 1;
    }
  }

  let engine: BrainGameEngine = "unknown";
  let displayName = basename(projectRoot);
  let preview: BrainGameProjectInspection["preview"] = { supported: false, requiresApproval: true };
  const warnings: string[] = [];
  if (markers.has("ProjectSettings/")) engine = "unity";
  else if ([...markers].some((marker) => marker.endsWith(".uproject"))) engine = "unreal";
  else if (godotProjectPath) engine = "godot";
  else if (packageJsonPath) engine = "web";

  if (engine === "web" && packageJsonPath) {
    try {
      const manifest = JSON.parse(await readSmallText(packageJsonPath)) as { name?: unknown; scripts?: Record<string, unknown> };
      if (typeof manifest.name === "string" && manifest.name.trim()) displayName = manifest.name.trim();
      const script = ["dev", "start", "preview"].find((name) => typeof manifest.scripts?.[name] === "string");
      if (script) preview = { supported: true, command: "npm", args: ["run", script], url: "http://127.0.0.1:5173", requiresApproval: true };
      else warnings.push("package.json 未提供 dev、start 或 preview 试玩脚本。");
    } catch {
      warnings.push("package.json 无法安全解析，未生成试玩命令。");
    }
  } else if (engine === "godot" && godotProjectPath) {
    try { displayName = godotName(await readSmallText(godotProjectPath)) || displayName; } catch { /* retain folder name */ }
    const godotExecutable = process.env.BRAIN_GODOT_EXECUTABLE?.trim();
    if (godotExecutable) {
      preview = { supported: true, command: godotExecutable, args: ["--path", projectRoot], url: "", requiresApproval: true };
    } else warnings.push("未配置可验证的 Godot 可执行程序，暂不生成试玩命令。");
  } else if (engine === "unity") warnings.push("未配置可验证的 Unity Editor，暂不生成试玩命令。");
  else if (engine === "unreal") warnings.push("未配置可验证的 Unreal Editor，暂不生成试玩命令。");
  else warnings.push("未识别受支持的游戏工程标记。");
  if (truncated) warnings.push(`项目条目超过 ${maxEntries}，本次只展示有界扫描结果。`);

  return { schemaVersion: 1, engine, displayName, markers: [...markers].sort(), assets, preview, warnings, scannedEntries, skippedEntries, truncated };
}
