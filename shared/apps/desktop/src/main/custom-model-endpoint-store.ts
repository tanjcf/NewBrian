import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopSecretVault, DesktopSecretVaultError, type DesktopSecretProtector } from "./desktop-secret-vault.ts";
import {
  CUSTOM_MODEL_ENDPOINT_LIMIT,
  CustomModelEndpointError,
  isCustomModelEndpointId,
  normalizeCustomModelEndpointDraft,
  type CustomModelEndpointDraft,
  type CustomModelEndpointPublic,
  type CustomModelEndpointSnapshot,
  type CustomModelWireApi
} from "../shared/custom-model-endpoint.ts";

interface StoredCustomModelEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  wireApi: CustomModelWireApi;
}

interface CustomModelCatalogFile {
  schemaVersion: 1;
  selectedId: string;
  endpoints: StoredCustomModelEndpoint[];
}

export interface OwnedCustomModelRequest {
  label: string;
  baseUrl: string;
  model: string;
  wireApi: CustomModelWireApi;
  apiKey: string;
}

const EMPTY_CATALOG: CustomModelCatalogFile = {
  schemaVersion: 1,
  selectedId: "",
  endpoints: []
};

/** Stores user-owned OpenAI-compatible endpoints. API keys stay in the OS vault. */
export class CustomModelEndpointStore {
  private readonly directory: string;
  private readonly protector: DesktopSecretProtector;

  constructor(directory: string, protector: DesktopSecretProtector) {
    this.directory = directory;
    this.protector = protector;
  }

  async list(): Promise<CustomModelEndpointSnapshot> {
    const catalog = await this.readCatalog();
    return toSnapshot(catalog);
  }

  async save(draft: CustomModelEndpointDraft): Promise<CustomModelEndpointSnapshot> {
    const normalized = normalizeCustomModelEndpointDraft(draft);
    const catalog = await this.readCatalog();
    if (catalog.endpoints.length >= CUSTOM_MODEL_ENDPOINT_LIMIT) {
      throw new CustomModelEndpointError("CUSTOM_MODEL_LIMIT", "自备模型最多保存 20 个。");
    }
    const endpoint: StoredCustomModelEndpoint = {
      id: `custom:${randomUUID()}`,
      label: normalized.label,
      baseUrl: normalized.baseUrl,
      model: normalized.model,
      wireApi: "chat.completions"
    };
    await this.writeSecret(endpoint.id, normalized.apiKey);
    catalog.endpoints.push(endpoint);
    catalog.selectedId = endpoint.id;
    await this.writeCatalog(catalog);
    return toSnapshot(catalog);
  }

  async delete(id: string): Promise<CustomModelEndpointSnapshot> {
    const endpointId = requireEndpointId(id);
    const catalog = await this.readCatalog();
    const next = catalog.endpoints.filter((item) => item.id !== endpointId);
    if (next.length === catalog.endpoints.length) {
      throw new CustomModelEndpointError("CUSTOM_MODEL_NOT_FOUND", "自备模型不存在或已被删除。");
    }
    catalog.endpoints = next;
    if (catalog.selectedId === endpointId) catalog.selectedId = "";
    await this.writeCatalog(catalog);
    await this.vault(endpointId).remove();
    return toSnapshot(catalog);
  }

  async select(id: string): Promise<CustomModelEndpointSnapshot> {
    const catalog = await this.readCatalog();
    const trimmed = id.trim();
    if (!trimmed) {
      catalog.selectedId = "";
      await this.writeCatalog(catalog);
      return toSnapshot(catalog);
    }
    const endpointId = requireEndpointId(trimmed);
    if (!catalog.endpoints.some((item) => item.id === endpointId)) {
      throw new CustomModelEndpointError("CUSTOM_MODEL_NOT_FOUND", "自备模型不存在或已被删除。");
    }
    catalog.selectedId = endpointId;
    await this.writeCatalog(catalog);
    return toSnapshot(catalog);
  }

  async find(id: string): Promise<CustomModelEndpointPublic | null> {
    if (!isCustomModelEndpointId(id)) return null;
    const catalog = await this.readCatalog();
    return catalog.endpoints.find((item) => item.id === id.trim()) ?? null;
  }

  async resolveChatRequest(id: string): Promise<OwnedCustomModelRequest | null> {
    const endpoint = await this.find(id);
    if (!endpoint) return null;
    const apiKey = await this.vault(endpoint.id).readForTrustedRequest();
    if (!apiKey) return null;
    return {
      label: endpoint.label,
      baseUrl: endpoint.baseUrl,
      model: endpoint.model,
      wireApi: endpoint.wireApi,
      apiKey
    };
  }

  private vault(id: string) {
    return new DesktopSecretVault(this.secretPath(id), this.protector);
  }

  private secretPath(id: string) {
    const suffix = id.slice("custom:".length).replace(/[^a-zA-Z0-9-]/g, "");
    return join(this.directory, "secrets", `${suffix}.secret`);
  }

  private catalogPath() {
    return join(this.directory, "catalog.json");
  }

  private async writeSecret(id: string, apiKey: string) {
    try {
      await this.vault(id).replace(apiKey);
    } catch (error) {
      if (error instanceof DesktopSecretVaultError && error.code === "BRAIN_SECRET_PROTECTION_UNAVAILABLE") {
        throw new CustomModelEndpointError("CUSTOM_MODEL_KEY_UNPROTECTED", "系统凭据保护不可用，钥匙没有保存。");
      }
      throw error;
    }
  }

  private async readCatalog(): Promise<CustomModelCatalogFile> {
    try {
      const parsed = JSON.parse(await readFile(this.catalogPath(), "utf8")) as unknown;
      return normalizeCatalog(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_CATALOG, endpoints: [] };
      if (error instanceof CustomModelEndpointError) throw error;
      throw new CustomModelEndpointError("CUSTOM_MODEL_CATALOG_INVALID", "自备模型记录已损坏，没有继续使用。");
    }
  }

  private async writeCatalog(catalog: CustomModelCatalogFile) {
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = join(this.directory, `catalog.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    try {
      await rename(temporaryPath, this.catalogPath());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM") {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      await unlink(this.catalogPath()).catch(() => undefined);
      await rename(temporaryPath, this.catalogPath());
    }
  }
}

function toSnapshot(catalog: CustomModelCatalogFile): CustomModelEndpointSnapshot {
  return {
    selectedId: catalog.selectedId,
    endpoints: catalog.endpoints.map((item) => ({
      id: item.id,
      label: item.label,
      baseUrl: item.baseUrl,
      model: item.model,
      wireApi: item.wireApi
    }))
  };
}

function requireEndpointId(id: string) {
  const trimmed = id.trim();
  if (!isCustomModelEndpointId(trimmed)) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_NOT_FOUND", "自备模型不存在或已被删除。");
  }
  return trimmed;
}

function normalizeCatalog(value: unknown): CustomModelCatalogFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_CATALOG_INVALID", "自备模型记录已损坏，没有继续使用。");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.endpoints)) {
    throw new CustomModelEndpointError("CUSTOM_MODEL_CATALOG_INVALID", "自备模型记录已损坏，没有继续使用。");
  }
  const endpoints: StoredCustomModelEndpoint[] = [];
  for (const item of record.endpoints) {
    if (!item || typeof item !== "object") {
      throw new CustomModelEndpointError("CUSTOM_MODEL_CATALOG_INVALID", "自备模型记录已损坏，没有继续使用。");
    }
    const endpoint = item as Record<string, unknown>;
    if (!isCustomModelEndpointId(String(endpoint.id || ""))) {
      throw new CustomModelEndpointError("CUSTOM_MODEL_CATALOG_INVALID", "自备模型记录已损坏，没有继续使用。");
    }
    if (typeof endpoint.label !== "string" || typeof endpoint.baseUrl !== "string" || typeof endpoint.model !== "string") {
      throw new CustomModelEndpointError("CUSTOM_MODEL_CATALOG_INVALID", "自备模型记录已损坏，没有继续使用。");
    }
    endpoints.push({
      id: String(endpoint.id),
      label: endpoint.label,
      baseUrl: endpoint.baseUrl,
      model: endpoint.model,
      wireApi: "chat.completions"
    });
  }
  const selectedId = typeof record.selectedId === "string" && endpoints.some((item) => item.id === record.selectedId)
    ? record.selectedId
    : "";
  return { schemaVersion: 1, selectedId, endpoints };
}
