import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { normalize } from "node:path";
import test from "node:test";
import { RustCoreService } from "./rust-core-service.ts";

function child() {
  const value = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    pid: number;
    killed: boolean;
    kill: () => boolean;
  };
  value.stdin = new PassThrough();
  value.stdout = new PassThrough();
  value.stderr = new PassThrough();
  value.exitCode = null;
  value.pid = 42;
  value.killed = false;
  value.kill = () => { value.killed = true; return true; };
  return value;
}

test("spawns one sanitized Rust Core per authorized project and performs a health handshake", async () => {
  const spawned: Array<{ executable: string; args: string[]; options: Record<string, unknown> }> = [];
  const requests: Array<Record<string, unknown>> = [];
  const stopped: unknown[] = [];
  const children = [child(), child()];
  let clientIndex = 0;
  const service = new RustCoreService({
    binaryPath: "C:/Program Files/BRAIN/resources/brain-core.exe",
    documentWorkerRuntimePath: "C:/Program Files/BRAIN/BRAIN.exe",
    documentWorkerPath: "C:/Program Files/BRAIN/resources/document-worker.js",
    spawnProcess: (executable, args, options) => {
      spawned.push({ executable, args, options: options as Record<string, unknown> });
      return children[spawned.length - 1]!;
    },
    processManager: {
      track: (process) => process,
      stop: async (process) => { stopped.push(process); }
    },
    createClient: () => {
      const index = clientIndex++;
      return {
        request: async (input) => {
          requests.push(input as unknown as Record<string, unknown>);
          return { protocol_version: "1", request_id: String(input.request_id), status: "completed", error_code: "", artifacts: [], result: { ready: true } };
        },
        requestWithApproval: async () => { throw new Error("unused"); },
        shutdown: async () => { stopped.push(`client-${index}`); }
      };
    },
    environment: {
      PATH: "C:/Windows/System32",
      SystemRoot: "C:/Windows",
      OPENAI_API_KEY: "must-not-leak",
      NEWBRAIN_ACCESS_TOKEN: "must-not-leak"
    }
  });

  const first = await service.acquire({ projectId: "project-1", projectRoot: "C:/work/one", workspaceType: "software" });
  const reused = await service.acquire({ projectId: "project-1", projectRoot: "C:/work/one", workspaceType: "software" });
  assert.equal(first, reused);
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0]?.args, [
    "--project-root", normalize("C:/work/one"),
    "--document-worker-runtime", normalize("C:/Program Files/BRAIN/BRAIN.exe"),
    "--document-worker", normalize("C:/Program Files/BRAIN/resources/document-worker.js")
  ]);
  assert.deepEqual(spawned[0]?.options.env, { PATH: "C:/Windows/System32", SystemRoot: "C:/Windows" });
  assert.equal(requests[0]?.operation, "health.check");

  await service.acquire({ projectId: "project-2", projectRoot: "C:/work/two", workspaceType: "documents" });
  assert.equal(spawned.length, 2);
  assert.deepEqual(stopped.slice(0, 2), ["client-0", children[0]]);
  await service.shutdown();
  assert.deepEqual(stopped.slice(2), ["client-1", children[1]]);
});

test("cleans up a child when the Rust Core health handshake fails", async () => {
  const process = child();
  let stopped = 0;
  const service = new RustCoreService({
    binaryPath: "C:/brain-core.exe",
    spawnProcess: () => process,
    processManager: { track: (value) => value, stop: async () => { stopped += 1; } },
    createClient: () => ({
      request: async () => ({ protocol_version: "1", request_id: "health", status: "failed", error_code: "BRAIN_CORE_NOT_READY", artifacts: [] }),
      requestWithApproval: async () => { throw new Error("unused"); },
      shutdown: async () => undefined
    })
  });
  await assert.rejects(
    service.acquire({ projectId: "project-1", projectRoot: "C:/work", workspaceType: "software" }),
    /BRAIN_CORE_NOT_READY/u
  );
  assert.equal(stopped, 1);
});
