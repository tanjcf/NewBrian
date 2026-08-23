import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PROVIDER_TYPES } from "./capability-contract.js";

export function assertCapabilityPackageManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new TypeError("package manifest must be an object");
  for (const field of ["schemaVersion", "id", "version", "providers", "permissions"]) {
    if (!(field in manifest)) throw new TypeError(`package manifest missing ${field}`);
  }
  if (manifest.schemaVersion !== 2) throw new TypeError("unsupported package schema version");
  if (!/^[a-z][a-z0-9_.-]+$/.test(String(manifest.id))) throw new TypeError("package id is invalid");
  if (!Array.isArray(manifest.providers) || manifest.providers.length === 0) throw new TypeError("package providers are required");
  for (const provider of manifest.providers) {
    if (!provider?.id || !PROVIDER_TYPES.includes(provider.type)) throw new TypeError("package provider is invalid");
  }
  if (!Array.isArray(manifest.permissions)) throw new TypeError("package permissions must be an array");
  return structuredClone(manifest);
}

export async function hashCapabilityPackage(rootPath) {
  const hash = createHash("sha256");
  for (const relativePath of await listFiles(rootPath)) {
    hash.update(relativePath.replaceAll("\\", "/"));
    hash.update(await fs.readFile(path.join(rootPath, relativePath)));
  }
  return hash.digest("hex");
}

async function listFiles(rootPath, relativePath = "") {
  const entries = await fs.readdir(path.join(rootPath, relativePath), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(rootPath, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`unsupported package entry: ${child}`);
  }
  return files;
}
