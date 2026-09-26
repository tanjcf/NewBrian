import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Local contacts for Browser Use autofill — never sent to model context. */
export interface BrowserContactRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  updatedAt: string;
}

export interface BrowserContactsStoreOptions {
  rootDir: string;
}

function storePath(rootDir: string) {
  return join(rootDir, "browser", "contacts.json");
}

async function readStore(path: string): Promise<BrowserContactRecord[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is BrowserContactRecord => Boolean(item && typeof item === "object"))
      .map((item) => ({
        id: String(item.id || ""),
        name: String(item.name || "").trim(),
        email: String(item.email || "").trim(),
        phone: String(item.phone || "").trim(),
        updatedAt: String(item.updatedAt || "")
      }))
      .filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

export async function listBrowserContacts(
  options: BrowserContactsStoreOptions
): Promise<BrowserContactRecord[]> {
  return readStore(storePath(options.rootDir));
}

export async function upsertBrowserContact(
  options: BrowserContactsStoreOptions,
  input: { id?: string; name: string; email?: string; phone?: string }
): Promise<BrowserContactRecord[]> {
  const path = storePath(options.rootDir);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Contact name is required.");
  const rows = await readStore(path);
  const id = String(input.id || "").trim() || `contact_${Date.now().toString(36)}`;
  const next: BrowserContactRecord = {
    id,
    name,
    email: String(input.email || "").trim(),
    phone: String(input.phone || "").trim(),
    updatedAt: new Date().toISOString()
  };
  const entries = [next, ...rows.filter((row) => row.id !== id)];
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  return entries;
}

export async function removeBrowserContact(
  options: BrowserContactsStoreOptions,
  id: string
): Promise<BrowserContactRecord[]> {
  const path = storePath(options.rootDir);
  const entries = (await readStore(path)).filter((row) => row.id !== id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  return entries;
}
