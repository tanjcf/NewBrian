import type { McpServerConfig, McpServerHealth, TerminalSessionSnapshot } from "@codex-forge/protocol";
import type { AgentHostData, AgentHostMethod } from "./agent-host-protocol.js";

interface AgentHostRequester {
  request(method: AgentHostMethod, payload: AgentHostData): Promise<AgentHostData>;
}

export interface AgentHostTerminalConfig {
  cwd: string;
  shell: string;
  prompt: string;
  env: Record<string, string>;
}

interface AgentHostDesktopAdapterOptions {
  client: AgentHostRequester;
  getTerminalConfig: () => AgentHostTerminalConfig;
}

/** Preserves desktop service contracts while process ownership lives in the host. */
export class AgentHostDesktopAdapter {
  private readonly client: AgentHostRequester;
  private readonly getTerminalConfig: () => AgentHostTerminalConfig;

  constructor(options: AgentHostDesktopAdapterOptions) {
    this.client = options.client;
    this.getTerminalConfig = options.getTerminalConfig;
  }

  async getTerminalSession() {
    return await this.client.request("terminal.ensure", this.getTerminalConfig() as unknown as AgentHostData) as unknown as TerminalSessionSnapshot;
  }

  async writeTerminalInput(input: string) {
    await this.client.request("terminal.ensure", this.getTerminalConfig() as unknown as AgentHostData);
    return await this.client.request("terminal.write", { input }) as unknown as TerminalSessionSnapshot;
  }

  async restartTerminalSession() {
    return await this.client.request("terminal.restart", this.getTerminalConfig() as unknown as AgentHostData) as unknown as TerminalSessionSnapshot;
  }

  async stopTerminalSession() {
    return await this.client.request("terminal.stop", {}) as unknown as TerminalSessionSnapshot;
  }

  async startMcpServer(server: McpServerConfig) {
    return await this.client.request("mcp.start", { server: server as unknown as AgentHostData }) as unknown as McpServerHealth;
  }

  async stopMcpServer(server: McpServerConfig) {
    return await this.client.request("mcp.stop", { server: server as unknown as AgentHostData }) as unknown as McpServerHealth;
  }

  async isMcpServerRunning(serverId: string) {
    return await this.client.request("mcp.status", { serverId }) as boolean;
  }

  async getMcpLogs(serverId: string) {
    return await this.client.request("mcp.logs.get", { serverId }) as string[];
  }

  async clearMcpLogs(serverId: string) {
    return await this.client.request("mcp.logs.clear", { serverId }) as string[];
  }

  async appendMcpLog(serverId: string, line: string) {
    await this.client.request("mcp.logs.append", { serverId, line });
  }
}
