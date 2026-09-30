import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

const serviceModule = await import(new URL("./mcp-process-service.ts", import.meta.url).href);

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { throw new Error("raw kill must not be used"); };
  return child;
}

function server(id: string) {
  return { id, name: id, transport: "stdio", command: "node", args: ["fixture.js"], env: {}, enabled: true };
}

test("tracks MCP children and stops them through the shared process manager", async () => {
  const child = fakeChild();
  const calls: string[] = [];
  const processManager = {
    track: <T>(tracked: T) => { assert.equal(tracked, child); calls.push("track"); return tracked; },
    stop: async (tracked: unknown) => { assert.equal(tracked, child); calls.push("stop"); }
  };
  const service = new serviceModule.McpProcessService({
    cwd: "C:/workspace",
    spawnProcess: () => child,
    processManager,
    now: () => new Date("2026-07-23T00:00:00.000Z")
  });

  assert.equal((await service.start(server("one"))).running, true);
  assert.equal((await service.stop(server("one"))).running, false);
  assert.deepEqual(calls, ["track", "stop"]);
});

test("shuts down every MCP child through the shared manager and bounds logs", async () => {
  const children = [fakeChild(), fakeChild()];
  const stopped: unknown[] = [];
  const service = new serviceModule.McpProcessService({
    cwd: "C:/workspace",
    spawnProcess: () => children.shift(),
    processManager: { track: <T>(child: T) => child, stop: async (child: unknown) => { stopped.push(child); } },
    now: () => new Date("2026-07-23T00:00:00.000Z")
  });
  const first = server("one");
  const second = server("two");
  await service.start(first);
  await service.start(second);
  for (let index = 0; index < 250; index += 1) service.appendLog(first.id, `line ${index}`);

  await service.shutdown();

  assert.equal(stopped.length, 2);
  assert.equal(service.getLogs(first.id).length, 200);
  assert.equal(service.isRunning(first.id), false);
  assert.equal(service.isRunning(second.id), false);
});
