import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type EngineId = "ffmpeg" | "ffprobe" | "node" | "godot" | "epic-launcher";

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

/** Discovers ffmpeg/node/godot/epic without installing. */
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
    return [];
  }

  async resolve(engineId: EngineId): Promise<ResolvedEngine | null> {
    for (const candidate of this.systemCandidates(engineId)) {
      const resolved = candidate.includes("/") || candidate.includes("\\")
        ? await pathExecutable(this.deps, candidate)
        : candidate;
      if (!resolved) continue;
      const version = commandVersion(this.deps, resolved, engineId === "node" ? ["--version"] : ["-version"]);
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
    const engines: EngineId[] = ["ffmpeg", "ffprobe", "node", "godot", "epic-launcher"];
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
