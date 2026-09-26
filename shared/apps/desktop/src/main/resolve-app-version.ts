import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ResolveAppVersionInput = {
  getAppPath: () => string;
  getVersion: () => string;
  readFileSync?: (path: string, encoding: BufferEncoding) => string;
  joinPath?: (...parts: string[]) => string;
};

/**
 * Prefer package.json under app.getAppPath() so Windows ulit/asar patches report
 * the patched app version instead of the stale exe FileVersion from app.getVersion().
 */
export function resolveAppVersion(input: ResolveAppVersionInput): string {
  const joinPath = input.joinPath ?? join;
  const readFile = input.readFileSync ?? readFileSync;
  try {
    const packageJsonPath = joinPath(input.getAppPath(), "package.json");
    const raw = readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string") {
      const version = parsed.version.trim();
      if (version.length > 0) {
        return version;
      }
    }
  } catch {
    // Fall back to Electron's version (exe FileVersion on Windows).
  }
  return input.getVersion();
}

/** Resolve the running desktop app version from an Electron app-like object. */
export function resolveElectronAppVersion(electronApp: {
  getAppPath(): string;
  getVersion(): string;
}): string {
  return resolveAppVersion({
    getAppPath: () => electronApp.getAppPath(),
    getVersion: () => electronApp.getVersion()
  });
}
