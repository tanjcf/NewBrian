import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Relative directories inside a plugin package that may contain user-owned state. */
export const REPOSITORY_PLUGIN_USER_DATA_DIRS = [".user", "data", "user-data", ".local", "state"] as const;

export function repositoryPluginUserDataRoot(pluginsRoot: string, pluginKey: string) {
  return join(pluginsRoot, "user", pluginKey);
}

async function exists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function mergeDirectoryContents(source: string, destination: string) {
  const stat = await fs.stat(source);
  if (stat.isFile()) {
    await fs.mkdir(dirname(destination), { recursive: true });
    if (!(await exists(destination))) {
      await fs.copyFile(source, destination);
    }
    return;
  }
  if (!stat.isDirectory()) return;
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    await mergeDirectoryContents(join(source, entry.name), join(destination, entry.name));
  }
}

/**
 * On upgrade, lift version-scoped user dirs into a stable store, then overlay them
 * onto the freshly extracted package without overwriting newly shipped files.
 */
export async function migrateRepositoryPluginUserData(input: {
  pluginsRoot: string;
  pluginKey: string;
  previousVersion?: string;
  targetPackageDir: string;
}) {
  const userRoot = repositoryPluginUserDataRoot(input.pluginsRoot, input.pluginKey);
  await fs.mkdir(userRoot, { recursive: true });

  const previousVersion = String(input.previousVersion || "").trim();
  if (previousVersion) {
    const previousPackageDir = join(input.pluginsRoot, "packages", input.pluginKey, previousVersion);
    for (const dirName of REPOSITORY_PLUGIN_USER_DATA_DIRS) {
      const legacy = join(previousPackageDir, dirName);
      if (await exists(legacy)) {
        await mergeDirectoryContents(legacy, join(userRoot, dirName));
      }
    }
  }

  for (const dirName of REPOSITORY_PLUGIN_USER_DATA_DIRS) {
    const slice = join(userRoot, dirName);
    if (await exists(slice)) {
      await mergeDirectoryContents(slice, join(input.targetPackageDir, dirName));
    }
  }
}

export async function removeRepositoryPluginVersionDir(input: {
  pluginsRoot: string;
  pluginKey: string;
  version: string;
}) {
  const version = String(input.version || "").trim();
  if (!version) return;
  await fs.rm(join(input.pluginsRoot, "packages", input.pluginKey, version), { recursive: true, force: true }).catch(() => undefined);
}
