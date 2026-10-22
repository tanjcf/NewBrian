import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, normalize } from "node:path";
import type { PluginInstallState, PluginOperationResult } from "@codex-forge/protocol";
import type { PluginInstallationReport, PluginManifest } from "./plugin-repository-client.js";
import {
  migrateRepositoryPluginUserData,
  removeRepositoryPluginVersionDir
} from "./repository-plugin-user-data.ts";
type AtomicFileModule = typeof import("./atomic-file.js");
type PluginVerifierModule = typeof import("./plugin-package-verifier.js");
const loadAtomicFile = () => import(new URL("./atomic-file.ts", import.meta.url).href) as Promise<AtomicFileModule>;
const loadPluginVerifier = () => import(new URL("./plugin-package-verifier.ts", import.meta.url).href) as Promise<PluginVerifierModule>;

interface InstalledPlugin {
  plugin_key: string;
  version: string;
  content_hash: string;
  state: PluginInstallState;
  enabled: boolean;
  updated_at: string;
}

interface StateFile {
  schema_version: 1;
  plugins: Record<string, InstalledPlugin>;
}

export class PluginInstallationService {
  private readonly root: string;
  private readonly client: {
    manifest(pluginKey: string, version?: string): Promise<PluginManifest>;
    download(pluginKey: string, version: string): Promise<{ bytes: Uint8Array; contentHash: string; signature: string }>;
    report(deviceId: string, pluginKey: string, report: PluginInstallationReport): Promise<unknown>;
  };
  private readonly deviceId: string;
  private readonly clientVersion: string;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly readTextWithTransientRetry: AtomicFileModule["readTextWithTransientRetry"];
  private readonly writeTextAtomically: AtomicFileModule["writeTextAtomically"];
  private readonly verifyPluginPackage: PluginVerifierModule["verifyPluginPackage"];

  constructor(input: {
    root: string;
    client: PluginInstallationService["client"];
    deviceId: string;
    clientVersion: string;
    dependencies?: {
      readTextWithTransientRetry: AtomicFileModule["readTextWithTransientRetry"];
      writeTextAtomically: AtomicFileModule["writeTextAtomically"];
      verifyPluginPackage: PluginVerifierModule["verifyPluginPackage"];
    };
  }) {
    this.root = input.root;
    this.client = input.client;
    this.deviceId = input.deviceId;
    this.clientVersion = input.clientVersion;
    this.readTextWithTransientRetry = input.dependencies?.readTextWithTransientRetry
      ?? (async (...args) => (await loadAtomicFile()).readTextWithTransientRetry(...args));
    this.writeTextAtomically = input.dependencies?.writeTextAtomically
      ?? (async (...args) => (await loadAtomicFile()).writeTextAtomically(...args));
    this.verifyPluginPackage = input.dependencies?.verifyPluginPackage
      ?? (async (...args) => (await loadPluginVerifier()).verifyPluginPackage(...args));
  }

  install(pluginKey: string, version = "") {
    return this.serial(pluginKey, async () => {
      this.requireKey(pluginKey);
      const operationId = randomUUID();
      const state = await this.readState();
      const previous = state.plugins[pluginKey];
      const previousVersion = previous && previous.state !== "removed" ? String(previous.version || "").trim() : "";
      const manifest = await this.client.manifest(pluginKey, version);
      const downloaded = await this.client.download(pluginKey, manifest.version);
      const verified = await this.verifyPluginPackage({
        bytes: downloaded.bytes,
        hash: manifest.content_hash,
        signature: manifest.signature || downloaded.signature,
        publicKey: manifest.signing_public_key,
        pluginKey,
        version: manifest.version
      });
      const staging = join(this.root, "staging", operationId);
      const target = join(this.root, "packages", pluginKey, manifest.version);
      const isSameVersion = previousVersion === manifest.version;
      const preserveEnabled = previous?.enabled ?? true;
      try {
        await fs.rm(staging, { recursive: true, force: true });
        await fs.mkdir(staging, { recursive: true });
        for (const entry of Object.values(verified.zip.files)) {
          if (entry.dir) continue;
          const destination = join(staging, ...entry.name.split("/"));
          if (!normalize(destination).startsWith(normalize(staging + "\\"))) throw new Error("PLUGIN_ARCHIVE_UNSAFE");
          await fs.mkdir(dirname(destination), { recursive: true });
          await fs.writeFile(destination, await entry.async("nodebuffer"));
        }
        if (previousVersion && previousVersion !== manifest.version) {
          await migrateRepositoryPluginUserData({
            pluginsRoot: this.root,
            pluginKey,
            previousVersion,
            targetPackageDir: staging
          });
        } else if (isSameVersion) {
          await migrateRepositoryPluginUserData({
            pluginsRoot: this.root,
            pluginKey,
            targetPackageDir: staging
          });
        }
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.rm(target, { recursive: true, force: true });
        await fs.rename(staging, target);
        if (previousVersion && previousVersion !== manifest.version) {
          await removeRepositoryPluginVersionDir({ pluginsRoot: this.root, pluginKey, version: previousVersion });
        }
        state.plugins[pluginKey] = {
          plugin_key: pluginKey,
          version: manifest.version,
          content_hash: verified.contentHash,
          state: preserveEnabled ? "installed" : "disabled",
          enabled: preserveEnabled,
          updated_at: new Date().toISOString()
        };
        await this.writeState(state);
        await this.report(pluginKey, state.plugins[pluginKey]);
        return this.result(state.plugins[pluginKey]);
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  setEnabled(pluginKey: string, enabled: boolean) {
    return this.serial(pluginKey, async () => {
      const state = await this.readState();
      const item = state.plugins[pluginKey];
      if (!item || item.state === "removed") throw new Error("PLUGIN_NOT_FOUND: plugin is not installed");
      item.enabled = enabled;
      item.state = enabled ? "installed" : "disabled";
      item.updated_at = new Date().toISOString();
      await this.writeState(state);
      await this.report(pluginKey, item);
      return this.result(item);
    });
  }

  remove(pluginKey: string) {
    return this.serial(pluginKey, async () => {
      const state = await this.readState();
      const item = state.plugins[pluginKey];
      if (!item) throw new Error("PLUGIN_NOT_FOUND: plugin is not installed");
      const source = join(this.root, "packages", pluginKey, item.version);
      const trash = join(this.root, "trash", pluginKey + "-" + randomUUID());
      await fs.mkdir(dirname(trash), { recursive: true });
      await fs.rename(source, trash).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      item.state = "removed";
      item.enabled = false;
      item.updated_at = new Date().toISOString();
      await this.writeState(state);
      await this.report(pluginKey, item);
      await fs.rm(trash, { recursive: true, force: true }).catch(() => undefined);
      return this.result(item);
    });
  }

  async snapshot() {
    return (await this.readState()).plugins;
  }

  async getInstalled(pluginKey: string) {
    this.requireKey(pluginKey);
    const item = (await this.readState()).plugins[pluginKey];
    if (!item || item.state === "removed") return null;
    return item;
  }

  private report(pluginKey: string, item: InstalledPlugin) {
    const status = item.state === "disabled" || item.state === "removed" ? item.state : "installed";
    return this.client.report(this.deviceId, pluginKey, {
      status,
      version: item.version,
      content_hash: item.content_hash,
      client_version: this.clientVersion,
      reported_at: new Date().toISOString()
    });
  }

  private result(item: InstalledPlugin): PluginOperationResult {
    return { ok: true, pluginKey: item.plugin_key, state: item.state, version: item.version };
  }

  private async readState(): Promise<StateFile> {
    try {
      const parsed = JSON.parse(await this.readTextWithTransientRetry(join(this.root, "installed.json"), 1)) as StateFile;
      if (parsed.schema_version !== 1 || !parsed.plugins || typeof parsed.plugins !== "object") throw new Error("invalid state");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("PLUGIN_STATE_INVALID: local plugin state is corrupt");
      return { schema_version: 1, plugins: {} };
    }
  }

  private writeState(state: StateFile) {
    return this.writeTextAtomically(join(this.root, "installed.json"), JSON.stringify(state, null, 2) + "\n");
  }

  private serial<T>(pluginKey: string, operation: () => Promise<T>) {
    const previous = this.queues.get(pluginKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(pluginKey, current);
    return current.finally(() => {
      if (this.queues.get(pluginKey) === current) this.queues.delete(pluginKey);
    });
  }

  private requireKey(pluginKey: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,126}[a-z0-9]$/.test(pluginKey)) throw new Error("PLUGIN_KEY_INVALID");
  }
}
