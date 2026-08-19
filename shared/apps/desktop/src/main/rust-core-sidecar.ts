import { spawn, type ChildProcess } from "node:child_process";
import { RustCoreClient, rustCoreChildEnvironment, type RustCoreChild } from "./rust-core-client.ts";

type SpawnedRustCoreChild = RustCoreChild & Pick<ChildProcess, "stdin" | "stdout" | "stderr">;
type SpawnRustCore = (
  executable: string,
  commandArgs: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean; stdio: ["pipe", "pipe", "pipe"]; }
) => SpawnedRustCoreChild;

interface RustCoreProcessManager {
  track<T extends SpawnedRustCoreChild>(child: T): T;
  stop(child: SpawnedRustCoreChild): Promise<void>;
}

interface RustCoreSidecarOptions {
  executable: string;
  projectRoot: string;
  environment?: NodeJS.ProcessEnv;
  defaultTimeoutMs?: number;
  spawnProcess?: SpawnRustCore;
  track: RustCoreProcessManager["track"];
  stop?: RustCoreProcessManager["stop"];
}

export class RustCoreSidecar {
  private readonly options: RustCoreSidecarOptions;
  private readonly spawnProcess: SpawnRustCore;
  private client: RustCoreClient | null = null;
  private child: SpawnedRustCoreChild | null = null;
  private starting: Promise<RustCoreClient> | null = null;

  constructor(options: RustCoreSidecarOptions) {
    this.options = options;
    this.spawnProcess = options.spawnProcess ?? ((executable, args, spawnOptions) =>
      spawn(executable, args, spawnOptions));
  }

  start(): Promise<RustCoreClient> {
    if (this.client) return Promise.resolve(this.client);
    if (!this.starting) this.starting = this.startOnce();
    return this.starting;
  }

  async shutdown() {
    const client = this.client;
    const child = this.child;
    this.client = null;
    this.child = null;
    this.starting = null;
    await client?.shutdown();
    if (child && this.options.stop) await this.options.stop(child);
  }

  private async startOnce() {
    let child: SpawnedRustCoreChild;
    try {
      child = this.options.track(this.spawnProcess(
        this.options.executable,
        ["--project-root", this.options.projectRoot],
        {
          cwd: this.options.projectRoot,
          env: rustCoreChildEnvironment(this.options.environment ?? process.env),
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"]
        }
      ));
    } catch (error) {
      this.starting = null;
      throw new Error(`BRAIN_CORE_UNAVAILABLE: ${error instanceof Error ? error.message : "failed to start Rust Core"}`);
    }
    if (!child.stdin || !child.stdout || !child.stderr) {
      this.starting = null;
      throw new Error("BRAIN_CORE_UNAVAILABLE: Rust Core stdio is unavailable.");
    }
    const client = new RustCoreClient({
      child,
      defaultTimeoutMs: this.options.defaultTimeoutMs
    });
    try {
      const health = await client.request({
        request_id: "health",
        project_id: "sidecar",
        workspace_type: "system",
        operation: "health.check",
        approval_token: "",
        resource_limits: { timeout_ms: 5_000, max_output_bytes: 1_024 },
        payload: {}
      });
      if (health.status !== "completed" || (health.result as { ready?: unknown } | undefined)?.ready !== true) {
        throw new Error("health check failed");
      }
      this.child = child;
      this.client = client;
      return client;
    } catch (error) {
      await client.shutdown();
      if (this.options.stop) await this.options.stop(child);
      this.starting = null;
      throw new Error(`BRAIN_CORE_UNAVAILABLE: ${error instanceof Error ? error.message : "health check failed"}`);
    }
  }
}
