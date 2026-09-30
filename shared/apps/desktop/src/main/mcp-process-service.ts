import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpServerConfig, McpServerHealth } from "@codex-forge/protocol";

type SpawnProcess = typeof spawn;

interface McpProcessServiceOptions {
  cwd: string;
  spawnProcess?: SpawnProcess;
  now?: () => Date;
  baseEnv?: NodeJS.ProcessEnv;
  processManager?: McpProcessManager;
}

interface McpProcessManager {
  track<T extends ChildProcessWithoutNullStreams>(child: T): T;
  stop(child: ChildProcessWithoutNullStreams): Promise<void>;
}

const directMcpProcessManager: McpProcessManager = {
  track: (child) => child,
  stop: async (child) => { if (!child.killed) child.kill("SIGTERM"); }
};

/** Owns local MCP child-process state, bounded logs, and shutdown cleanup. */
export class McpProcessService {
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly logs = new Map<string, string[]>();
  private readonly options: McpProcessServiceOptions;
  private readonly spawnProcess: SpawnProcess;
  private readonly now: () => Date;
  private readonly processManager: McpProcessManager;

  constructor(options: McpProcessServiceOptions) {
    this.options = options;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.now = options.now ?? (() => new Date());
    this.processManager = options.processManager ?? directMcpProcessManager;
  }

  isRunning(serverId: string) {
    return this.processes.has(serverId);
  }

  getLogs(serverId: string) {
    return [...(this.logs.get(serverId) ?? [])];
  }

  clearLogs(serverId: string) {
    this.logs.set(serverId, []);
    return [];
  }

  appendLog(serverId: string, line: string) {
    const current = this.logs.get(serverId) ?? [];
    current.push(`[${this.now().toLocaleTimeString("zh-CN", { hour12: false })}] ${line}`);
    this.logs.set(serverId, current.slice(-200));
  }

  async start(server: McpServerConfig): Promise<McpServerHealth> {
    const checkedAt = this.now().toISOString();
    if (server.transport !== "stdio") {
      return { ok: false, code: "unsupported_transport", detail: "Only stdio MCP servers can be started locally.", checkedAt, running: false };
    }
    if (!server.command.trim()) {
      return { ok: false, code: "missing_command", detail: "MCP server command is required.", checkedAt, running: false };
    }
    if (this.processes.has(server.id)) {
      return { ok: true, code: "already_running", detail: "MCP server process is already running.", checkedAt, running: true };
    }

    try {
      const child = this.processManager.track(this.spawnProcess(server.command, server.args, {
        cwd: this.options.cwd,
        env: { ...(this.options.baseEnv ?? process.env), ...server.env },
        stdio: "pipe"
      }));
      this.processes.set(server.id, child);
      this.logs.set(server.id, []);
      this.appendLog(server.id, `started: ${server.command}${server.args.length ? ` ${server.args.join(" ")}` : ""}`);
      child.stdout.on("data", (chunk) => this.appendLog(server.id, `stdout: ${String(chunk).trimEnd()}`));
      child.stderr.on("data", (chunk) => this.appendLog(server.id, `stderr: ${String(chunk).trimEnd()}`));
      child.once("exit", () => {
        this.appendLog(server.id, "process exited");
        if (this.processes.get(server.id) === child) this.processes.delete(server.id);
      });
      child.once("error", (error) => {
        this.appendLog(server.id, `process error: ${error.message}`);
        if (this.processes.get(server.id) === child) this.processes.delete(server.id);
      });
      return { ok: true, code: "started", detail: `Started MCP process: ${server.command}`, checkedAt, running: true };
    } catch (error) {
      return { ok: false, code: "spawn_failed", detail: error instanceof Error ? error.message : String(error), checkedAt, running: false };
    }
  }

  async stop(server: McpServerConfig): Promise<McpServerHealth> {
    const checkedAt = this.now().toISOString();
    const child = this.processes.get(server.id);
    if (!child) {
      return { ok: false, code: "not_running", detail: "MCP server process is not running.", checkedAt, running: false };
    }
    try {
      await this.processManager.stop(child);
      this.processes.delete(server.id);
      return { ok: true, code: "stopped", detail: "Stopped local MCP process.", checkedAt, running: false };
    } catch (error) {
      return { ok: false, code: "stop_failed", detail: error instanceof Error ? error.message : String(error), checkedAt, running: true };
    }
  }

  async shutdown() {
    const children = [...this.processes.values()];
    this.processes.clear();
    await Promise.allSettled(children.map((child) => this.processManager.stop(child)));
  }
}
