import type { McpServerConfig } from "@codex-forge/protocol";

export type McpServerIdFactory = () => string;

export function normalizeMcpServer(input: Partial<McpServerConfig> | undefined, createId: McpServerIdFactory): McpServerConfig {
  return {
    id: input?.id?.trim() || createId(),
    name: input?.name?.trim() || "未命名 MCP 服务器",
    transport: input?.transport === "sse" ? "sse" : "stdio",
    command: input?.command?.trim() || "",
    args: Array.isArray(input?.args) ? input.args.map((item) => item.trim()).filter(Boolean) : [],
    url: input?.url?.trim() || "",
    env: input?.env && typeof input.env === "object"
      ? Object.fromEntries(Object.entries(input.env)
          .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
          .filter(([key]) => key))
      : {},
    enabled: typeof input?.enabled === "boolean" ? input.enabled : true
  };
}

export function isRunnableMcpServer(server: McpServerConfig) {
  return server.transport === "stdio" ? Boolean(server.command.trim()) : Boolean(server.url.trim());
}

export function normalizeMcpServers(input: Partial<McpServerConfig>[] | undefined, createId: McpServerIdFactory) {
  return Array.isArray(input)
    ? input
        .map((server) => normalizeMcpServer(server, createId))
        .filter((server) => server.id !== "builtin:errer_outf")
        .filter(isRunnableMcpServer)
    : [];
}
