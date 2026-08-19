import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import {
  parseRustCoreRequest,
  parseRustCoreResponse,
  RUST_CORE_PROTOCOL_VERSION,
  type RustCoreRequest,
  type RustCoreResponse
} from "@codex-forge/protocol/rust-core";

interface RustCoreChild {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit" | "error", listener: (...args: unknown[]) => void): unknown;
}

interface RustCoreClientOptions {
  child: RustCoreChild;
  defaultTimeoutMs?: number;
}

type RustCoreRequestInput = Omit<RustCoreRequest, "protocol_version">;
type RustCoreApprovedRequestInput = Omit<RustCoreRequestInput, "approval_token">;

const allowedEnvironmentKeys = new Set([
  "PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMP", "TEMP",
  "LANG", "LC_ALL", "LC_CTYPE", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"
]);

export function rustCoreChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => allowedEnvironmentKeys.has(key) && typeof value === "string")
  );
}

export class RustCoreClient {
  private readonly child: RustCoreChild;
  private readonly defaultTimeoutMs: number;
  private readonly pending = new Map<string, {
    resolve: (response: RustCoreResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly lines;
  private stopped = false;

  constructor(options: RustCoreClientOptions) {
    this.child = options.child;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.acceptLine(line));
    this.child.once("exit", () => this.failAll("BRAIN_CORE_EXITED", "Rust Core exited."));
    this.child.once("error", () => this.failAll("BRAIN_CORE_SPAWN_FAILED", "Rust Core process failed."));
  }

  request(input: RustCoreRequestInput): Promise<RustCoreResponse> {
    if (this.stopped) return Promise.reject(new Error("BRAIN_CORE_STOPPED: Rust Core client is stopped."));
    const request = parseRustCoreRequest({ ...input, protocol_version: RUST_CORE_PROTOCOL_VERSION });
    if (this.pending.has(request.request_id)) {
      return Promise.reject(new Error(`BRAIN_CORE_DUPLICATE_REQUEST: ${request.request_id}`));
    }
    const timeoutMs = Math.min(this.defaultTimeoutMs, request.resource_limits.timeout_ms);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.request_id);
        this.writeFrame({
          protocol_version: RUST_CORE_PROTOCOL_VERSION,
          request_id: `${request.request_id}:cancel`,
          project_id: request.project_id,
          workspace_type: request.workspace_type,
          operation: "request.cancel",
          approval_token: request.approval_token,
          resource_limits: { timeout_ms: 1000, max_output_bytes: 1024 },
          payload: { target_request_id: request.request_id }
        });
        reject(new Error(`BRAIN_CORE_TIMEOUT: ${request.request_id}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(request.request_id, { resolve, reject, timer });
      this.writeFrame(request);
    });
  }

  async requestWithApproval(input: RustCoreApprovedRequestInput): Promise<RustCoreResponse> {
    const token = randomBytes(32).toString("base64url");
    const registration = await this.request({
      request_id: `${input.request_id}:approval`,
      project_id: input.project_id,
      workspace_type: input.workspace_type,
      operation: "approval.register",
      approval_token: "",
      resource_limits: {
        timeout_ms: Math.min(input.resource_limits.timeout_ms, 300_000),
        max_output_bytes: 1024
      },
      payload: {
        token,
        operation: input.operation,
        ttl_ms: Math.min(input.resource_limits.timeout_ms, 300_000)
      }
    });
    if (registration.status !== "completed") {
      throw new Error(`${registration.error_code || "BRAIN_CORE_APPROVAL_FAILED"}: approval registration failed.`);
    }
    return this.request({ ...input, approval_token: token });
  }

  async shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    this.lines.close();
    this.failAll("BRAIN_CORE_STOPPED", "Rust Core client stopped.");
    if (this.child.exitCode === null) this.child.kill("SIGTERM");
  }

  private writeFrame(frame: RustCoreRequest) {
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private acceptLine(line: string) {
    let response: RustCoreResponse;
    try {
      response = parseRustCoreResponse(JSON.parse(line));
    } catch {
      this.failAll("BRAIN_CORE_PROTOCOL_ERROR", "Rust Core returned an invalid response.");
      return;
    }
    const pending = this.pending.get(response.request_id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.request_id);
    pending.resolve(response);
  }

  private failAll(code: string, message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`${code}: ${message}`));
    }
    this.pending.clear();
  }
}
