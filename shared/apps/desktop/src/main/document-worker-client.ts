import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  DOCUMENT_WORKER_PROTOCOL_VERSION,
  parseDocumentWorkerResponse,
  type DocumentWorkerRequest,
  type DocumentWorkerResponse
} from "../../../../packages/protocol/src/document-worker.ts";

interface DocumentWorkerChild {
  stdin: Writable;
  stdout: Readable;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit" | "error", listener: (...args: unknown[]) => void): unknown;
}

export interface DocumentWorkerClientOptions {
  child: DocumentWorkerChild;
}

export interface DocumentWorkerIngestInput {
  requestId: string;
  projectRoot: string;
  relativePath: string;
  maxBytes?: number;
}

export class DocumentWorkerClient {
  private readonly child: DocumentWorkerChild;
  private readonly lines;
  private readonly pending = new Map<string, { resolve: (value: DocumentWorkerResponse) => void; reject: (error: Error) => void }>();
  private stopped = false;

  constructor(options: DocumentWorkerClientOptions) {
    this.child = options.child;
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.acceptLine(line));
    this.child.once("exit", () => this.failAll("DOCUMENT_WORKER_EXITED", "Document worker exited."));
    this.child.once("error", () => this.failAll("DOCUMENT_WORKER_SPAWN_FAILED", "Document worker process failed."));
  }

  ingest(input: DocumentWorkerIngestInput): Promise<DocumentWorkerResponse> {
    if (this.stopped) return Promise.reject(new Error("DOCUMENT_WORKER_STOPPED"));
    const request: DocumentWorkerRequest = {
      protocol_version: DOCUMENT_WORKER_PROTOCOL_VERSION,
      request_id: input.requestId.trim(),
      project_root: input.projectRoot,
      relative_path: input.relativePath,
      max_bytes: Math.min(Math.max(Math.trunc(input.maxBytes ?? 5 * 1024 * 1024), 1), 20 * 1024 * 1024)
    };
    if (!request.request_id) return Promise.reject(new Error("DOCUMENT_WORKER_REQUEST_ID_REQUIRED"));
    if (this.pending.has(request.request_id)) return Promise.reject(new Error("DOCUMENT_WORKER_DUPLICATE_REQUEST"));
    return new Promise((resolve, reject) => {
      this.pending.set(request.request_id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  async shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    this.lines.close();
    this.failAll("DOCUMENT_WORKER_STOPPED", "Document worker stopped.");
    if (this.child.exitCode === null) this.child.kill("SIGTERM");
  }

  private acceptLine(line: string) {
    let response: DocumentWorkerResponse;
    try { response = parseDocumentWorkerResponse(JSON.parse(line)); }
    catch { this.failAll("DOCUMENT_WORKER_PROTOCOL_ERROR", "Document worker returned an invalid response."); return; }
    const pending = this.pending.get(response.request_id);
    if (!pending) return;
    this.pending.delete(response.request_id);
    if (response.status === "failed") pending.reject(new Error(`${response.error_code || "DOCUMENT_WORKER_FAILED"}: document ingestion failed`));
    else pending.resolve(response);
  }

  private failAll(code: string, message: string) {
    for (const pending of this.pending.values()) pending.reject(new Error(`${code}: ${message}`));
    this.pending.clear();
  }
}
