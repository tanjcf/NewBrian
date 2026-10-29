import type { ModelConfig } from "@codex-forge/protocol";
import { preserveCustomModelSelection } from "../../shared/custom-model-endpoint.ts";

export function mergeRefreshedModelConfig(current: ModelConfig, refreshed: ModelConfig): ModelConfig {
  const availableModels = refreshed.availableModels ?? [];
  const optimizeFor = current.optimizeFor ?? refreshed.optimizeFor;
  const preservedCustomModel = preserveCustomModelSelection(current.model);
  if (preservedCustomModel) {
    return {
      ...refreshed,
      model: preservedCustomModel,
      provider: current.provider || refreshed.provider,
      reasoningEffort: current.reasoningEffort,
      ...(optimizeFor ? { optimizeFor } : {})
    };
  }
  if (current.model.trim().toLowerCase() === "auto") {
    return {
      ...refreshed,
      model: "auto",
      reviewModel: current.reviewModel || refreshed.reviewModel,
      reasoningEffort: current.reasoningEffort,
      ...(optimizeFor ? { optimizeFor } : {})
    };
  }
  const currentModel = availableModels.find(
    (item) => item.model.toLowerCase() === current.model.trim().toLowerCase()
  );
  if (!currentModel) {
    return {
      ...refreshed,
      ...(optimizeFor ? { optimizeFor } : {})
    };
  }
  const currentReviewModel = availableModels.find(
    (item) => item.model.toLowerCase() === current.reviewModel.trim().toLowerCase()
  );
  return {
    ...refreshed,
    provider: currentModel.provider,
    model: currentModel.model,
    reviewModel: (currentReviewModel ?? currentModel).model,
    reasoningEffort: current.reasoningEffort,
    ...(optimizeFor ? { optimizeFor } : {})
  };
}
