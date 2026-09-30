import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore Node's native TypeScript test runner loads the source extension directly.
import { DocumentWorkerClient } from "./document-worker-client.ts";
import { parseDocumentWorkerResponse, type DocumentWorkerResponse } from "@codex-forge/protocol/document-worker";
import type { RustCoreRequest, RustCoreResponse } from "@codex-forge/protocol/rust-core";

interface DocumentRustCoreClient {
  request(input: Omit<RustCoreRequest, "protocol_version">): Promise<RustCoreResponse>;
}

export interface DocumentWorkerProcessOptions {
  appDirectory: string;
  resourcesPath?: string;
  workerSourcePath?: string;
  acquireRustCore?: (binding: { projectId: string; projectRoot: string; workspaceType: string }) => Promise<DocumentRustCoreClient | null>;
}

/** Owns one bounded document worker for the lifetime of the Electron main process. */
export class DocumentWorkerProcess {
  private client: DocumentWorkerClient | null = null;
  private child: ChildProcessByStdio<import("node:stream").Writable, import("node:stream").Readable, null> | null = null;
  private readonly options: DocumentWorkerProcessOptions;

  constructor(options: DocumentWorkerProcessOptions) {
    this.options = options;
  }

  async ingest(input: {
    requestId: string;
    projectRoot: string;
    relativePath: string;
    maxBytes?: number;
  }) {
    const rustResult = await this.ingestWithRust(input);
    if (rustResult) return rustResult;
    if (!this.client) this.start();
    return this.client!.ingest(input);
  }

  private async ingestWithRust(input: { requestId: string; projectRoot: string; relativePath: string; maxBytes?: number }): Promise<DocumentWorkerResponse | null> {
    if (!this.options.acquireRustCore) return null;
    const projectId = `document-${createHash("sha256").update(input.projectRoot).digest("hex").slice(0, 24)}`;
    let client: DocumentRustCoreClient | null;
    try {
      client = await this.options.acquireRustCore({ projectId, projectRoot: input.projectRoot, workspaceType: "document" });
    } catch {
      return null;
    }
    if (!client) return null;
    const response = await client.request({
      request_id: input.requestId,
      project_id: projectId,
      workspace_type: "document",
      operation: "document.ingest",
      approval_token: "",
      resource_limits: { timeout_ms: 0, max_output_bytes: Math.min(Math.max(input.maxBytes ?? 5 * 1024 * 1024, 64 * 1024), 16 * 1024 * 1024) },
      payload: { relative_path: input.relativePath, max_bytes: input.maxBytes ?? 5 * 1024 * 1024 }
    });
    if (response.status !== "completed") throw new Error(`${response.error_code || "BRAIN_CORE_DOCUMENT_FAILED"}: Rust-supervised document ingestion failed.`);
    return parseDocumentWorkerResponse(response.result);
  }

  async shutdown() {
    const client = this.client;
    this.client = null;
    this.child = null;
    await client?.shutdown();
  }

  private start() {
    const workerPath = this.resolveWorkerPath();
    const child = spawn(process.execPath, [workerPath], {
      env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production" },
      stdio: ["pipe", "pipe", "ignore"]
    });
    this.child = child;
    this.client = new DocumentWorkerClient({ child });
  }

  private resolveWorkerPath() {
    const candidates = [
      this.options.workerSourcePath,
      this.options.resourcesPath ? join(this.options.resourcesPath, "document-worker.js") : "",
      join(this.options.appDirectory, "../../document-worker.js"),
      join(this.options.appDirectory, "document-worker.js"),
      join(this.options.appDirectory, "../../../../shared/apps/desktop/src/main/document-worker.js")
    ].filter(Boolean) as string[];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) throw new Error("DOCUMENT_WORKER_NOT_PACKAGED");
    return path;
  }
}
