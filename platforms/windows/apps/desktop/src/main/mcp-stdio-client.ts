import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpServerConfig, McpServerInspection, McpToolCallResult } from "@codex-forge/protocol";

type SpawnProcess = typeof spawn;

interface McpStdioClientOptions {
  cwd: string;
  spawnProcess?: SpawnProcess;
  baseEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
  onStderr?: (serverId: string, line: string) => void;
  encodeMessage: (payload: unknown) => Buffer;
  decodeMessages: (input: Buffer) => { messages: any[]; rest: Buffer; error?: Error };
}

interface ExchangeContext<Result> {
  send: (payload: unknown) => void;
  finish: (result: Result) => void;
}

interface ExchangeOptions<Result> {
  server: McpServerConfig;
  errorResult: (error: Error) => Result;
  onMessage: (message: any, context: ExchangeContext<Result>) => void;
}

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "NewBrain desktop", version: "0.1.0" }
  }
};

/** Runs one MCP stdio exchange until completion, process failure, or app-owned cancellation. */
export class McpStdioClient {
  private readonly spawnProcess: SpawnProcess;
  private readonly now: () => Date;

  constructor(privateOptions: McpStdioClientOptions) {
    this.options = privateOptions;
    this.spawnProcess = privateOptions.spawnProcess ?? spawn;
    this.now = privateOptions.now ?? (() => new Date());
  }

  private readonly options: McpStdioClientOptions;

  private exchange<Result>(options: ExchangeOptions<Result>) {
    return new Promise<Result>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      let buffer: Buffer = Buffer.alloc(0);
      let settled = false;
      const finish = (result: Result) => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGTERM"); } catch { /* process already exited */ }
        resolve(result);
      };
      try {
        child = this.spawnProcess(options.server.command, options.server.args, {
          cwd: this.options.cwd,
          env: { ...(this.options.baseEnv ?? process.env), ...options.server.env },
          stdio: "pipe"
        });
      } catch (error) {
        resolve(options.errorResult(error instanceof Error ? error : new Error(String(error))));
        return;
      }
      const context: ExchangeContext<Result> = {
        send: (payload) => child.stdin.write(this.options.encodeMessage(payload)),
        finish
      };
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        const decoded = this.options.decodeMessages(buffer);
        buffer = decoded.rest;
        if (decoded.error) {
          finish(options.errorResult(decoded.error));
          return;
        }
        for (const message of decoded.messages) {
          if (settled) break;
          try { options.onMessage(message, context); }
          catch (error) { finish(options.errorResult(error instanceof Error ? error : new Error(String(error)))); }
        }
      });
      child.stderr.on("data", (chunk) => this.options.onStderr?.(options.server.id, String(chunk).trimEnd()));
      child.once("error", (error) => finish(options.errorResult(error)));
      child.once("exit", () => {
        if (!settled) finish(options.errorResult(new Error("MCP process exited before the exchange completed.")));
      });
      context.send(initializeRequest);
    });
  }

  inspect(server: McpServerConfig): Promise<McpServerInspection> {
    const checkedAt = this.now().toISOString();
    if (server.transport !== "stdio" || !server.command.trim()) {
      return Promise.resolve({
        ok: false,
        detail: server.transport !== "stdio" ? "Only stdio MCP servers can be inspected." : "MCP server command is required.",
        checkedAt,
        tools: []
      });
    }
    let serverInfo = "";
    let protocolVersion = "";
    const failure = (error: Error): McpServerInspection => ({
      ok: false, detail: error.message, checkedAt, serverInfo, protocolVersion, tools: []
    });
    return this.exchange({
      server,
      errorResult: failure,
      onMessage: (message, context) => {
        if (message.id === 1 && message.result) {
          serverInfo = message.result.serverInfo?.name
            ? `${message.result.serverInfo.name}${message.result.serverInfo.version ? ` ${message.result.serverInfo.version}` : ""}`
            : "";
          protocolVersion = String(message.result.protocolVersion ?? "");
          context.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          context.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (message.id === 2) {
          const tools = Array.isArray(message.result?.tools) ? message.result.tools.map((tool: any) => ({
            name: String(tool?.name ?? "unknown"),
            description: String(tool?.description ?? ""),
            inputSchema: tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : undefined
          })) : [];
          context.finish({
            ok: true,
            detail: tools.length ? `Discovered ${tools.length} MCP tools.` : "MCP server returned no tools.",
            checkedAt, serverInfo, protocolVersion, tools
          });
        } else if (message.error) {
          context.finish(failure(new Error(String(message.error?.message ?? "MCP returned an error."))));
        }
      }
    });
  }

  callTool(server: McpServerConfig, toolName: string, query: string, args?: Record<string, unknown>): Promise<McpToolCallResult> {
    const failure = (error: Error): McpToolCallResult => ({
      ok: false, toolName, serverName: server.name, detail: error.message, content: ""
    });
    return this.exchange({
      server,
      errorResult: failure,
      onMessage: (message, context) => {
        if (message.id === 1 && message.result) {
          context.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          context.send({
            jsonrpc: "2.0", id: 2, method: "tools/call",
            params: { name: toolName, arguments: { query, input: query, prompt: query, ...(args ?? {}) } }
          });
        } else if (message.id === 2) {
          const contentItems = Array.isArray(message.result?.content) ? message.result.content : [];
          const text = contentItems.map((item: any) =>
            typeof item?.text === "string" ? item.text : typeof item === "string" ? item : JSON.stringify(item)
          ).filter(Boolean).join("\n\n").trim();
          context.finish({
            ok: true, toolName, serverName: server.name, detail: "MCP tool call succeeded.",
            content: text || JSON.stringify(message.result ?? {}, null, 2)
          });
        } else if (message.error) {
          context.finish(failure(new Error(String(message.error?.message ?? "MCP tool call failed."))));
        }
      }
    });
  }
}
