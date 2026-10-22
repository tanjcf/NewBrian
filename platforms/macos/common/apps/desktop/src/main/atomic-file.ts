import fs from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const writeQueues = new Map<string, Promise<void>>();

export function durableBackupPath(filePath: string) {
  return `${filePath}.bak`;
}

async function replaceTextFile(filePath: string, content: string) {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const lastGoodPath = durableBackupPath(filePath);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(temporaryPath, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      const current = await fs.stat(filePath);
      if (current.size > 0) {
        await fs.copyFile(filePath, lastGoodPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Rename-over is atomic on the same volume and never leaves the primary path missing.
    // The previous move-aside + rename-in sequence created an ENOENT window that made
    // readWorkspaceCatalog recreate/write the catalog in a loop.
    await fs.rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export function writeTextAtomically(filePath: string, content: string) {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => replaceTextFile(filePath, content));
  writeQueues.set(filePath, current);
  return current.finally(() => {
    if (writeQueues.get(filePath) === current) writeQueues.delete(filePath);
  });
}

/** Write recovered bytes over a missing/empty file without clobbering the last-good `.bak`. */
export async function restoreTextFile(filePath: string, content: string) {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.restore.tmp`;
  await fs.writeFile(temporaryPath, content, "utf8");
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function readTextWithTransientRetry(filePath: string, attempts = 5) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 * attempt));
    }
  }
  throw lastError;
}

function isSidecarName(baseName: string, name: string) {
  if (name === baseName) return false;
  return name === `${baseName}.bak` || name.startsWith(`${baseName}.`);
}

/** Recover file text from leftover `.bak` / `.tmp` / `.old` / `.corrupt-*` sidecars after a crash. */
export async function recoverDurableText(filePath: string) {
  const directory = dirname(filePath);
  const baseName = basename(filePath);
  let names: string[] = [];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const candidates = await Promise.all(
    names.filter((name) => isSidecarName(baseName, name)).map(async (name) => {
      const candidatePath = join(directory, name);
      try {
        const stat = await fs.stat(candidatePath);
        return stat.isFile() && stat.size > 0
          ? { path: candidatePath, mtimeMs: stat.mtimeMs, size: stat.size }
          : null;
      } catch {
        return null;
      }
    })
  );
  const ranked = candidates
    .filter((item): item is { path: string; mtimeMs: number; size: number } => Boolean(item))
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.size - left.size);
  for (const candidate of ranked) {
    try {
      const raw = await fs.readFile(candidate.path, "utf8");
      if (raw.trim()) return raw;
    } catch {
      // try next sidecar
    }
  }
  return null;
}

export async function readTextWithDurableFallback(filePath: string) {
  try {
    const raw = await readTextWithTransientRetry(filePath);
    if (raw.trim()) return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const recovered = await recoverDurableText(filePath);
  if (recovered != null) return recovered;
  const missing = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
  missing.code = "ENOENT";
  throw missing;
}
