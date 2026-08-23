import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import test from "node:test";

const binaryCandidates = [
  ...(process.env.BRAIN_RUST_CORE_BINARY ? [pathToFileURL(process.env.BRAIN_RUST_CORE_BINARY)] : []),
  new URL("../../../../../rust/brain-core/target/debug/brain-core.exe", import.meta.url),
  new URL("../../../../../rust/brain-core/target/debug/brain-core", import.meta.url)
];

test("real Rust Core binds the project, enforces approval replay, traversal, and cancellation", async (context) => {
  const binary = binaryCandidates.find((candidate) => existsSync(candidate));
  if (!binary) return context.skip("Rust Core debug binary is not built for this platform.");
  const projectRoot = await mkdtemp(join(tmpdir(), "brain-core-real-"));
  await writeFile(join(projectRoot, "seed.txt"), "seed", "utf8");
  const child = spawn(fileURLToPath(binary), ["--project-root", projectRoot], {
    cwd: projectRoot,
    env: {
      ...(process.env.Path ? { Path: process.env.Path } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {})
    },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  assert.ok(child.stdin && child.stdout && child.stderr);
  const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: unknown) => void; timer: NodeJS.Timeout }>();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const value = JSON.parse(line) as { request_id: string };
    const waiting = pending.get(value.request_id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.delete(value.request_id);
    waiting.resolve(value);
  });
  const request = (input: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
    const frame = {
      protocol_version: "1", project_id: "project-real", workspace_type: "game",
      approval_token: "", resource_limits: { timeout_ms: 0, max_output_bytes: 16_384 }, payload: {}, ...input
    };
    const requestId = String(frame.request_id);
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Rust Core response timeout: ${requestId}`)); }, 10_000);
    pending.set(requestId, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  });

  try {
    const health = await request({ request_id: "health", operation: "health.check" });
    assert.equal((health.result as { ready?: boolean }).ready, true);

    const read = await request({ request_id: "read", operation: "file.read", payload: { path: "seed.txt" } });
    assert.equal(Buffer.from((read.result as { data_base64: string }).data_base64, "base64").toString("utf8"), "seed");

    const token = randomBytes(32).toString("base64url");
    const approval = await request({
      request_id: "approve-write", operation: "approval.register",
      payload: { token, operation: "file.write", ttl_ms: 30_000 }
    });
    assert.equal(approval.status, "completed");
    const write = await request({
      request_id: "write", operation: "file.write", approval_token: token,
      payload: { path: "written.txt", data_base64: Buffer.from("written").toString("base64") }
    });
    assert.equal(write.status, "completed");
    assert.equal(await readFile(join(projectRoot, "written.txt"), "utf8"), "written");
    const replay = await request({
      request_id: "write-replay", operation: "file.write", approval_token: token,
      payload: { path: "replayed.txt", data_base64: Buffer.from("no").toString("base64") }
    });
    assert.match(replay.error_code, /^BRAIN_CORE_APPROVAL_/u);

    const traversal = await request({ request_id: "escape", operation: "file.read", payload: { path: "../outside.txt" } });
    assert.equal(traversal.error_code, "BRAIN_CORE_PATH_ESCAPE");

    const processToken = randomBytes(32).toString("base64url");
    await request({
      request_id: "approve-process", operation: "approval.register",
      payload: { token: processToken, operation: "process.run", ttl_ms: 30_000 }
    });
    const running = request({
      request_id: "long-process", operation: "process.run", approval_token: processToken,
      resource_limits: { timeout_ms: 0, max_output_bytes: 16_384 },
      payload: { executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: "." }
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cancelled = await request({
      request_id: "cancel-process", operation: "request.cancel",
      payload: { target_request_id: "long-process" }
    });
    assert.equal(cancelled.status, "completed");
    const processResult = await running;
    assert.equal(processResult.status, "cancelled");
    assert.equal(processResult.error_code, "BRAIN_CORE_CANCELLED");
  } finally {
    lines.close();
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
});
