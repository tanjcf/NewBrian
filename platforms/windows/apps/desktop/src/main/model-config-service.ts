import type { ModelConfig } from "@codex-forge/protocol";
import type { RootConfigFile } from "./root-config-policy.js";

export interface ModelConfigServiceDependencies {
  readAuthorized: (candidate?: Partial<ModelConfig>) => Promise<ModelConfig>;
  writeRootConfig: (config: ModelConfig) => Promise<RootConfigFile>;
  isCredentialConfigured: () => Promise<boolean>;
}

/** Applies subscription authorization before persisting a model selection. */
export class ModelConfigService {
  private readonly dependencies: ModelConfigServiceDependencies;

  constructor(dependencies: ModelConfigServiceDependencies) {
    this.dependencies = dependencies;
  }

  async getConfig(candidate?: Partial<ModelConfig>) {
    const config = await this.dependencies.readAuthorized(candidate);
    return this.forRenderer(config);
  }

  async saveConfig(config: ModelConfig): Promise<ModelConfig> {
    const authorized = await this.dependencies.readAuthorized(config);
    const availableModels = authorized.availableModels ?? [];
    const requestedAuto = config.model.trim().toLowerCase() === "auto";
    const selected = requestedAuto
      ? availableModels[0]
      : availableModels.find((item) => item.model.toLowerCase() === config.model.trim().toLowerCase());
    const selectedReview = availableModels.find((item) => item.model.toLowerCase() === config.reviewModel.trim().toLowerCase());
    if (!selected) throw new Error("The current subscription does not allow the selected model. Refresh the model list.");
    const optimizeFor =
      config.optimizeFor === "cost" || config.optimizeFor === "intelligence" || config.optimizeFor === "balanced"
        ? config.optimizeFor
        : "balanced";
    const saved = await this.dependencies.writeRootConfig({
      ...config,
      provider: selected.provider,
      wireApi: "responses",
      model: requestedAuto ? "auto" : selected.model,
      reviewModel: (selectedReview ?? selected).model,
      optimizeFor
    });
    return this.forRenderer({ ...saved.llm, availableModels, optimizeFor: saved.llm.optimizeFor ?? optimizeFor });
  }

  private async forRenderer(config: ModelConfig): Promise<ModelConfig> {
    return {
      ...config,
      apiKey: "",
      apiKeyConfigured: await this.dependencies.isCredentialConfigured()
    };
  }
}
