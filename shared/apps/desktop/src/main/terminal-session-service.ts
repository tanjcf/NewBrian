/** Maximum in-memory history retained for the local terminal session. */
export const terminalMaxLines = 1200;

export function trimTerminalLines(lines: string[], maxLines = terminalMaxLines) {
  return lines.slice(-maxLines);
}

export function appendTerminalOutput(lines: string[], chunk: string, maxLines = terminalMaxLines) {
  const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  const nextLines = [...lines];
  for (const part of parts) {
    if (!part && parts.length === 1) continue;
    nextLines.push(part);
  }
  return trimTerminalLines(nextLines, maxLines);
}

interface TerminalSessionServiceOptions {
  cwd: string;
  shell: string;
  prompt: string;
  platform?: NodeJS.Platform;
  nowIso?: () => string;
  onUpdate?: (snapshot: TerminalSessionSnapshot) => void;
  spawnShell?: typeof spawn;
  processManager?: TerminalProcessManager;
}

interface TerminalProcessManager {
  track<T extends ChildProcessWithoutNullStreams>(child: T): T;
  stop(child: ChildProcessWithoutNullStreams): Promise<void>;
}

const directTerminalProcessManager: TerminalProcessManager = {
  track: (child) => child,
  stop: async (child) => { if (!child.killed) child.kill("SIGTERM"); }
};

export class TerminalSessionService {
  process: ChildProcessWithoutNullStreams | null = null;
  cwd: string;
  shell: string;
  prompt: string;
  isRunning = false;
  lines: string[] = [];
  launchedAt?: string;
  lastExitCode?: number | null;

  private readonly platform: NodeJS.Platform;
  private readonly nowIso: () => string;
  private readonly onUpdate: (snapshot: TerminalSessionSnapshot) => void;
  private readonly spawnShell: typeof spawn;
  private readonly processManager: TerminalProcessManager;

  constructor(options: TerminalSessionServiceOptions) {
    this.cwd = options.cwd;
    this.shell = options.shell;
    this.prompt = options.prompt;
    this.platform = options.platform ?? process.platform;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.onUpdate = options.onUpdate ?? (() => undefined);
    this.spawnShell = options.spawnShell ?? spawn;
    this.processManager = options.processManager ?? directTerminalProcessManager;
  }

  snapshot(): TerminalSessionSnapshot {
    return {
      cwd: this.cwd,
      shell: this.shell,
      prompt: this.prompt,
      isRunning: this.isRunning,
      lines: [...this.lines],
      launchedAt: this.launchedAt,
      lastExitCode: this.lastExitCode
    };
  }

  ensure(shellEnv: Record<string, string>) {
    if (this.process && this.isRunning) return this.process;
    const child = this.processManager.track(this.spawnShell(this.shell, this.platform === "win32" ? ["-NoLogo"] : ["-l"], {
      cwd: this.cwd,
      env: { ...process.env, ...shellEnv, TERM: process.env.TERM || "xterm-256color" },
      stdio: "pipe"
    }) as ChildProcessWithoutNullStreams);
    this.attach(child);
    return child;
  }

  clear() {
    this.lines = [];
    this.emit();
  }

  async stop() {
    const child = this.process;
    this.process = null;
    this.isRunning = false;
    if (child) await this.processManager.stop(child);
    this.emit();
  }

  async restart(shellEnv: Record<string, string>) {
    await this.stop();
    this.clear();
    return this.ensure(shellEnv);
  }

  private attach(child: ChildProcessWithoutNullStreams) {
    this.process = child;
    this.isRunning = true;
    this.launchedAt = this.nowIso();
    this.lastExitCode = null;
    this.lines = trimTerminalLines([...this.lines, `已连接本地终端: ${this.shell}`, `工作目录: ${this.cwd}`]);
    child.stdout.on("data", (chunk) => this.append(String(chunk)));
    child.stderr.on("data", (chunk) => this.append(String(chunk)));
    child.on("error", (error) => {
      this.lines = trimTerminalLines([...this.lines, `终端启动失败: ${error.message}`]);
      this.isRunning = false;
      this.process = null;
      this.emit();
    });
    child.on("exit", (code) => {
      this.lines = trimTerminalLines([...this.lines, `终端已退出${typeof code === "number" ? `，退出码 ${code}` : ""}`]);
      this.isRunning = false;
      this.lastExitCode = code;
      this.process = null;
      this.emit();
    });
    this.emit();
  }

  private append(chunk: string) {
    this.lines = appendTerminalOutput(this.lines, chunk);
    this.emit();
  }

  private emit() {
    this.onUpdate(this.snapshot());
  }
}
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { TerminalSessionSnapshot } from "@codex-forge/protocol";
