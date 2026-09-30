import { dirname } from "node:path";
import { promises as fs } from "node:fs";
import type { ModelConfig } from "@codex-forge/protocol";
import {
  loadAuthorizedModelCatalog,
  parseAuthorizedModelPayload,
  type AuthorizedModel
} from "./authorized-model-catalog.js";
import { resolveEffectiveGatewayBaseUrl } from "./desktop-control-plane.js";

export interface ReadAuthorizedDesktopModelConfigDependencies {
  readRootConfig: () => Promise<{ llm: Partial<ModelConfig> }>;
  readBundledRootConfig: () => Promise<{ llm?: Partial<ModelConfig> } | null>;
  readDesktopAuthState: () => Promise<{
    access_token?: string;
  } | null>;
  readPrivateModelCredential: () => Promise<string>;
  readGatewayOrigin: () => Promise<string>;
  createDesktopAuthHeaders: (input: { accessToken: string; device: unknown }) => Record<string, string>;
  collectDesktopDeviceFingerprint: () => unknown;
  appendDesktopDebugLog: (line: string) => Promise<unknown>;
  ensureDirectory: (path: string) => Promise<unknown>;
  parseJsonText: <T>(raw: string) => T;
  normalizeModelConfig: (input?: Partial<ModelConfig>) => ModelConfig;
  authorizedModelsCachePath: string;
  desktopControlPlaneStatePath: string;
  configuredGatewayBaseUrlEnv: string;
  productionGatewayBaseUrl: string;
  defaultGatewayBaseUrl: string;
  isPackaged: boolean;
  setCachedAuthorizedModels: (models: AuthorizedModel[]) => void;
}

export function createReadAuthorizedDesktopModelConfig(deps: ReadAuthorizedDesktopModelConfigDependencies) {
  return async function readAuthorizedDesktopModelConfig(candidate?: Partial<ModelConfig>): Promise<ModelConfig> {
    const config = await deps.readRootConfig();
    const effectiveConfig = { ...config.llm, ...(candidate ?? {}) };
    const authState = await deps.readDesktopAuthState();
    const bundledConfig = await deps.readBundledRootConfig();
    const gatewayBaseUrl = resolveEffectiveGatewayBaseUrl({
      configuredBaseUrl: effectiveConfig.baseUrl,
      bundledBaseUrl: bundledConfig?.llm?.baseUrl || deps.defaultGatewayBaseUrl,
      envBaseUrl: deps.configuredGatewayBaseUrlEnv,
      isPackaged: deps.isPackaged,
      productionBaseUrl: deps.productionGatewayBaseUrl
    }) || await deps.readGatewayOrigin();
    const modelsUrl = `${new URL(gatewayBaseUrl).origin}/v1/models`;
    const apiKeyCredential = effectiveConfig.apiKey?.trim() || await deps.readPrivateModelCredential();
    const accessTokenCredential = authState?.access_token?.trim() || "";
    const device = deps.collectDesktopDeviceFingerprint();
    const credentials = [
      accessTokenCredential ? {
        value: accessTokenCredential,
        headers: deps.createDesktopAuthHeaders({ accessToken: accessTokenCredential, device })
      } : null,
      process.env.NEWBRAIN_E2E_AUTH_BYPASS === "1" && deps.configuredGatewayBaseUrlEnv
        ? { value: "newbrain-e2e", headers: { Authorization: "Bearer newbrain-e2e" } }
        : null,
      apiKeyCredential ? {
        value: apiKeyCredential,
        headers: { Authorization: `Bearer ${apiKeyCredential}` }
      } : null
    ].filter((item): item is { value: string; headers: Record<string, string> } => Boolean(item));
    let remoteModels: unknown[] = [];
    let lastError = "";
    let remoteRequestSucceeded = false;
    for (const credential of credentials) {
      try {
        const response = await fetch(modelsUrl, {
          headers: credential.headers
        });
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }
        const payload = await response.json() as { data?: unknown };
        remoteModels = Array.isArray(payload.data) ? payload.data : [];
        remoteRequestSucceeded = true;
        lastError = "";
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (lastError) {
      await deps.appendDesktopDebugLog(`authorized model list failed endpoint=${modelsUrl} error=${lastError}`);
    }
    const remoteCatalog = parseAuthorizedModelPayload(remoteModels);
    const availableModels = await loadAuthorizedModelCatalog({
      fetchRemote: async () => remoteRequestSucceeded ? remoteCatalog : null,
      writeCache: async (models) => {
        await deps.ensureDirectory(dirname(deps.authorizedModelsCachePath));
        await fs.writeFile(deps.authorizedModelsCachePath, `${JSON.stringify(models, null, 2)}\n`, "utf8");
      },
      readCache: async () => {
        try {
          const cached = deps.parseJsonText<unknown>(await fs.readFile(deps.authorizedModelsCachePath, "utf8"));
          const cachedModels = Array.isArray(cached)
            ? cached.filter((item): item is AuthorizedModel => Boolean(
                item && typeof item === "object" && String((item as Record<string, unknown>).model || "").trim()
              ))
            : [];
          if (cachedModels.length > 0) {
            await deps.appendDesktopDebugLog(`authorized model list using last successful cache count=${cachedModels.length}`);
          }
          return cachedModels;
        } catch {
          try {
            const controlPlane = deps.parseJsonText<{ model_config?: { models?: unknown[] } }>(
              await fs.readFile(deps.desktopControlPlaneStatePath, "utf8")
            );
            const controlPlaneModels = (controlPlane.model_config?.models ?? []).flatMap((item): AuthorizedModel[] => {
              if (!item || typeof item !== "object") return [];
              const record = item as Record<string, unknown>;
              const model = String(record.name || record.model || "").trim();
              if (!model) return [];
              const rawCapabilities = record.capabilities ?? record.capability_tags ?? record.capabilityTags;
              const capabilities = Array.isArray(rawCapabilities)
                ? rawCapabilities.map((tag) => String(tag || "").trim()).filter(Boolean)
                : typeof rawCapabilities === "string"
                  ? rawCapabilities.split(/[,;\s]+/).map((tag) => tag.trim()).filter(Boolean)
                  : undefined;
              return [{
                id: String(record.id || model),
                model,
                label: String(record.name || model).trim(),
                provider: String(record.provider || "").trim(),
                ...(capabilities?.length ? { capabilities } : {})
              }];
            });
            if (controlPlaneModels.length > 0) {
              await deps.appendDesktopDebugLog(`authorized model list using synced control-plane cache count=${controlPlaneModels.length}`);
            }
            return controlPlaneModels;
          } catch {
            return [];
          }
        }
      }
    });
    const requestedAuto = effectiveConfig.model.trim().toLowerCase() === "auto";
    const selected = requestedAuto
      ? availableModels[0]
      : availableModels.find(
        (item) => item.model.toLowerCase() === effectiveConfig.model.toLowerCase()
      ) ?? availableModels[0];
    const selectedReview = availableModels.find((item) => item.model.toLowerCase() === effectiveConfig.reviewModel.toLowerCase())
      ?? selected;
    deps.setCachedAuthorizedModels(availableModels);
    let syncedAutoParentDisplayName: string | undefined;
    try {
      const controlPlane = deps.parseJsonText<{ model_config?: Record<string, unknown> }>(
        await fs.readFile(deps.desktopControlPlaneStatePath, "utf8")
      );
      const raw = controlPlane.model_config?.auto_parent_display_name
        ?? controlPlane.model_config?.autoParentDisplayName;
      syncedAutoParentDisplayName = typeof raw === "string" ? raw : undefined;
    } catch {
      syncedAutoParentDisplayName = undefined;
    }
    return {
      ...deps.normalizeModelConfig({
        ...effectiveConfig,
        apiKey: "",
        provider: selected?.provider ?? "",
        baseUrl: gatewayBaseUrl,
        wireApi: "responses",
        model: requestedAuto ? "auto" : (selected?.model ?? ""),
        reviewModel: selectedReview?.model ?? selected?.model ?? "",
        autoParentDisplayName: syncedAutoParentDisplayName
      }),
      apiKey: "",
      availableModels
    };
  };
}
