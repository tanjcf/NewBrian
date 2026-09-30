import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { ManagedCondaInstallerSpec } from "./environment-discovery-service.js";

export interface BoundedCommandInput {
  executable: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface BoundedCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

const MAX_CAPTURED_OUTPUT = 64 * 1024;

export function buildBoundedCommandEnv(
  input: NodeJS.ProcessEnv | undefined,
  platform: NodeJS.Platform = process.platform,
  host: NodeJS.ProcessEnv = process.env
) {
  const merged: NodeJS.ProcessEnv = { ...host, ...(input ?? {}) };
  if (platform !== "win32") return merged;
  const systemRoot = input?.SystemRoot?.trim() || input?.WINDIR?.trim()
    || host.SystemRoot?.trim() || host.WINDIR?.trim() || "C:\\Windows";
  const path = input?.PATH?.trim() || input?.Path?.trim() || host.PATH?.trim() || host.Path?.trim() || "";
  merged.SystemRoot = systemRoot;
  merged.WINDIR = systemRoot;
  merged.ComSpec = input?.ComSpec?.trim() || host.ComSpec?.trim() || join(systemRoot, "System32", "cmd.exe");
  merged.PATH = path;
  delete merged.Path;
  return merged;
}

function quoteWindowsCommandArgument(value: string) {
  return `"${value.replace(/(["^&|<>])/g, "^$1").replace(/%/g, "%%")}"`;
}

export function resolveBoundedSpawnCommand(
  input: Pick<BoundedCommandInput, "executable" | "args">,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
) {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(input.executable)) {
    return { executable: input.executable, args: input.args, windowsVerbatimArguments: false };
  }
  const commandLine = [input.executable, ...input.args].map(quoteWindowsCommandArgument).join(" ");
  return {
    executable: environment.ComSpec?.trim() || join(environment.SystemRoot?.trim() || "C:\\Windows", "System32", "cmd.exe"),
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true
  };
}

/** Runs a subprocess with cancellation, hidden-window, and bounded-output guarantees. */
export function runBoundedEnvironmentCommand(input: BoundedCommandInput): Promise<BoundedCommandResult> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(input.signal.reason ?? new Error("Process was canceled."));
      return;
    }
    let cwdStat;
    try {
      cwdStat = statSync(input.cwd);
    } catch {
      reject(new Error(`Command working directory does not exist: ${input.cwd}`));
      return;
    }
    if (!cwdStat.isDirectory()) {
      reject(new Error(`Command working directory is not a directory: ${input.cwd}`));
      return;
    }
    const env = buildBoundedCommandEnv(input.env);
    const spawnCommand = resolveBoundedSpawnCommand(input, process.platform, env);
    const child = spawn(spawnCommand.executable, spawnCommand.args, {
      cwd: input.cwd,
      env,
      windowsHide: true,
      windowsVerbatimArguments: spawnCommand.windowsVerbatimArguments,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString("utf8")}`.slice(-MAX_CAPTURED_OUTPUT);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const stop = (error: Error) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", onAbort);
      child.kill();
      reject(error);
    };
    const onAbort = () => stop(input.signal?.reason instanceof Error
      ? input.signal.reason
      : new Error("Process was canceled."));
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", stop);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", onAbort);
      resolve({ status: code ?? -1, stdout, stderr });
    });
  });
}

export interface ManagedCondaEnvironmentSummary {
  platform: NodeJS.Platform;
  arch: string;
  release: string;
  installerSpec: ManagedCondaInstallerSpec | null;
}

export interface ManagedCondaInstallerDependencies {
  workspacePath: string;
  platform: NodeJS.Platform;
  getManagedCondaRoot: () => string;
  getManagedCondaExecutable: () => string;
  pathExists: (path: string) => Promise<boolean>;
  summarizeEnvironment: () => ManagedCondaEnvironmentSummary;
  showManualInstallPrompt: (reason: string, summary: ManagedCondaEnvironmentSummary) => Promise<unknown>;
  canReachPublicUrl: (url: string) => Promise<boolean>;
  ensureDirectory: (path: string) => Promise<unknown>;
  quoteShellArgument: (value: string) => string;
  runCommand: (input: BoundedCommandInput) => Promise<BoundedCommandResult>;
}

/** Downloads and installs the managed Conda runtime as one bounded, resumable transaction. */
export class ManagedCondaInstallerService {
  private readonly dependencies: ManagedCondaInstallerDependencies;

  constructor(dependencies: ManagedCondaInstallerDependencies) {
    this.dependencies = dependencies;
  }

  async ensureInstalled(signal?: AbortSignal) {
    const condaPath = this.dependencies.getManagedCondaExecutable();
    if (await this.dependencies.pathExists(condaPath)) return condaPath;
    const summary = this.dependencies.summarizeEnvironment();
    if (!summary.installerSpec) {
      await this.dependencies.showManualInstallPrompt("当前系统架构暂不支持自动下载安装 conda。", summary);
      throw new Error(`Unsupported platform for managed conda install: ${summary.platform} ${summary.arch}`);
    }
    const spec = summary.installerSpec;
    if (!(await this.dependencies.canReachPublicUrl(spec.downloadUrl))) {
      await this.dependencies.showManualInstallPrompt("未检测到可访问的公网下载地址，可能处于离线或仅局域网环境。", summary);
      throw new Error(`Public network unavailable for managed conda installer: ${spec.downloadUrl}`);
    }
    const installerDirectory = join(this.dependencies.workspacePath, "install");
    const installerPath = join(installerDirectory, spec.fileName);
    await this.dependencies.ensureDirectory(installerDirectory);
    if (!(await this.dependencies.pathExists(installerPath))) {
      const executable = this.dependencies.platform === "win32" ? "powershell.exe" : "/bin/zsh";
      const args = this.dependencies.platform === "win32"
        ? ["-NoLogo", "-NoProfile", "-Command", `Invoke-WebRequest -Uri ${this.dependencies.quoteShellArgument(spec.downloadUrl)} -OutFile ${this.dependencies.quoteShellArgument(installerPath)}`]
        : ["-lc", `curl -L ${this.dependencies.quoteShellArgument(spec.downloadUrl)} -o ${this.dependencies.quoteShellArgument(installerPath)}`];
      const downloaded = await this.dependencies.runCommand({
        executable,
        args,
        cwd: this.dependencies.workspacePath,
        signal
      });
      if (downloaded.status !== 0) {
        throw new Error(`Unable to download Miniconda installer: ${downloaded.stderr || downloaded.stdout || downloaded.status}`);
      }
    }
    const condaRoot = this.dependencies.getManagedCondaRoot();
    await this.dependencies.ensureDirectory(condaRoot);
    const installed = await this.dependencies.runCommand(spec.installMode === "windows-exe" ? {
      executable: installerPath,
      args: ["/S", `/D=${condaRoot}`],
      cwd: this.dependencies.workspacePath,
      signal
    } : {
      executable: "/bin/zsh",
      args: ["-lc", `${this.dependencies.quoteShellArgument(installerPath)} -b -p ${this.dependencies.quoteShellArgument(condaRoot)}`],
      cwd: this.dependencies.workspacePath,
      signal
    });
    if (installed.status !== 0) {
      throw new Error(`Unable to install managed Miniconda: ${installed.stderr || installed.stdout || installed.status}`);
    }
    if (!(await this.dependencies.pathExists(condaPath))) {
      throw new Error(`Managed Miniconda install completed but conda was not found at ${condaPath}`);
    }
    return condaPath;
  }
}
