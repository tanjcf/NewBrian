import type { McpDiscoveredTool, McpServerConfig, McpToolCallResult } from "@codex-forge/protocol";

interface McpRuntimeRegistry {
  unregisterExternalTools: (namespace?: string) => unknown;
  registerExternalTool: (
    definition: any,
    execute: (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<Record<string, unknown>>
  ) => unknown;
  getToolDescriptors: () => Array<{ namespace?: string }>;
}

interface McpToolRuntimeServiceOptions {
  readTools: () => Promise<McpDiscoveredTool[]>;
  readServers: () => Promise<McpServerConfig[]>;
  callStdioTool: (
    server: McpServerConfig,
    toolName: string,
    query: string,
    args?: Record<string, unknown>
  ) => Promise<McpToolCallResult>;
  getRuntime: () => McpRuntimeRegistry | undefined;
}

export function resolveMcpToolPolicy(serverId: string, toolName: string) {
  if (serverId === "builtin:errer_outf" && toolName === "errer_outf.read_errors") {
    return { kind: "read", risk: "low", requiresApproval: false } as const;
  }
  if (serverId === "builtin:errer_outf" && toolName === "errer_outf.update_status") {
    return { kind: "write", risk: "medium", requiresApproval: false } as const;
  }
  return { kind: "read", risk: "medium", requiresApproval: true } as const;
}

export function createUniqueModelToolName(value: string, usedNames: Set<string>) {
  const base = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "mcp_tool";
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const marker = `_${suffix}`;
    candidate = `${base.slice(0, 64 - marker.length)}${marker}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

/** Routes MCP tools through enabled stdio servers and owns runtime descriptor registration. */
export class McpToolRuntimeService {
  private readonly options: McpToolRuntimeServiceOptions;

  constructor(options: McpToolRuntimeServiceOptions) {
    this.options = options;
  }

  private failure(toolName: string, serverName: string, detail: string): McpToolCallResult {
    return { ok: false, toolName, serverName, detail, content: "" };
  }

  async call(toolId: string, query: string, args?: Record<string, unknown>) {
    const [tools, servers] = await Promise.all([this.options.readTools(), this.options.readServers()]);
    const tool = tools.find((item) => item.id === toolId);
    if (!tool) return this.failure(toolId, "", "Discovered MCP tool was not found.");
    const server = servers.find((item) => item.id === tool.serverId);
    if (!server) return this.failure(tool.name, tool.serverName, "MCP server configuration was not found.");
    if (!server.enabled) return this.failure(tool.name, tool.serverName, "MCP server is disabled.");
    if (server.transport !== "stdio") {
      return this.failure(tool.name, tool.serverName, "Only stdio MCP tool calls are supported.");
    }
    return this.options.callStdioTool(server, tool.name, query, args);
  }

  async sync() {
    const runtime = this.options.getRuntime();
    if (!runtime) return [];
    runtime.unregisterExternalTools("mcp");
    const [tools, servers] = await Promise.all([this.options.readTools(), this.options.readServers()]);
    const callableServers = new Set(
      servers.filter((server) => server.enabled && server.transport === "stdio").map((server) => server.id)
    );
    const usedNames = new Set<string>();
    for (const tool of tools) {
      if (!callableServers.has(tool.serverId)) continue;
      const modelName = createUniqueModelToolName(`mcp__${tool.serverId}__${tool.name}`, usedNames);
      const policy = resolveMcpToolPolicy(tool.serverId, tool.name);
      runtime.registerExternalTool({
        name: modelName,
        title: `${tool.serverName}: ${tool.name}`,
        description: tool.description || `Call MCP tool ${tool.name} on ${tool.serverName}.`,
        ...policy,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        namespace: "mcp"
      }, async (input) => {
        const query = String(input.query ?? input.input ?? input.prompt ?? "");
        const result = await this.call(tool.id, query, input);
        return {
          ok: result.ok,
          exitCode: result.ok ? 0 : 1,
          output: result.content || result.detail,
          command: modelName,
          mcp: { toolId: tool.id, serverId: tool.serverId, serverName: tool.serverName }
        };
      });
    }
    return runtime.getToolDescriptors().filter((tool) => tool.namespace === "mcp");
  }
}
