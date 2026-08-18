import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter } from "node:path";

export interface SystemPathEnvDependencies {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  shell?: string;
  timeoutMs?: number;
  pathHelperExists?: boolean;
  spawn: (
    command: string,
    args: string[],
    options: {
      encoding: "utf8";
      timeout: number;
      env: NodeJS.ProcessEnv;
      windowsHide?: boolean;
    }
  ) => Pick<SpawnSyncReturns<string>, "status" | "stdout" | "stderr" | "error">;
}

const DEFAULT_DARWIN_PATH_HINTS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
];

function splitPath(value: string | undefined, pathDelimiter = delimiter) {
  return String(value || "")
    .split(pathDelimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniquePreserveOrder(entries: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const key = entry;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function parsePathHelperExport(stdout: string) {
  const match = String(stdout || "").match(/PATH="([^"]*)"/);
  return match?.[1] ?? "";
}

/** Read PATH from a login interactive shell so GUI apps inherit user profile paths. */
export function readLoginShellPath(dependencies: SystemPathEnvDependencies) {
  if (dependencies.platform !== "darwin" && dependencies.platform !== "linux") {
    return dependencies.environment.PATH?.trim() || "";
  }
  const shell =
    dependencies.shell?.trim() ||
    dependencies.environment.SHELL?.trim() ||
    (dependencies.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  const result = dependencies.spawn(shell, ["-ilc", 'printf %s "$PATH"'], {
    encoding: "utf8",
    timeout: dependencies.timeoutMs ?? 5_000,
    env: {
      ...dependencies.environment,
      TERM: "dumb",
      HOME: dependencies.environment.HOME || dependencies.homeDirectory,
      LANG: dependencies.environment.LANG || "en_US.UTF-8"
    },
    windowsHide: true
  });
  if (result.error || result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

/** Read PATH assembled by macOS path_helper (/etc/paths, /etc/paths.d). */
export function readPathHelperPath(dependencies: SystemPathEnvDependencies) {
  if (dependencies.platform !== "darwin") return "";
  const helperExists =
    typeof dependencies.pathHelperExists === "boolean"
      ? dependencies.pathHelperExists
      : existsSync("/usr/libexec/path_helper");
  if (!helperExists) return "";
  const result = dependencies.spawn("/usr/libexec/path_helper", ["-s"], {
    encoding: "utf8",
    timeout: dependencies.timeoutMs ?? 5_000,
    env: {
      ...dependencies.environment,
      HOME: dependencies.environment.HOME || dependencies.homeDirectory
    },
    windowsHide: true
  });
  if (result.error || result.status !== 0) return "";
  return parsePathHelperExport(String(result.stdout || "")).trim();
}

export function collectDarwinPathHints(homeDirectory: string) {
  const home = homeDirectory.trim();
  return [
    ...DEFAULT_DARWIN_PATH_HINTS,
    home ? `${home}/.local/bin` : "",
    home ? `${home}/.cargo/bin` : "",
    home ? `${home}/bin` : ""
  ].filter(Boolean);
}

/**
 * Resolve a usable PATH for child processes.
 * Prefer login-shell PATH (user + Homebrew), then path_helper, then process PATH, then hints.
 */
export function resolveSystemPath(dependencies: SystemPathEnvDependencies) {
  const pathDelimiter = dependencies.platform === "win32" ? ";" : ":";
  const current = splitPath(dependencies.environment.PATH, pathDelimiter);
  if (dependencies.platform === "win32") {
    return uniquePreserveOrder(current).join(pathDelimiter);
  }

  const loginShellPath = splitPath(readLoginShellPath(dependencies), ":");
  const helperPath = splitPath(readPathHelperPath(dependencies), ":");
  const hints =
    dependencies.platform === "darwin"
      ? collectDarwinPathHints(dependencies.homeDirectory).filter((entry) => existsSync(entry))
      : [];

  return uniquePreserveOrder([...loginShellPath, ...helperPath, ...hints, ...current]).join(":");
}

export function mergeEnvWithSystemPath(
  environment: NodeJS.ProcessEnv,
  systemPath: string
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string") next[key] = value;
  }
  if (systemPath.trim()) next.PATH = systemPath.trim();
  return next;
}

/** Mutate process.env.PATH so Electron child processes inherit the resolved system PATH. */
export function applySystemPathToProcessEnv(
  dependencies: Omit<SystemPathEnvDependencies, "environment"> & {
    environment?: NodeJS.ProcessEnv;
  } = {
    platform: process.platform,
    homeDirectory: homedir(),
    spawn: spawnSync
  }
) {
  const environment = dependencies.environment ?? process.env;
  const resolved = resolveSystemPath({
    platform: dependencies.platform,
    environment,
    homeDirectory: dependencies.homeDirectory,
    shell: dependencies.shell,
    timeoutMs: dependencies.timeoutMs,
    spawn: dependencies.spawn ?? spawnSync
  });
  if (resolved.trim()) {
    process.env.PATH = resolved;
  }
  return resolved;
}

export function createDefaultSystemPathDependencies(
  overrides: Partial<SystemPathEnvDependencies> = {}
): SystemPathEnvDependencies {
  return {
    platform: process.platform,
    environment: process.env,
    homeDirectory: homedir(),
    timeoutMs: 5_000,
    spawn: spawnSync,
    ...overrides
  };
}
