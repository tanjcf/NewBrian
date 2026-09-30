import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  normalizeBrowserAgentPermissionException,
  type BrowserAgentPermissionException
} from "./browser-agent-policy.ts";

/**
 * Optional Codex-style side file for agent origin exceptions:
 * `%userData%/browser/permissions.json`
 */

export interface BrowserPermissionsFile {
  exceptions: BrowserAgentPermissionException[];
  updatedAt: string;
}

function permissionsPath(rootDir: string) {
  return join(rootDir, "browser", "permissions.json");
}

const FALLBACK_EXCEPTION: BrowserAgentPermissionException = {
  origin: "http://127.0.0.1:8765",
  browse: "always_allow",
  download: "require_approval",
  upload: "require_approval"
};

export async function readBrowserPermissionsFile(
  rootDir: string
): Promise<BrowserPermissionsFile | null> {
  try {
    const raw = await readFile(permissionsPath(rootDir), "utf8");
    const parsed = JSON.parse(raw) as { exceptions?: unknown; updatedAt?: unknown };
    const exceptions = Array.isArray(parsed.exceptions)
      ? parsed.exceptions
          .map((item) => normalizeBrowserAgentPermissionException(item, FALLBACK_EXCEPTION))
          .filter((item): item is BrowserAgentPermissionException => Boolean(item))
      : [];
    return {
      exceptions,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export async function writeBrowserPermissionsFile(
  rootDir: string,
  exceptions: BrowserAgentPermissionException[]
): Promise<BrowserPermissionsFile> {
  const path = permissionsPath(rootDir);
  const payload: BrowserPermissionsFile = {
    exceptions: exceptions
      .map((item) => normalizeBrowserAgentPermissionException(item, FALLBACK_EXCEPTION))
      .filter((item): item is BrowserAgentPermissionException => Boolean(item)),
    updatedAt: new Date().toISOString()
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

/** Prefer side-file exceptions when present; otherwise keep preferences exceptions. */
export async function mergeBrowserPermissionsExceptions(
  rootDir: string,
  preferencesExceptions: BrowserAgentPermissionException[]
): Promise<BrowserAgentPermissionException[]> {
  const file = await readBrowserPermissionsFile(rootDir);
  if (!file) return preferencesExceptions;
  return file.exceptions;
}
