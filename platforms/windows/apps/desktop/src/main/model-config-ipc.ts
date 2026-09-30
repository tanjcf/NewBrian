import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type ModelConfig
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface ModelConfigIpcServices {
  getConfig: () => MaybePromise<ModelConfig>;
  saveConfig: (config: ModelConfig) => MaybePromise<ModelConfig>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptimizeFor(value: unknown): value is ModelConfig["optimizeFor"] {
  return value === "cost" || value === "balanced" || value === "intelligence";
}

function isRoutingProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.schema_version !== 1) return false;
  if (value.status !== "probing" && value.status !== "active" && value.status !== "failed" && value.status !== "disabled") {
    return false;
  }
  if (value.tier !== 1 && value.tier !== 2 && value.tier !== 3) return false;
  if (typeof value.cost_weight !== "number" || typeof value.quality_weight !== "number") return false;
  if (!Array.isArray(value.roles) || !value.roles.every((role) => typeof role === "string")) return false;
  if (!Array.isArray(value.capabilities) || !value.capabilities.every((tag) => typeof tag === "string")) return false;
  return true;
}

function isAvailableModel(value: unknown): value is NonNullable<ModelConfig["availableModels"]>[number] {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.model === "string"
    && typeof value.label === "string"
    && typeof value.provider === "string"
    && (value.capabilities === undefined
      || (Array.isArray(value.capabilities) && value.capabilities.every((tag) => typeof tag === "string")))
    && (value.routing === undefined || isRoutingProfile(value.routing));
}

function isReasoningEffort(value: unknown): value is ModelConfig["reasoningEffort"] {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function parseModelConfig(input: unknown): ModelConfig {
  if (!isRecord(input)
    || typeof input.provider !== "string"
    || typeof input.baseUrl !== "string"
    || typeof input.apiKey !== "string"
    || (input.wireApi !== "responses" && input.wireApi !== "chat.completions")
    || typeof input.model !== "string"
    || typeof input.reviewModel !== "string"
    || !isReasoningEffort(input.reasoningEffort)
    || typeof input.disableResponseStorage !== "boolean"
    || typeof input.systemPrompt !== "string"
    || (input.toolContext !== undefined && typeof input.toolContext !== "string")
    || (input.optimizeFor !== undefined && !isOptimizeFor(input.optimizeFor))
    || (input.availableModels !== undefined
      && (!Array.isArray(input.availableModels) || !input.availableModels.every(isAvailableModel)))) {
    throw new TypeError("Model configuration payload is invalid.");
  }

  return {
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    wireApi: input.wireApi,
    model: input.model,
    reviewModel: input.reviewModel,
    reasoningEffort: input.reasoningEffort,
    disableResponseStorage: input.disableResponseStorage,
    systemPrompt: input.systemPrompt,
    toolContext: input.toolContext,
    ...(input.optimizeFor ? { optimizeFor: input.optimizeFor } : {}),
    availableModels: input.availableModels
  };
}

/** Register model configuration IPC and validate renderer data before service access. */
export function registerModelConfigIpcHandlers(services: ModelConfigIpcServices) {
  ipcMain.handle(desktopIpcChannels.model.getConfig, () => services.getConfig());
  ipcMain.handle(desktopIpcChannels.model.saveConfig, (_event, input: unknown) =>
    services.saveConfig(parseModelConfig(input))
  );
}
