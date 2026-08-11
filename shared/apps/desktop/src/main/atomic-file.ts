import fs from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const writeQueues = new Map<string, Promise<void>>();

async function replaceTextFile(filePath: string, content: string) {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const backupPath = `${filePath}.${process.pid}.${randomUUID()}.bak`;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  let backedUp = false;
  try {
    handle = await fs.open(temporaryPath, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fs.rename(filePath, backupPath);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.rename(temporaryPath, filePath);
    if (backedUp) await fs.unlink(backupPath).catch(() => undefined);
    backedUp = false;
  } catch (error) {
    if (backedUp) await fs.rename(backupPath, filePath).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporaryPath).catch(() => undefined);
    await fs.unlink(backupPath).catch(() => undefined);
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
