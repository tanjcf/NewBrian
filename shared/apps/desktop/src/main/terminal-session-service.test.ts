import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

const policy = await import(new URL("./terminal-session-service.ts", import.meta.url).href);

test("normalizes platform newlines while preserving terminal line boundaries", () => {
  assert.deepEqual(policy.appendTerminalOutput(["existing"], "one\r\ntwo\rthree"), [
    "existing", "one", "two", "three"
  ]);
});

test("ignores an empty single chunk but preserves explicit trailing newlines", () => {
  assert.deepEqual(policy.appendTerminalOutput(["existing"], ""), ["existing"]);
  assert.deepEqual(policy.appendTerminalOutput([], "line\n"), ["line", ""]);
});

test("keeps only the configured terminal history tail", () => {
  assert.deepEqual(policy.appendTerminalOutput(["one", "two"], "three\nfour", 3), ["two", "three", "four"]);
  assert.equal(policy.trimTerminalLines(Array.from({ length: 1300 }, (_, index) => String(index))).length, 1200);
});

test("owns shell lifecycle and publishes immutable snapshots", () => {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => boolean };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  const updates: Array<{ isRunning: boolean; lines: string[]; lastExitCode?: number | null }> = [];
  const service = new policy.TerminalSessionService({
    cwd: "C:/workspace",
    shell: "powershell.exe",
    prompt: "PS>",
    platform: "win32",
    nowIso: () => "2026-07-17T08:00:00.000Z",
    spawnShell: () => child,
    onUpdate: (snapshot: { isRunning: boolean; lines: string[]; lastExitCode?: number | null }) => updates.push(snapshot)
  });

  service.ensure({ NEWBRAIN_TEST: "1" });
  child.stdout.write("hello\r\n");
  child.emit("exit", 7);
  assert.equal(service.snapshot().isRunning, false);
  assert.equal(service.snapshot().lastExitCode, 7);
  assert.match(service.snapshot().lines.join("\n"), /hello/);
  assert.match(service.snapshot().lines.at(-1), /退出码 7/);
  const snapshot = service.snapshot();
  snapshot.lines.push("external mutation");
  assert.equal(service.snapshot().lines.includes("external mutation"), false);
  assert.ok(updates.length >= 3);
});

test("registers and stops the shell through the shared process manager", async () => {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => boolean };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => { throw new Error("raw kill must not be used"); };
  const calls: string[] = [];
  const processManager = {
    track: <T>(tracked: T) => { assert.equal(tracked, child); calls.push("track"); return tracked; },
    stop: async (tracked: unknown) => { assert.equal(tracked, child); calls.push("stop"); }
  };
  const service = new policy.TerminalSessionService({
    cwd: "C:/workspace",
    shell: "powershell.exe",
    prompt: "PS>",
    spawnShell: () => child,
    processManager
  });

  service.ensure({});
  await service.stop();

  assert.deepEqual(calls, ["track", "stop"]);
  assert.equal(service.snapshot().isRunning, false);
});
