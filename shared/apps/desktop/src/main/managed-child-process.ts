import { spawn, type ChildProcess } from "node:child_process";

type ManagedChild = Pick<ChildProcess, "pid" | "exitCode" | "killed" | "kill" | "once" | "removeListener">;
type WaitForExit = (child: ManagedChild, timeoutMs: number) => Promise<boolean>;
type KillTree = (pid: number) => Promise<void>;

interface ManagedChildProcessManagerOptions {
  platform?: NodeJS.Platform;
  gracefulTimeoutMs?: number;
  waitForExit?: WaitForExit;
  killTree?: KillTree;
}

export function windowsTreeKillCommand(pid: number) {
  return { executable: "taskkill.exe", args: ["/PID", String(pid), "/T", "/F"] };
}

function waitForChildExit(child: ManagedChild, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("error", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once("exit", onExit);
    child.once("error", onExit);
  });
}

function killWindowsTree(pid: number): Promise<void> {
  const command = windowsTreeKillCommand(pid);
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, { windowsHide: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 || code === 128 ? resolve() : reject(new Error(`taskkill exited with code ${String(code)}`)));
  });
}

export class ManagedChildProcessManager {
  private readonly children = new Set<ManagedChild>();
  private readonly stops = new Map<ManagedChild, Promise<void>>();
  private readonly platform: NodeJS.Platform;
  private readonly gracefulTimeoutMs: number;
  private readonly waitForExit: WaitForExit;
  private readonly killTree: KillTree;

  constructor(options: ManagedChildProcessManagerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.gracefulTimeoutMs = options.gracefulTimeoutMs ?? 2_000;
    this.waitForExit = options.waitForExit ?? waitForChildExit;
    this.killTree = options.killTree ?? killWindowsTree;
  }

  get size() {
    return this.children.size;
  }

  track<T extends ManagedChild>(child: T): T {
    this.children.add(child);
    const forget = () => this.children.delete(child);
    child.once("exit", forget);
    child.once("error", forget);
    return child;
  }

  stop(child: ManagedChild): Promise<void> {
    const existing = this.stops.get(child);
    if (existing) return existing;
    const stopping = this.stopOnce(child).finally(() => {
      this.children.delete(child);
      this.stops.delete(child);
    });
    this.stops.set(child, stopping);
    return stopping;
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.children].map((child) => this.stop(child)));
  }

  private async stopOnce(child: ManagedChild) {
    if (child.exitCode !== null) return;
    try { child.kill("SIGTERM"); } catch { /* process already exited */ }
    if (await this.waitForExit(child, this.gracefulTimeoutMs)) return;
    if (this.platform === "win32" && typeof child.pid === "number") {
      await this.killTree(child.pid);
      return;
    }
    try { child.kill("SIGKILL"); } catch { /* process already exited */ }
  }
}
