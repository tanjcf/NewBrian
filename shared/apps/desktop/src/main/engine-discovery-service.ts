import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type EngineId = "ffmpeg" | "ffprobe" | "node" | "godot" | "epic-launcher" | "unreal-editor";

export interface EngineDiscoveryDependencies {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  managedEnginesRoot: string;
  lookupCommand: (executable: string, args: string[]) => { status: number | null; stdout?: string | Buffer };
  accessPath: (path: string) => Promise<unknown>;
}

export interface ResolvedEngine {
  engineId: EngineId;
  executable: string;
  source: "system" | "managed";
  version: string;
}

const ffmpegNames = (platform: NodeJS.Platform) => platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"];
const ffprobeNames = (platform: NodeJS.Platform) => platform === "win32" ? ["ffprobe.exe", "ffprobe"] : ["ffprobe"];

async function pathExecutable(deps: EngineDiscoveryDependencies, candidate: string) {
  if (!candidate) return "";
  try {
    await deps.accessPath(candidate);
    return candidate;
  } catch {
    return "";
  }
}

function commandVersion(deps: EngineDiscoveryDependencies, executable: string, args: string[]) {
  try {
    const result = deps.lookupCommand(executable, args);
    if (result.status !== 0) return "";
    return String(result.stdout ?? "").split("\n")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Resolve a PATH-only name to an absolute executable when possible. */
function locateOnPath(deps: EngineDiscoveryDependencies, name: string) {
  try {
    const lookup = deps.platform === "win32"
      ? deps.lookupCommand("where.exe", [name])
      : deps.lookupCommand("which", [name]);
    if (lookup.status !== 0) return "";
    const first = String(lookup.stdout ?? "")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean);
    return first || "";
  } catch {
    return "";
  }
}

/** Discovers local runtimes and game editors without installing them. */
export class EngineDiscoveryService {
  private readonly deps: EngineDiscoveryDependencies;

  constructor(deps: EngineDiscoveryDependencies) {
    this.deps = deps;
  }

  getManagedEnginesRoot() {
    return this.deps.managedEnginesRoot;
  }

  managedExecutable(engineId: EngineId) {
    const root = this.deps.managedEnginesRoot;
    if (engineId === "ffmpeg") return this.deps.platform === "win32" ? join(root, "ffmpeg", "bin", "ffmpeg.exe") : join(root, "ffmpeg", "bin", "ffmpeg");
    if (engineId === "ffprobe") return this.deps.platform === "win32" ? join(root, "ffmpeg", "bin", "ffprobe.exe") : join(root, "ffmpeg", "bin", "ffprobe");
    if (engineId === "node") return this.deps.platform === "win32" ? join(root, "node", "node.exe") : join(root, "node", "bin", "node");
    if (engineId === "godot") return this.deps.platform === "win32" ? join(root, "godot", "Godot_v4.4-stable_win64.exe") : join(root, "godot", "Godot_v4.4-stable_linux.x86_64");
    if (engineId === "epic-launcher") return this.deps.platform === "win32"
      ? "C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe"
      : "";
    if (engineId === "unreal-editor") return "";
    return "";
  }

  systemCandidates(engineId: EngineId): string[] {
    if (engineId === "ffmpeg") return ffmpegNames(this.deps.platform);
    if (engineId === "ffprobe") return ffprobeNames(this.deps.platform);
    if (engineId === "node") return this.deps.platform === "win32" ? ["node.exe", "node"] : ["node"];
    if (engineId === "godot") {
      const local = process.env.BRAIN_GODOT_EXECUTABLE?.trim();
      return local ? [local] : this.deps.platform === "win32" ? ["godot.exe", "Godot.exe"] : ["godot", "Godot"];
    }
    if (engineId === "epic-launcher") {
      const custom = process.env.BRAIN_EPIC_LAUNCHER_EXECUTABLE?.trim();
      return custom ? [custom] : this.managedExecutable("epic-launcher") ? [this.managedExecutable("epic-launcher")] : [];
    }
    if (engineId === "unreal-editor" && this.deps.platform === "win32") {
      const candidates = [this.deps.environment.BRAIN_UNREAL_EDITOR_EXECUTABLE?.trim() || ""];
      // Epic stores the installed root in the registry; enumerate every
      // installed UE version and derive the actual editor executable.
      try {
        const registry = this.deps.lookupCommand("reg.exe", ["query", "HKLM\\SOFTWARE\\EpicGames\\Unreal Engine", "/s"]);
        const text = String(registry.stdout ?? "");
        for (const root of text.matchAll(/InstalledDirectory\s+REG_SZ\s+(.+)\s*$/gim)) {
          candidates.push(join(root[1].trim(), "Engine", "Binaries", "Win64", "UnrealEditor.exe"));
        }
      } catch { /* registry unavailable; explicit env/PATH candidates still work */ }
      candidates.push("UnrealEditor.exe", "D:\\UE5\\UE_5.4\\Engine\\Binaries\\Win64\\UnrealEditor.exe", "D:\\UE5\\UE_5.7\\Engine\\Binaries\\Win64\\UnrealEditor.exe");
      return [...new Set(candidates.filter(Boolean))];
    }
    return [];
  }

  async resolve(engineId: EngineId): Promise<ResolvedEngine | null> {
    for (const candidate of this.systemCandidates(engineId)) {
      const hasPathSep = candidate.includes("/") || candidate.includes("\\");
      let resolved = hasPathSep
        ? await pathExecutable(this.deps, candidate)
        : candidate;
      if (!resolved) continue;
      if (!hasPathSep) {
        const absolute = locateOnPath(this.deps, resolved);
        if (absolute) resolved = absolute;
      }
      const version = commandVersion(this.deps, resolved, engineId === "node" ? ["--version"] : ["-version"]);
      // Skip PATH names that cannot actually run (avoids brain-core process.spawn ENOENT).
      if (!version && !(resolved.includes("/") || resolved.includes("\\"))) continue;
      if (resolved.includes("/") || resolved.includes("\\")) {
        try { await access(resolved, constants.X_OK); } catch { /* PATH lookup below */ }
      }
      return { engineId, executable: resolved, source: "system", version };
    }
    const managed = this.managedExecutable(engineId);
    if (managed && await pathExecutable(this.deps, managed)) {
      return { engineId, executable: managed, source: "managed", version: commandVersion(this.deps, managed, ["-version"]) };
    }
    return null;
  }

  async discoverAll(): Promise<ResolvedEngine[]> {
    const engines: EngineId[] = ["ffmpeg", "ffprobe", "node", "godot", "epic-launcher", "unreal-editor"];
    const resolved: ResolvedEngine[] = [];
    for (const engineId of engines) {
      const item = await this.resolve(engineId);
      if (item) resolved.push(item);
    }
    return resolved;
  }
}

export function lookupCommandSync(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true });
  return { status: result.status, stdout: result.stdout };
}
