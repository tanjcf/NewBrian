import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** NSIS --updated renames the previous tree into %TEMP%\\nsn*|nsm*|nss*\\*.tmp\\old-install. */
const TEMP_OLD_INSTALL_RE =
  /[\\/]Temp[\\/]ns[nms][^\\/]*[\\/][^\\/]*[\\/]?old-install[\\/]|[\\/]old-install[\\/]/i;

export function isTempNsisOldInstallPath(filePath: string): boolean {
  const value = String(filePath || "");
  if (!value) return false;
  return TEMP_OLD_INSTALL_RE.test(value.replace(/\//g, "\\"));
}

/**
 * Prefer the real per-user install when a Temp\\*\\old-install copy is running.
 * Holding the single-instance lock from old-install makes Desktop shortcuts appear dead.
 */
export function resolveCanonicalNewBrainExecutable(input: {
  execPath: string;
  localAppData?: string;
}): string | null {
  const execPath = String(input.execPath || "").trim();
  if (!execPath) return null;
  if (!isTempNsisOldInstallPath(execPath)) return execPath;
  const localAppData = String(input.localAppData || process.env.LOCALAPPDATA || "").trim();
  const candidates = [
    localAppData ? join(localAppData, ".newbrain", "NewBrain.exe") : "",
    localAppData ? join(localAppData, ".newbrain", "newbrain.exe") : "",
    localAppData ? join(localAppData, "Programs", "@codex-forgedesktop", "NewBrain.exe") : ""
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate) && !isTempNsisOldInstallPath(candidate)) {
      return candidate;
    }
  }
  // Last resort: sibling of preferred install root if somehow still present.
  const sibling = join(dirname(execPath), "..", "..", "..", ".newbrain", "NewBrain.exe");
  if (existsSync(sibling) && !isTempNsisOldInstallPath(sibling)) return sibling;
  return null;
}
