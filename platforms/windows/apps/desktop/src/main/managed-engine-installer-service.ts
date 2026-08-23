import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { EngineId } from "./engine-discovery-service.js";
import { EngineDiscoveryService } from "./engine-discovery-service.js";
import { runBoundedEnvironmentCommand, type BoundedCommandInput } from "./managed-conda-installer-service.js";

export interface ManagedEngineInstallerSpec {
  engineId: EngineId;
  downloadUrl: string;
  archiveName: string;
  extractMode: "zip" | "none";
  targetRelativeDir: string;
}

const WINDOWS_SPECS: Partial<Record<EngineId, ManagedEngineInstallerSpec>> = {
  ffmpeg: {
    engineId: "ffmpeg",
    downloadUrl: process.env.BRAIN_FFMPEG_ZIP_URL?.trim() || "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    archiveName: "ffmpeg-release-essentials.zip",
    extractMode: "zip",
    targetRelativeDir: "ffmpeg"
  },
  godot: {
    engineId: "godot",
    downloadUrl: process.env.BRAIN_GODOT_ZIP_URL?.trim() || "https://github.com/godotengine/godot/releases/download/4.4-stable/Godot_v4.4-stable_win64.exe.zip",
    archiveName: "godot-win64.zip",
    extractMode: "zip",
    targetRelativeDir: "godot"
  },
  node: {
    engineId: "node",
    downloadUrl: process.env.BRAIN_NODE_ZIP_URL?.trim() || "https://nodejs.org/dist/v22.18.0/node-v22.18.0-win-x64.zip",
    archiveName: "node-lts.zip",
    extractMode: "zip",
    targetRelativeDir: "node"
  }
};

export interface ManagedEngineInstallerDependencies {
  managedEnginesRoot: string;
  platform: NodeJS.Platform;
  pathExists: (path: string) => Promise<boolean>;
  canReachPublicUrl: (url: string) => Promise<boolean>;
  runCommand: (input: BoundedCommandInput) => Promise<{ status: number; stdout: string; stderr: string }>;
}

/** Downloads and installs managed ffmpeg/godot runtimes under the BRAIN user data directory. */
export class ManagedEngineInstallerService {
  private readonly deps: ManagedEngineInstallerDependencies;
  private readonly discovery: EngineDiscoveryService;

  constructor(deps: ManagedEngineInstallerDependencies) {
    this.deps = deps;
    this.discovery = new EngineDiscoveryService({
      platform: deps.platform,
      environment: process.env,
      managedEnginesRoot: deps.managedEnginesRoot,
      lookupCommand: (executable, args) => {
        const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true });
        return { status: result.status, stdout: result.stdout };
      },
      accessPath: async (path) => { if (!(await deps.pathExists(path))) throw new Error("missing"); }
    });
  }

  async ensureInstalled(engineId: EngineId, signal?: AbortSignal) {
    const existing = await this.discovery.resolve(engineId);
    if (existing) return existing;
    const spec = WINDOWS_SPECS[engineId];
    if (!spec || this.deps.platform !== "win32") {
      throw new Error(`Unsupported managed engine install: ${engineId} on ${this.deps.platform}`);
    }
    if (!(await this.deps.canReachPublicUrl(spec.downloadUrl))) {
      throw new Error(`Public network unavailable for managed engine installer: ${spec.downloadUrl}`);
    }
    const installDir = join(this.deps.managedEnginesRoot, "install");
    const archivePath = join(installDir, spec.archiveName);
    await mkdir(installDir, { recursive: true });
    if (!(await this.deps.pathExists(archivePath))) {
      const downloaded = await this.deps.runCommand({
        executable: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-Command", `Invoke-WebRequest -Uri '${spec.downloadUrl.replace(/'/g, "''")}' -OutFile '${archivePath.replace(/'/g, "''")}'`],
        cwd: installDir,
        signal
      });
      if (downloaded.status !== 0) throw new Error(`Unable to download ${engineId}: ${downloaded.stderr || downloaded.stdout}`);
    }
    const targetRoot = join(this.deps.managedEnginesRoot, spec.targetRelativeDir);
    await mkdir(targetRoot, { recursive: true });
    if (spec.extractMode === "zip") {
      const extracted = await this.deps.runCommand({
        executable: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-Command", `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${targetRoot.replace(/'/g, "''")}' -Force`],
        cwd: installDir,
        signal
      });
      if (extracted.status !== 0) throw new Error(`Unable to extract ${engineId}: ${extracted.stderr || extracted.stdout}`);
      if (engineId === "ffmpeg") {
        const flattened = await this.deps.runCommand({
          executable: "powershell.exe",
          args: ["-NoLogo", "-NoProfile", "-Command", `$root='${targetRoot.replace(/'/g, "''")}'; $bin=(Get-ChildItem -Path $root -Recurse -Filter ffmpeg.exe | Select-Object -First 1).DirectoryName; if ($bin) { New-Item -ItemType Directory -Force -Path (Join-Path $root 'bin') | Out-Null; Copy-Item (Join-Path $bin 'ffmpeg.exe') (Join-Path $root 'bin/ffmpeg.exe') -Force; Copy-Item (Join-Path $bin 'ffprobe.exe') (Join-Path $root 'bin/ffprobe.exe') -Force }`],
          cwd: installDir,
          signal
        });
        if (flattened.status !== 0) throw new Error(`Unable to flatten ffmpeg install: ${flattened.stderr || flattened.stdout}`);
      }
      if (engineId === "node") {
        const flattened = await this.deps.runCommand({
          executable: "powershell.exe",
          args: ["-NoLogo", "-NoProfile", "-Command", `$root='${targetRoot.replace(/'/g, "''")}'; $exe=(Get-ChildItem -Path $root -Recurse -Filter node.exe | Select-Object -First 1).FullName; if ($exe) { Copy-Item $exe (Join-Path $root 'node.exe') -Force }`],
          cwd: installDir,
          signal
        });
        if (flattened.status !== 0) throw new Error(`Unable to flatten node install: ${flattened.stderr || flattened.stdout}`);
      }
    }
    const resolved = await this.discovery.resolve(engineId);
    if (!resolved) throw new Error(`Managed ${engineId} install completed but executable was not found`);
    return resolved;
  }
}

export { runBoundedEnvironmentCommand };
