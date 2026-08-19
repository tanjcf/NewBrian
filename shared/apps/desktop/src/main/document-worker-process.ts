import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore Node's native TypeScript test runner loads the source extension directly.
import { DocumentWorkerClient } from "./document-worker-client.ts";

export interface DocumentWorkerProcessOptions {
  appDirectory: string;
  resourcesPath?: string;
  workerSourcePath?: string;
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
    if (!this.client) this.start();
    return this.client!.ingest(input);
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
    this.client = new DocumentWorkerClient({ child, defaultTimeoutMs: 30_000 });
  }

  private resolveWorkerPath() {
    const candidates = [
      this.options.workerSourcePath,
      this.options.resourcesPath ? join(this.options.resourcesPath, "document-worker.js") : "",
      join(this.options.appDirectory, "document-worker.js"),
      join(this.options.appDirectory, "../../../../shared/apps/desktop/src/main/document-worker.js")
    ].filter(Boolean) as string[];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) throw new Error("DOCUMENT_WORKER_NOT_PACKAGED");
    return path;
  }
}
