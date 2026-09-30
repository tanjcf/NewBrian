import { posix, win32 } from "node:path";
import {
  discoverHostToolPathEntries,
  enrichShellEnvForTools,
  mergePathEntries,
  readPathFromEnv,
  writePathToEnv
} from "../../../agentd/src/shell-env.js";

export interface ResolvedCondaExecutable {
  source: "system" | "managed";
  condaPath: string;
}

export interface ManagedCondaInstallerSpec {
  fileName: string;
  downloadUrl: string;
  installMode: "windows-exe" | "posix-shell";
  platformLabel: string;
}

export interface EnvironmentDiscoveryDependencies {
  platform: NodeJS.Platform;
  arch: string;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  managedCondaRoot: string;
  accessPath: (path: string) => Promise<unknown>;
  lookupCommand: (executable: string, args: string[]) => { status: number | null; stdout?: string | Buffer };
}

/** Discovers existing runtimes without installing or mutating the host environment. */
export class EnvironmentDiscoveryService {
  private readonly dependencies: EnvironmentDiscoveryDependencies;

  constructor(dependencies: EnvironmentDiscoveryDependencies) {
    this.dependencies = dependencies;
  }

  private get paths() {
    return this.dependencies.platform === "win32" ? win32 : posix;
  }

  getManagedCondaRoot() {
    return this.dependencies.managedCondaRoot;
  }

  getManagedCondaExecutable() {
    return this.dependencies.platform === "win32"
      ? this.paths.join(this.dependencies.managedCondaRoot, "Scripts", "conda.exe")
      : this.paths.join(this.dependencies.managedCondaRoot, "bin", "conda");
  }

  getSystemCondaCandidatePaths() {
    if (this.dependencies.platform === "win32") {
      const userProfile = this.dependencies.environment.USERPROFILE?.trim() || "";
      const localAppData = this.dependencies.environment.LOCALAPPDATA?.trim() || "";
      const programData = this.dependencies.environment.ProgramData?.trim() || "C:\\ProgramData";
      return [
        "conda.exe",
        "conda.bat",
        userProfile ? this.paths.join(userProfile, "miniconda3", "Scripts", "conda.exe") : "",
        userProfile ? this.paths.join(userProfile, "anaconda3", "Scripts", "conda.exe") : "",
        localAppData ? this.paths.join(localAppData, "miniconda3", "Scripts", "conda.exe") : "",
        localAppData ? this.paths.join(localAppData, "anaconda3", "Scripts", "conda.exe") : "",
        programData ? this.paths.join(programData, "miniconda3", "Scripts", "conda.exe") : "",
        programData ? this.paths.join(programData, "anaconda3", "Scripts", "conda.exe") : ""
      ].filter(Boolean);
    }
    return [
      "conda",
      this.dependencies.homeDirectory ? this.paths.join(this.dependencies.homeDirectory, "miniconda3", "bin", "conda") : "",
      this.dependencies.homeDirectory ? this.paths.join(this.dependencies.homeDirectory, "anaconda3", "bin", "conda") : "",
      "/opt/miniconda3/bin/conda",
      "/opt/anaconda3/bin/conda"
    ].filter(Boolean);
  }

  getSystemNodeCandidatePaths() {
    if (this.dependencies.platform === "win32") {
      const programFiles = this.dependencies.environment.ProgramFiles?.trim() || "C:\\Program Files";
      const programFilesX86 = this.dependencies.environment["ProgramFiles(x86)"]?.trim() || "C:\\Program Files (x86)";
      const localAppData = this.dependencies.environment.LOCALAPPDATA?.trim() || "";
      const userProfile = this.dependencies.environment.USERPROFILE?.trim() || "";
      const candidates = [
        "node",
        "node.exe",
        this.paths.join(programFiles, "nodejs", "node.exe"),
        this.paths.join(programFilesX86, "nodejs", "node.exe"),
        localAppData ? this.paths.join(localAppData, "Programs", "nodejs", "node.exe") : "",
        userProfile ? this.paths.join(userProfile, "scoop", "apps", "nodejs", "current", "node.exe") : "",
        userProfile ? this.paths.join(userProfile, "AppData", "Roaming", "nvm", "nodejs", "node.exe") : ""
      ];
      for (const entry of discoverHostToolPathEntries(this.dependencies.environment)) {
        candidates.push(this.paths.join(entry, "node.exe"), this.paths.join(entry, "node"));
      }
      return candidates.filter(Boolean);
    }
    return ["node", "/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"];
  }

  getSystemPythonCandidatePaths() {
    if (this.dependencies.platform === "win32") {
      const localAppData = this.dependencies.environment.LOCALAPPDATA?.trim() || "";
      const userProfile = this.dependencies.environment.USERPROFILE?.trim() || "";
      const candidates = [
        "py",
        "python",
        "python3",
        localAppData ? this.paths.join(localAppData, "Programs", "Python", "Launcher", "py.exe") : "",
        userProfile ? this.paths.join(userProfile, "AppData", "Local", "Programs", "Python", "Launcher", "py.exe") : ""
      ];
      for (const entry of discoverHostToolPathEntries(this.dependencies.environment)) {
        candidates.push(this.paths.join(entry, "python.exe"), this.paths.join(entry, "py.exe"));
      }
      return candidates.filter(Boolean);
    }
    return ["python3", "python", "/usr/bin/python3", "/usr/local/bin/python3"];
  }

  quoteShellArgument(value: string) {
    return this.dependencies.platform === "win32"
      ? `"${value.replace(/"/g, '""')}"`
      : `'${value.replace(/'/g, `'\\''`)}'`;
  }

  async pathExists(targetPath: string) {
    try {
      await this.dependencies.accessPath(targetPath);
    } catch {
      return false;
    }
    return true;
  }

  detectCommandPath(command: string) {
    if (!command.trim()) return "";
    const executable = this.dependencies.platform === "win32" ? "cmd.exe" : "/bin/zsh";
    const args = this.dependencies.platform === "win32"
      ? ["/d", "/s", "/c", `where ${command}`]
      : ["-lc", `command -v ${this.quoteShellArgument(command)}`];
    const lookup = this.dependencies.lookupCommand(executable, args);
    if (lookup.status !== 0) return "";
    const candidates = String(lookup.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (this.dependencies.platform !== "win32") return candidates[0] || "";
    return candidates.find((candidate) => /\.(?:exe|com|cmd|bat)$/i.test(candidate)) || candidates[0] || "";
  }

  normalizeCondaExecutablePath(candidate: string) {
    if (!candidate.trim()) return "";
    return candidate.includes(this.paths.sep) || candidate.includes("/") || candidate.includes("\\")
      ? this.paths.resolve(candidate.trim())
      : this.detectCommandPath(candidate.trim());
  }

  async resolvePreferredNodeExecutable() {
    const seen = new Set<string>();
    const consider = async (candidate: string) => {
      const normalized = candidate.includes(this.paths.sep) || candidate.includes("/") || candidate.includes("\\")
        ? this.paths.resolve(candidate)
        : this.detectCommandPath(candidate);
      const path = String(normalized || "").trim();
      if (!path || seen.has(path.toLowerCase())) return "";
      seen.add(path.toLowerCase());
      // Absolute defaults like Program Files\nodejs must be verified; GUI launches
      // previously returned a missing path and bootstrap spawn failed with ENOENT.
      return await this.pathExists(path) ? path : "";
    };
    for (const candidate of this.getSystemNodeCandidatePaths()) {
      const found = await consider(candidate);
      if (found) return found;
    }
    if (this.dependencies.platform === "win32") {
      const registryPath = this.readWindowsRegistryPath();
      for (const entry of registryPath.split(this.paths.delimiter)) {
        const dir = entry.trim();
        if (!dir) continue;
        const found = await consider(this.paths.join(dir, "node.exe"));
        if (found) return found;
      }
    }
    return "";
  }

  async resolvePreferredPythonExecutable() {
    for (const candidate of this.getSystemPythonCandidatePaths()) {
      const normalized = candidate.includes(this.paths.sep) || candidate.includes("/") || candidate.includes("\\")
        ? this.paths.resolve(candidate)
        : this.detectCommandPath(candidate);
      if (!normalized?.trim()) continue;
      if (["py", "python", "python3"].includes(candidate) || await this.pathExists(normalized)) {
        return normalized.trim();
      }
    }
    return "";
  }

  async resolvePreferredCondaExecutable(): Promise<ResolvedCondaExecutable | null> {
    for (const candidate of this.getSystemCondaCandidatePaths()) {
      const normalized = this.normalizeCondaExecutablePath(candidate);
      if (!normalized) continue;
      if (["conda.exe", "conda.bat", "conda"].includes(candidate) || await this.pathExists(normalized)) {
        return { source: "system", condaPath: normalized };
      }
    }
    const managedCondaPath = this.getManagedCondaExecutable();
    return await this.pathExists(managedCondaPath)
      ? { source: "managed", condaPath: managedCondaPath }
      : null;
  }

  /**
   * Read Machine+User Path from the Windows registry so GUI/Electron launches
   * pick up the same PATH as an interactive shell (python/py/node).
   */
  readWindowsRegistryPath(queryRegistry = this.dependencies.lookupCommand) {
    if (this.dependencies.platform !== "win32") return "";
    const expand = (raw: string) => {
      let value = raw;
      value = value.replace(/%([^%]+)%/g, (_match, name: string) => {
        const fromEnv = this.dependencies.environment[name] ?? this.dependencies.environment[name.toUpperCase()];
        return fromEnv != null && String(fromEnv) !== "" ? String(fromEnv) : `%${name}%`;
      });
      return value;
    };
    const readKey = (hivePath: string) => {
      const result = queryRegistry("reg.exe", ["query", hivePath, "/v", "Path"]);
      if (result.status !== 0) return "";
      const text = String(result.stdout || "");
      const match = text.match(/\r?\n\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+)\r?\n/i);
      return match ? expand(match[1].trim()) : "";
    };
    return mergePathEntries(
      readKey("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"),
      readKey("HKCU\\Environment")
    );
  }

  /**
   * Build agent/terminal env with canonical Path key, registry user PATH, and host tool dirs.
   */
  enrichShellEnv(shellEnv: Record<string, string> = {}, options: { registryPath?: string } = {}) {
    const registryPath = options.registryPath
      ?? (this.dependencies.platform === "win32" ? this.readWindowsRegistryPath() : "");
    return enrichShellEnvForTools(shellEnv, {
      processEnv: this.dependencies.environment,
      extraPathEntries: [registryPath, ...discoverHostToolPathEntries(this.dependencies.environment)]
    });
  }

  prependPathEntries(env: Record<string, string>, ...entries: string[]) {
    return writePathToEnv(env, mergePathEntries(...entries, readPathFromEnv(env)));
  }

  getManagedCondaInstallerSpec(): ManagedCondaInstallerSpec | null {
    if (this.dependencies.platform === "win32") {
      return this.dependencies.arch === "x64" ? {
        fileName: "Miniconda3-latest-Windows-x86_64.exe",
        downloadUrl: "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe",
        installMode: "windows-exe",
        platformLabel: "Windows x64"
      } : null;
    }
    if (this.dependencies.platform !== "darwin") return null;
    if (this.dependencies.arch === "arm64") return {
      fileName: "Miniconda3-latest-MacOSX-arm64.sh",
      downloadUrl: "https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-arm64.sh",
      installMode: "posix-shell",
      platformLabel: "macOS Apple Silicon"
    };
    return this.dependencies.arch === "x64" ? {
      fileName: "Miniconda3-latest-MacOSX-x86_64.sh",
      downloadUrl: "https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh",
      installMode: "posix-shell",
      platformLabel: "macOS Intel"
    } : null;
  }
}

export { mergePathEntries, readPathFromEnv, writePathToEnv };
