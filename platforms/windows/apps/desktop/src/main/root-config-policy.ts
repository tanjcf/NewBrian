import type { DesktopPreferences, McpDiscoveredTool, McpServerConfig, ModelConfig } from "@codex-forge/protocol";

export interface RootConfigFile {
  llm: ModelConfig;
  preferences?: DesktopPreferences;
  mcpServers?: McpServerConfig[];
  mcpDiscoveredTools?: McpDiscoveredTool[];
}

interface RootConfigPolicyContext {
  defaultGatewayBaseUrl: string;
  defaultModelConfig: ModelConfig;
  migrateLegacyGatewayBaseUrl: (value: string | undefined, fallback: string) => string;
  normalizeModelConfig: (input: Partial<ModelConfig> | undefined, fallback?: ModelConfig) => ModelConfig;
  normalizeDesktopPreferences: (input?: Partial<DesktopPreferences>) => DesktopPreferences;
  normalizeMcpServers: (input?: Partial<McpServerConfig>[]) => McpServerConfig[];
}

export function normalizeRootConfig(
  parsed: Partial<RootConfigFile>,
  bundledConfig: RootConfigFile | null,
  context: RootConfigPolicyContext
): RootConfigFile {
  const bundledBaseUrl = bundledConfig?.llm?.baseUrl || context.defaultGatewayBaseUrl;
  const migratedBaseUrl = context.migrateLegacyGatewayBaseUrl(parsed.llm?.baseUrl, bundledBaseUrl);
  const fallbackModelConfig = { ...context.defaultModelConfig, baseUrl: bundledBaseUrl };
  const modelConfig = context.normalizeModelConfig({ ...parsed.llm, baseUrl: migratedBaseUrl }, fallbackModelConfig);
  return {
    llm: modelConfig,
    preferences: context.normalizeDesktopPreferences(parsed.preferences),
    mcpServers: context.normalizeMcpServers(parsed.mcpServers),
    mcpDiscoveredTools: Array.isArray(parsed.mcpDiscoveredTools) ? parsed.mcpDiscoveredTools : []
  };
}

export function shouldRepairRootConfig(parsed: Partial<RootConfigFile>, normalized: RootConfigFile) {
  return String(parsed.llm?.baseUrl || "").trim() !== normalized.llm.baseUrl.trim();
}
