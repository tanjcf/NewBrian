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
export { rustCoreChildEnvironment } from "./rust-core-environment.js";

export interface RustCoreChild {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit" | "error", listener: (...args: unknown[]) => void): unknown;
}

interface RustCoreClientOptions {
  child: RustCoreChild;
}

type RustCoreRequestInput = Omit<RustCoreRequest, "protocol_version">;
type RustCoreApprovedRequestInput = Omit<RustCoreRequestInput, "approval_token">;

export class RustCoreClient {
  private readonly child: RustCoreChild;
  private readonly pending = new Map<string, {
    resolve: (response: RustCoreResponse) => void;
    reject: (error: Error) => void;
  }>();
  private readonly lines;
  private stopped = false;

  constructor(options: RustCoreClientOptions) {
    this.child = options.child;
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
    return new Promise((resolve, reject) => {
      this.pending.set(request.request_id, { resolve, reject });
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
        timeout_ms: 0,
        max_output_bytes: 1024
      },
      payload: {
        token,
        operation: input.operation,
        ttl_ms: 0
      }
    });
    if (registration.status !== "completed") {
      throw new Error(`${registration.error_code || "BRAIN_CORE_APPROVAL_FAILED"}: approval registration failed.`);
    }
    return this.request({ ...input, approval_token: token });
  }

  conversation(input: { request_id: string; project_id: string; workspace_type: string; operation: `conversation.${string}`; payload: Record<string, unknown> }): Promise<RustCoreResponse> {
    return this.request({ ...input, approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 1_048_576 } });
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
    this.pending.delete(response.request_id);
    pending.resolve(response);
  }

  private failAll(code: string, message: string) {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(`${code}: ${message}`));
    }
    this.pending.clear();
  }
}
