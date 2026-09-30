import type { ModelConfig } from "@codex-forge/protocol";
import { resolveAutoParentDisplayName } from "./auto-parent-display-policy.ts";

export function normalizeModelConfig(input: Partial<ModelConfig> | undefined, fallback: ModelConfig): ModelConfig {
  const optimizeFor =
    input?.optimizeFor === "cost" || input?.optimizeFor === "intelligence" || input?.optimizeFor === "balanced"
      ? input.optimizeFor
      : fallback.optimizeFor === "cost" || fallback.optimizeFor === "intelligence" || fallback.optimizeFor === "balanced"
        ? fallback.optimizeFor
        : "balanced";
  return {
    provider: input?.provider?.trim() || fallback.provider,
    baseUrl: input?.baseUrl?.trim() || fallback.baseUrl,
    apiKey: typeof input?.apiKey === "string" ? input.apiKey.trim() : fallback.apiKey,
    apiKeyConfigured: input?.apiKeyConfigured === true || fallback.apiKeyConfigured === true,
    wireApi: input?.wireApi === "chat.completions" ? "chat.completions" : "responses",
    model: input?.model?.trim() || fallback.model,
    reviewModel: input?.reviewModel?.trim() || fallback.reviewModel,
    reasoningEffort:
      input?.reasoningEffort === "low" || input?.reasoningEffort === "high" || input?.reasoningEffort === "xhigh"
        ? input.reasoningEffort
        : fallback.reasoningEffort,
    disableResponseStorage:
      typeof input?.disableResponseStorage === "boolean"
        ? input.disableResponseStorage
        : fallback.disableResponseStorage,
    systemPrompt: input?.systemPrompt?.trim() || fallback.systemPrompt,
    optimizeFor,
    autoParentDisplayName: resolveAutoParentDisplayName(
      input?.autoParentDisplayName ?? fallback.autoParentDisplayName
    )
  };
}
