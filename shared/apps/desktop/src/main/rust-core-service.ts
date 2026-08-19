import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { rustCoreChildEnvironment } from "./rust-core-environment.ts";

type RustCoreRequestInput = Omit<RustCoreRequest, "protocol_version">;
type RustCoreApprovedRequestInput = Omit<RustCoreRequestInput, "approval_token">;

interface RustCoreClientLike {
  request(input: RustCoreRequestInput): Promise<RustCoreResponse>;
  requestWithApproval(input: RustCoreApprovedRequestInput): Promise<RustCoreResponse>;
  shutdown(): Promise<void>;
}

interface RustCoreChild {
  stdin: ChildProcess["stdin"];
  stdout: ChildProcess["stdout"];
  stderr: ChildProcess["stderr"];
  exitCode: number | null;
  pid?: number;
  killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit" | "error", listener: (...args: unknown[]) => void): unknown;
  removeListener(event: "exit" | "error", listener: (...args: unknown[]) => void): unknown;
}

interface RustCoreProcessManager {
  track<T extends RustCoreChild>(child: T): T;
  stop(child: RustCoreChild): Promise<void>;
}

interface RustCoreServiceOptions {
  binaryPath: string;
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: (executable: string, args: string[], options: SpawnOptions) => RustCoreChild;
  processManager: RustCoreProcessManager;
  createClient: (child: RustCoreChild) => RustCoreClientLike;
}

export interface RustCoreProjectBinding {
  projectId: string;
  projectRoot: string;
  workspaceType: string;
}

interface ActiveRustCore {
  key: string;
  child: RustCoreChild;
  client: RustCoreClientLike;
}

export class RustCoreService {
  private readonly options: RustCoreServiceOptions;
  private readonly spawnProcess: NonNullable<RustCoreServiceOptions["spawnProcess"]>;
  private readonly createClient: RustCoreServiceOptions["createClient"];
  private active: ActiveRustCore | null = null;
  private transition: Promise<unknown> = Promise.resolve();
  private stopped = false;

  constructor(options: RustCoreServiceOptions) {
    if (!isAbsolute(options.binaryPath)) throw new Error("BRAIN_CORE_BINARY_PATH_REQUIRED: binary path must be absolute.");
    this.options = options;
    this.spawnProcess = options.spawnProcess
      ?? ((executable, args, spawnOptions) => spawn(executable, args, spawnOptions));
    this.createClient = options.createClient;
  }

  acquire(binding: RustCoreProjectBinding): Promise<RustCoreClientLike> {
    const operation = this.transition.then(() => this.acquireOnce(binding));
    this.transition = operation.then(() => undefined, () => undefined);
    return operation;
  }

  shutdown(): Promise<void> {
    if (this.stopped) return this.transition.then(() => undefined);
    this.stopped = true;
    const operation = this.transition.then(() => this.stopActive());
    this.transition = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async acquireOnce(binding: RustCoreProjectBinding) {
    if (this.stopped) throw new Error("BRAIN_CORE_STOPPED: Rust Core service is stopped.");
    const projectId = binding.projectId.trim();
    const workspaceType = binding.workspaceType.trim();
    if (!projectId || !workspaceType || !isAbsolute(binding.projectRoot)) {
      throw new Error("BRAIN_CORE_PROJECT_BINDING_INVALID: project binding is incomplete.");
    }
    const projectRoot = normalize(binding.projectRoot);
    const key = `${projectId}\0${workspaceType}\0${projectRoot}`;
    if (this.active?.key === key) return this.active.client;
    await this.stopActive();

    const child = this.options.processManager.track(this.spawnProcess(
      this.options.binaryPath,
      ["--project-root", projectRoot],
      {
        cwd: projectRoot,
        env: rustCoreChildEnvironment(this.options.environment ?? process.env),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      }
    ));
    let client: RustCoreClientLike | null = null;
    try {
      client = this.createClient(child);
      const requestId = `rust-health-${randomUUID()}`;
      const response = await client.request({
        request_id: requestId,
        project_id: projectId,
        workspace_type: workspaceType,
        operation: "health.check",
        approval_token: "",
        resource_limits: { timeout_ms: 5_000, max_output_bytes: 4_096 },
        payload: {}
      });
      if (response.status !== "completed") {
        throw new Error(`${response.error_code || "BRAIN_CORE_NOT_READY"}: Rust Core health check failed.`);
      }
    } catch (error) {
      try { await client?.shutdown(); } catch { /* process manager still guarantees cleanup */ }
      await this.options.processManager.stop(child);
      throw error;
    }
    this.active = { key, child, client };
    return client;
  }

  private async stopActive() {
    const active = this.active;
    this.active = null;
    if (!active) return;
    try {
      await active.client.shutdown();
    } finally {
      await this.options.processManager.stop(active.child);
    }
  }
}
