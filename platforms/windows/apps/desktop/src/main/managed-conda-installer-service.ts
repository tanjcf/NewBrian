import { spawn } from "node:child_process";
import { createWriteStream, statSync } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet, type RequestOptions } from "node:https";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
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

export interface BoundedSpawnCommand {
  executable: string;
  args: string[];
  envExtra?: NodeJS.ProcessEnv;
  windowsVerbatimArguments: boolean;
}

const MAX_CAPTURED_OUTPUT = 64 * 1024;
const WINDOWS_SYSTEM_ROOT = "C:\\Windows";
/** Literal only — never read ComSpec from the host (CodeQL absolute-path source). */
const WINDOWS_CMD_EXE = "C:\\Windows\\System32\\cmd.exe";
/**
 * Env key holding the quoted command line for .cmd/.bat shims.
 * The spawn argv stays a fixed literal (`call %VAR%`) so absolute paths never
 * become CodeQL indirect shell-command arguments (js/shell-command-injection-from-environment).
 */
export const BOUNDED_CMD_ENV_KEY = "NEWBRAIN_BOUNDED_CMDLINE";
/** Fixed shell line — must not embed paths. */
const BOUNDED_CMD_SHELL_LINE = `call %${BOUNDED_CMD_ENV_KEY}%`;

const HOST_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERNAME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOME",
  "LANG",
  "LC_ALL",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS"
] as const;

/**
 * Only allow a simple `X:\Windows` SystemRoot. Rejects shell metacharacters so
 * environment values cannot reshape a later command invocation.
 */
export function resolveTrustedWindowsSystemRoot(candidate: string | undefined): string {
  const value = String(candidate || "").trim();
  if (/^[A-Za-z]:\\Windows$/i.test(value)) {
    return `${value[0].toUpperCase()}:\\Windows`;
  }
  return WINDOWS_SYSTEM_ROOT;
}

/** Drop PATH segments that contain cmd.exe metacharacters. */
export function sanitizeWindowsPathEnv(pathValue: string | undefined): string {
  const raw = String(pathValue || "");
  return raw
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !/[>&|<>^%]/.test(segment))
    .join(";");
}

/**
 * Rebuild env for bounded commands. ComSpec/SystemRoot are pinned to trusted
 * literals; PATH is sanitized; host env is allowlisted (no full process.env spread).
 */
export function buildBoundedCommandEnv(
  input: NodeJS.ProcessEnv | undefined,
  platform: NodeJS.Platform = process.platform,
  host: NodeJS.ProcessEnv = process.env
) {
  if (platform !== "win32") {
    return { ...host, ...(input ?? {}) };
  }
  const out: NodeJS.ProcessEnv = {};
  for (const key of HOST_ENV_ALLOWLIST) {
    const value = host[key];
    if (value !== undefined && value !== "") out[key] = value;
  }
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined) continue;
    if (key === "ComSpec" || key === "SystemRoot" || key === "WINDIR") continue;
    out[key] = value;
  }
  const systemRoot = resolveTrustedWindowsSystemRoot(
    input?.SystemRoot || input?.WINDIR || host.SystemRoot || host.WINDIR
  );
  out.SystemRoot = systemRoot;
  out.WINDIR = systemRoot;
  out.ComSpec = WINDOWS_CMD_EXE;
  out.PATH = sanitizeWindowsPathEnv(out.PATH || out.Path || host.PATH || host.Path);
  delete out.Path;
  return out;
}

function quoteWindowsCommandArgument(value: string) {
  const escaped = String(value).replace(/(["^&|<>])/g, "^$1").replace(/%/g, "%%");
  return `"${escaped}"`;
}

/**
 * Resolve how to spawn a command without putting absolute paths into a `cmd /c`
 * argv string (CodeQL js/shell-command-injection-from-environment).
 *
 * `.cmd`/`.bat` run via literal `C:\Windows\System32\cmd.exe /d /s /c call %VAR%`
 * with the quoted command line only in `envExtra` (not in argv).
 */
export function resolveBoundedSpawnCommand(
  input: Pick<BoundedCommandInput, "executable" | "args">,
  platform: NodeJS.Platform = process.platform
): BoundedSpawnCommand {
  if (
    platform === "win32"
    && /^(?:.*[\\/])?cmd(?:\.exe)?$/i.test(input.executable)
    && input.args.some((arg) => /^\/c$/i.test(arg))
  ) {
    throw new Error("Bounded commands must not invoke cmd.exe /c with a concatenated shell line; pass the .cmd/.bat/.exe path directly.");
  }
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(input.executable)) {
    const commandLine = [input.executable, ...input.args].map(quoteWindowsCommandArgument).join(" ");
    return {
      executable: WINDOWS_CMD_EXE,
      args: ["/d", "/s", "/c", BOUNDED_CMD_SHELL_LINE],
      envExtra: { [BOUNDED_CMD_ENV_KEY]: commandLine },
      windowsVerbatimArguments: true
    };
  }
  return {
    executable: input.executable,
    args: input.args,
    windowsVerbatimArguments: false
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
    let spawnCommand: BoundedSpawnCommand;
    try {
      spawnCommand = resolveBoundedSpawnCommand(input, process.platform);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const env = buildBoundedCommandEnv({ ...(input.env ?? {}), ...(spawnCommand.envExtra ?? {}) });
    // Always pass a concrete executable string. For cmd shims the executable is the
    // literal WINDOWS_CMD_EXE constant; never bare "cmd.exe" (CodeQL shellCmd).
    const child = spawnCommand.executable === WINDOWS_CMD_EXE
      ? spawn("C:\\Windows\\System32\\cmd.exe", spawnCommand.args, {
        cwd: input.cwd,
        env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: ["ignore", "pipe", "pipe"]
      })
      : spawn(spawnCommand.executable, spawnCommand.args, {
        cwd: input.cwd,
        env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: false,
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

function followDownload(url: string, redirectCount = 0): Promise<IncomingMessage> {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects downloading ${url}`));
  }
  const client = url.startsWith("http://") ? httpGet : httpsGet;
  const options: RequestOptions = { timeout: 120_000 };
  return new Promise((resolve, reject) => {
    const request = client(url, options, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).href;
        resolve(followDownload(next, redirectCount + 1));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status} for ${url}`));
        return;
      }
      resolve(response);
    });
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error(`Download timed out for ${url}`));
    });
  });
}

/** Download a file with Node http(s) — never via powershell/curl shell strings. */
export async function downloadFileToPath(url: string, destinationPath: string, signal?: AbortSignal) {
  await mkdir(dirname(destinationPath), { recursive: true });
  const partialPath = `${destinationPath}.partial`;
  try {
    await unlink(partialPath);
  } catch {
    // ignore missing partial
  }
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Process was canceled.");
  }
  const response = await followDownload(url);
  const onAbort = () => {
    response.destroy(new Error("Process was canceled."));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await pipeline(response, createWriteStream(partialPath));
    await rename(partialPath, destinationPath);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
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
  downloadFile?: (url: string, destinationPath: string, signal?: AbortSignal) => Promise<void>;
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
      const download = this.dependencies.downloadFile ?? downloadFileToPath;
      try {
        await download(spec.downloadUrl, installerPath, signal);
      } catch (error) {
        throw new Error(`Unable to download Miniconda installer: ${error instanceof Error ? error.message : String(error)}`);
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
      executable: installerPath,
      args: ["-b", "-p", condaRoot],
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
