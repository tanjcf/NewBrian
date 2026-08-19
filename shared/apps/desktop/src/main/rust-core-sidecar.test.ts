import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { RustCoreSidecar } from "./rust-core-sidecar.ts";

function child() {
  const value = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    kill: () => boolean;
  };
  value.stdin = new PassThrough();
  value.stdout = new PassThrough();
  value.stderr = new PassThrough();
  value.exitCode = null;
  value.kill = () => { value.exitCode = 0; value.emit("exit", 0, null); return true; };
  return value;
}

test("starts Rust Core with a project root and a secret-free environment", async () => {
  const spawned: Array<{ executable: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const process = child();
  const sidecar = new RustCoreSidecar({
    executable: "brain-core.exe",
    projectRoot: "C:/workspace/project",
    environment: { PATH: "C:/Windows", OPENAI_API_KEY: "must-not-pass" },
    spawnProcess: (executable, args, options) => {
      spawned.push({ executable, args, env: options.env ?? {} });
      return process;
    },
    track: (value) => value,
    defaultTimeoutMs: 1000
  });
  const start = sidecar.start();
  await new Promise((resolve) => setImmediate(resolve));
  const frame = JSON.stringify({
    protocol_version: "1", request_id: "health", status: "completed", error_code: "", artifacts: [],
    result: { ready: true, protocol_version: "1" }
  });
  process.stdout.write(`${frame}\n`);
  const client = await start;
  assert.ok(client);
  assert.deepEqual(spawned[0]?.args, ["--project-root", "C:/workspace/project"]);
  assert.equal(spawned[0]?.env.OPENAI_API_KEY, undefined);
  assert.equal(spawned[0]?.env.PATH, "C:/Windows");
  await sidecar.shutdown();
});

test("reports an unavailable sidecar when the executable is absent", async () => {
  const sidecar = new RustCoreSidecar({
    executable: "missing-brain-core",
    projectRoot: "C:/workspace/project",
    spawnProcess: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    track: (value) => value
  });
  await assert.rejects(sidecar.start(), /BRAIN_CORE_UNAVAILABLE/u);
});
