import type { ModelConfig } from "@codex-forge/protocol";

export interface SeparatedPrivateModelCredential {
  credential: string;
  config: ModelConfig;
}

/** Removes credential material before configuration is persisted. */
export function separatePrivateModelCredential(config: ModelConfig): SeparatedPrivateModelCredential {
  return {
    credential: config.apiKey.trim(),
    config: {
      ...config,
      apiKey: ""
    }
  };
}

/** Builds the only model configuration shape that may cross into a renderer. */
export function toRendererSafeModelConfig(config: ModelConfig, apiKeyConfigured: boolean): ModelConfig {
  return {
    ...config,
    apiKey: "",
    apiKeyConfigured
  };
}

/** Resolves plaintext only at the trusted main-process network boundary. */
export async function resolveTrustedPrivateModelCredential(
  requestCredential: string,
  readVaultCredential: () => Promise<string>
): Promise<string> {
  const explicit = requestCredential.trim();
  if (explicit) return explicit;
  return (await readVaultCredential()).trim();
}
