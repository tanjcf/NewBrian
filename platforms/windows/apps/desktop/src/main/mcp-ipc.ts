import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type McpDiscoveredTool,
  type McpToolCallInput,
  type McpServerConfig,
  type McpServerHealth,
  type McpServerInspection
} from "@codex-forge/protocol";
import { parseMcpToolCallInput } from "./mcp-call-contract.js";

type MaybePromise<T> = T | Promise<T>;

interface McpIpcServices {
  getServers: () => MaybePromise<McpServerConfig[]>;
  saveServers: (servers: McpServerConfig[]) => MaybePromise<unknown>;
  testServer: (server: McpServerConfig) => MaybePromise<McpServerHealth>;
  startServer: (server: McpServerConfig) => MaybePromise<McpServerHealth>;
  stopServer: (server: McpServerConfig) => MaybePromise<McpServerHealth>;
  getLogs: (serverId: string) => MaybePromise<string[]>;
  clearLogs: (serverId: string) => MaybePromise<string[]>;
  inspectServer: (server: McpServerConfig) => MaybePromise<McpServerInspection>;
  getDiscoveredTools: () => MaybePromise<McpDiscoveredTool[]>;
  callTool: (input: McpToolCallInput) => MaybePromise<unknown>;
}

/** Register MCP management IPC without exposing MCP process state to Electron wiring. */
export function registerMcpIpcHandlers(services: McpIpcServices) {
  ipcMain.handle(desktopIpcChannels.mcp.getServers, () => services.getServers());
  ipcMain.handle(desktopIpcChannels.mcp.saveServers, (_event, servers: McpServerConfig[]) => services.saveServers(servers));
  ipcMain.handle(desktopIpcChannels.mcp.testServer, (_event, server: McpServerConfig) => services.testServer(server));
  ipcMain.handle(desktopIpcChannels.mcp.startServer, (_event, server: McpServerConfig) => services.startServer(server));
  ipcMain.handle(desktopIpcChannels.mcp.stopServer, (_event, server: McpServerConfig) => services.stopServer(server));
  ipcMain.handle(desktopIpcChannels.mcp.getLogs, (_event, serverId: string) => services.getLogs(serverId));
  ipcMain.handle(desktopIpcChannels.mcp.clearLogs, (_event, serverId: string) => services.clearLogs(serverId));
  ipcMain.handle(desktopIpcChannels.mcp.inspectServer, (_event, server: McpServerConfig) => services.inspectServer(server));
  ipcMain.handle(desktopIpcChannels.mcp.getDiscoveredTools, () => services.getDiscoveredTools());
  ipcMain.handle(desktopIpcChannels.mcp.callTool, (_event, input: unknown) => services.callTool(parseMcpToolCallInput(input)));
}
