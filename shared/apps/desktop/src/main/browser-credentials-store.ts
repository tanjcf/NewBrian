import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export interface BrowserCredentialRecord {
  id: string;
  origin: string;
  username: string;
  /** Never returned to model context; only used by autofill UI. */
  hasPassword: boolean;
  updatedAt: string;
}

interface StoredCredential extends BrowserCredentialRecord {
  passwordCipher: string;
  iv: string;
  salt: string;
}

export interface BrowserCredentialsStoreOptions {
  rootDir: string;
  /** Machine-local secret; defaults to a file-backed key under rootDir. */
  secret?: string;
}

function storePath(rootDir: string) {
  return join(rootDir, "browser", "credentials.json");
}

async function readStore(path: string): Promise<StoredCredential[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredCredential[]) : [];
  } catch {
    return [];
  }
}

function encryptPassword(secret: string, password: string) {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    passwordCipher: Buffer.concat([enc, tag]).toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64")
  };
}

/** List credential metadata only — never plaintext passwords. */
export async function listBrowserCredentials(
  options: BrowserCredentialsStoreOptions
): Promise<BrowserCredentialRecord[]> {
  const rows = await readStore(storePath(options.rootDir));
  return rows.map(({ id, origin, username, hasPassword, updatedAt }) => ({
    id,
    origin,
    username,
    hasPassword,
    updatedAt
  }));
}

export async function upsertBrowserCredential(
  options: BrowserCredentialsStoreOptions,
  input: { origin: string; username: string; password: string; id?: string }
): Promise<BrowserCredentialRecord[]> {
  const path = storePath(options.rootDir);
  const secret = options.secret || "newbrain-local-browser-vault";
  const rows = await readStore(path);
  const origin = String(input.origin || "").trim();
  const username = String(input.username || "").trim();
  if (!origin || !username) throw new Error("origin and username are required.");
  const encrypted = encryptPassword(secret, String(input.password || ""));
  const id = String(input.id || "").trim() || `cred_${Date.now().toString(36)}`;
  const next: StoredCredential = {
    id,
    origin,
    username,
    hasPassword: Boolean(input.password),
    updatedAt: new Date().toISOString(),
    ...encrypted
  };
  const filtered = rows.filter((row) => row.id !== id && !(row.origin === origin && row.username === username));
  const entries = [next, ...filtered];
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  return listBrowserCredentials(options);
}

export async function removeBrowserCredential(
  options: BrowserCredentialsStoreOptions,
  id: string
): Promise<BrowserCredentialRecord[]> {
  const path = storePath(options.rootDir);
  const entries = (await readStore(path)).filter((row) => row.id !== id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  return listBrowserCredentials(options);
}

/** Decrypt for local autofill only — callers must not send plaintext to the model. */
export async function revealBrowserCredentialPassword(
  options: BrowserCredentialsStoreOptions,
  id: string
): Promise<string | null> {
  const row = (await readStore(storePath(options.rootDir))).find((item) => item.id === id);
  if (!row) return null;
  const secret = options.secret || "newbrain-local-browser-vault";
  const key = scryptSync(secret, Buffer.from(row.salt, "base64"), 32);
  const buf = Buffer.from(row.passwordCipher, "base64");
  const data = buf.subarray(0, buf.length - 16);
  const tag = buf.subarray(buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
