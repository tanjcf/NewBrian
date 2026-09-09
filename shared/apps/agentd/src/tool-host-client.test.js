import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { ToolHostClient } from "./tool-host-client.js";

test("executes a builtin write in an isolated Tool Host process", async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "newbrain-tool-host-"));
  try {
    const client = new ToolHostClient({ timeoutMs: 10_000 });
    const result = await client.invoke("workspace.write_file", { targetPath: "hosted.txt", content: "isolated" }, { workspacePath, shellEnv: {} });
    assert.equal(result.ok, true);
    assert.equal(await readFile(path.join(workspacePath, "hosted.txt"), "utf8"), "isolated");
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test("contains unknown-tool failures inside the Tool Host", async () => {
  const client = new ToolHostClient({ timeoutMs: 10_000 });
  const result = await client.invoke("missing.tool", {}, { workspacePath: tmpdir(), shellEnv: {} });
  assert.equal(result.ok, false);
  assert.match(result.output, /Unknown tool/);
});

test("cancels a running Tool Host and its command tree", async () => {
  const controller = new AbortController();
  const client = new ToolHostClient({ timeoutMs: 10_000 });
  const startedAt = Date.now();
  const pending = client.invoke("shell.exec", {
    command: process.platform === "win32" ? "Start-Sleep -Seconds 5" : "sleep 5"
  }, { workspacePath: tmpdir(), shellEnv: {}, abortSignal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  const result = await pending;
  assert.equal(result.hostFailure, "aborted");
  assert.match(result.output, /工具宿主执行已取消|cancelled/i);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("formats host failures as non-security Chinese diagnostics", async () => {
  const { formatToolHostFailure } = await import("./tool-host-client.js");
  assert.match(formatToolHostFailure("exit"), /并非安全策略拦截/);
  assert.match(formatToolHostFailure("exit"), /自动重启/);
  assert.match(formatToolHostFailure("output_limit"), /workspace\.search|并非安全策略拦截/);
});

test("auto-restarts worker once after a crash for the same call", async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "newbrain-tool-host-restart-"));
  const crashOnceWorker = path.join(workspacePath, "crash-once-worker.mjs");
  await writeFile(crashOnceWorker, `
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
const marker = join(${JSON.stringify(workspacePath)}, "restarted.flag");
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (!existsSync(marker)) {
    writeFileSync(marker, "1");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({ id: request.id, result: { ok: true, exitCode: 0, output: "recovered", toolName: request.name } }) + "\\n");
});
`);
  try {
    const client = new ToolHostClient({
      timeoutMs: 10_000,
      workerUrl: pathToFileURL(crashOnceWorker),
      maxRetries: 1
    });
    const result = await client.invoke("workspace.scan", {}, { workspacePath, shellEnv: {} });
    assert.equal(result.ok, true);
    assert.equal(result.hostRestarted, true);
    assert.match(result.output, /recovered/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});
