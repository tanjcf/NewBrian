import { createHash, createPublicKey, verify } from "node:crypto";
import JSZip from "jszip";

export class PluginPackageError extends Error {
  readonly code: string;

  constructor(code: string, detail: string) {
    super(code + ": " + detail);
    this.name = "PluginPackageError";
    this.code = code;
  }
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanHash(value: string) {
  return value.trim().replace(/^sha256:/i, "").toLowerCase();
}

function unsafePath(value: string) {
  const normalized = value.replace(/\\/g, "/");
  return normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").some((part) => part === ".." || part === "")
    || normalized.includes("\0");
}

export async function verifyPluginPackage(input: {
  bytes: Uint8Array;
  hash: string;
  signature: string;
  publicKey: string;
  pluginKey: string;
  version: string;
  maxEntries?: number;
  maxExtractedBytes?: number;
}) {
  const actualHash = sha256Hex(input.bytes);
  if (actualHash !== cleanHash(input.hash)) {
    throw new PluginPackageError("PLUGIN_HASH_MISMATCH", "downloaded archive hash does not match manifest");
  }
  let signatureValid = false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(input.publicKey, "base64"),
      format: "der",
      type: "spki"
    });
    signatureValid = verify(null, Buffer.from(actualHash, "utf8"), publicKey, Buffer.from(input.signature.replace(/^ed25519:/i, ""), "base64"));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new PluginPackageError("PLUGIN_SIGNATURE_INVALID", "Ed25519 signature verification failed");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input.bytes, { createFolders: true });
  } catch {
    throw new PluginPackageError("PLUGIN_ARCHIVE_UNSAFE", "archive cannot be parsed");
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > (input.maxEntries ?? 2048)) {
    throw new PluginPackageError("PLUGIN_ARCHIVE_UNSAFE", "archive contains too many files");
  }
  const seen = new Set<string>();
  let extractedBytes = 0;
  for (const entry of entries) {
    const original = String((entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name);
    if (unsafePath(original) || unsafePath(entry.name) || seen.has(entry.name.toLowerCase())) {
      throw new PluginPackageError("PLUGIN_ARCHIVE_UNSAFE", "archive contains an unsafe or duplicate path");
    }
    seen.add(entry.name.toLowerCase());
    const content = await entry.async("uint8array");
    extractedBytes += content.byteLength;
    if (extractedBytes > (input.maxExtractedBytes ?? 64 * 1024 * 1024)) {
      throw new PluginPackageError("PLUGIN_ARCHIVE_UNSAFE", "archive expands beyond the configured limit");
    }
  }

  const manifestEntry = zip.file(".codex-plugin/plugin.json");
  if (!manifestEntry) {
    throw new PluginPackageError("PLUGIN_MANIFEST_INVALID", "missing .codex-plugin/plugin.json");
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await manifestEntry.async("string")) as Record<string, unknown>;
  } catch {
    throw new PluginPackageError("PLUGIN_MANIFEST_INVALID", "plugin manifest is not valid JSON");
  }
  if (manifest.name !== input.pluginKey || manifest.version !== input.version || manifest.skills !== "./skills/") {
    throw new PluginPackageError("PLUGIN_MANIFEST_INVALID", "plugin identity or skills path does not match the signed release");
  }
  const skillNames = [...new Set(entries
    .map((entry) => /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.name)?.[1])
    .filter((value): value is string => Boolean(value)))].sort();
  if (skillNames.length === 0) {
    throw new PluginPackageError("PLUGIN_MANIFEST_INVALID", "plugin contains no executable skills");
  }
  return { zip, manifest, skillNames, contentHash: actualHash };
}
