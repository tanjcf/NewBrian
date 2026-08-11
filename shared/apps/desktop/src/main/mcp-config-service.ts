import type {
  DesktopPreferences,
  McpDiscoveredTool,
  McpServerConfig,
  McpServerInspection,
  ModelConfig
} from "@codex-forge/protocol";

export interface McpRootConfig {
  llm: ModelConfig;
  preferences?: DesktopPreferences;
  mcpServers?: McpServerConfig[];
  mcpDiscoveredTools?: McpDiscoveredTool[];
}

interface McpConfigServiceOptions {
  readConfig: () => Promise<McpRootConfig>;
  writeConfig: (config: McpRootConfig) => Promise<void>;
  normalizeModelConfig: (config: ModelConfig) => ModelConfig;
  normalizePreferences: (preferences?: DesktopPreferences) => DesktopPreferences;
  normalizeServers: (servers?: McpServerConfig[]) => McpServerConfig[];
  syncRuntimeTools: () => Promise<unknown>;
}

/** Owns MCP root-config updates and synchronizes runtime tools only after durable writes. */
export class McpConfigService {
  private readonly options: McpConfigServiceOptions;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: McpConfigServiceOptions) {
    this.options = options;
  }

  async readServers() {
    const config = await this.options.readConfig();
    return this.options.normalizeServers(config.mcpServers);
  }

  async readDiscoveredTools() {
    const config = await this.options.readConfig();
    return Array.isArray(config.mcpDiscoveredTools) ? config.mcpDiscoveredTools : [];
  }

  private buildConfig(
    current: McpRootConfig,
    update: Partial<Pick<McpRootConfig, "mcpServers" | "mcpDiscoveredTools">>
  ) {
    return {
      ...current,
      llm: this.options.normalizeModelConfig(current.llm),
      preferences: this.options.normalizePreferences(current.preferences),
      mcpServers: this.options.normalizeServers(update.mcpServers ?? current.mcpServers),
      ...(update.mcpDiscoveredTools === undefined
        ? { mcpDiscoveredTools: current.mcpDiscoveredTools ?? [] }
        : { mcpDiscoveredTools: update.mcpDiscoveredTools })
    };
  }

  private enqueueMutation<Result>(operation: () => Promise<Result>) {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async saveServers(servers: McpServerConfig[]) {
    return this.enqueueMutation(async () => {
      const payload = this.buildConfig(await this.options.readConfig(), { mcpServers: servers });
      await this.options.writeConfig(payload);
      await this.options.syncRuntimeTools();
      return payload.mcpServers ?? [];
    });
  }

  async saveDiscoveredTools(tools: McpDiscoveredTool[]) {
    return this.enqueueMutation(async () => {
      const payload = this.buildConfig(await this.options.readConfig(), { mcpDiscoveredTools: tools });
      await this.options.writeConfig(payload);
      return payload.mcpDiscoveredTools ?? [];
    });
  }

  async replaceDiscoveredTools(server: McpServerConfig, inspection: McpServerInspection) {
    return this.enqueueMutation(async () => {
      const current = await this.options.readConfig();
      const discovered = inspection.tools.map((tool) => ({
        id: `${server.id}:${tool.name}`,
        serverId: server.id,
        serverName: server.name,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        protocolVersion: inspection.protocolVersion,
        discoveredAt: inspection.checkedAt
      }));
      const payload = this.buildConfig(current, {
        mcpDiscoveredTools: [
          ...discovered,
          ...(current.mcpDiscoveredTools ?? []).filter((tool) => tool.serverId !== server.id)
        ]
      });
      await this.options.writeConfig(payload);
      await this.options.syncRuntimeTools();
      return payload.mcpDiscoveredTools ?? [];
    });
  }
}
