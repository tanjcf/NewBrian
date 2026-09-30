import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface BrowserHistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
}

export interface BrowserHistoryStoreOptions {
  rootDir: string;
  maxEntries?: number;
}

function historyPath(rootDir: string) {
  return join(rootDir, "browser", "history.json");
}

async function readEntries(path: string): Promise<BrowserHistoryEntry[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is BrowserHistoryEntry => Boolean(item && typeof item === "object"))
      .map((item) => ({
        id: String((item as BrowserHistoryEntry).id || ""),
        url: String((item as BrowserHistoryEntry).url || ""),
        title: String((item as BrowserHistoryEntry).title || ""),
        visitedAt: String((item as BrowserHistoryEntry).visitedAt || "")
      }))
      .filter((item) => item.id && item.url);
  } catch {
    return [];
  }
}

async function writeEntries(path: string, entries: BrowserHistoryEntry[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

/** Append or refresh a visited URL in the local Browser Use history file. */
export async function recordBrowserHistoryVisit(
  options: BrowserHistoryStoreOptions,
  input: { url: string; title?: string }
): Promise<BrowserHistoryEntry[]> {
  const path = historyPath(options.rootDir);
  const maxEntries = options.maxEntries ?? 500;
  const url = String(input.url || "").trim();
  if (!url) return readEntries(path);
  const now = new Date().toISOString();
  const existing = await readEntries(path);
  const next: BrowserHistoryEntry = {
    id: `hist_${Buffer.from(url).toString("base64url").slice(0, 24)}_${Date.now().toString(36)}`,
    url,
    title: String(input.title || "").trim() || url,
    visitedAt: now
  };
  const filtered = existing.filter((item) => item.url !== url);
  const entries = [next, ...filtered].slice(0, maxEntries);
  await writeEntries(path, entries);
  return entries;
}

export async function listBrowserHistory(options: BrowserHistoryStoreOptions): Promise<BrowserHistoryEntry[]> {
  return readEntries(historyPath(options.rootDir));
}

export async function clearBrowserHistory(options: BrowserHistoryStoreOptions): Promise<void> {
  await writeEntries(historyPath(options.rootDir), []);
}

export async function removeBrowserHistoryEntry(
  options: BrowserHistoryStoreOptions,
  id: string
): Promise<BrowserHistoryEntry[]> {
  const path = historyPath(options.rootDir);
  const entries = (await readEntries(path)).filter((item) => item.id !== id);
  await writeEntries(path, entries);
  return entries;
}
