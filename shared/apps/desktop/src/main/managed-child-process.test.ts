import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

const processModule = await import(new URL("./managed-child-process.ts", import.meta.url).href);

function fakeChild(pid = 4321) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    exitCode: number | null;
    killed: boolean;
    signals: Array<NodeJS.Signals | number | undefined>;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  child.pid = pid;
  child.exitCode = null;
  child.killed = false;
  child.signals = [];
  child.kill = (signal) => {
    child.killed = true;
    child.signals.push(signal);
    return true;
  };
  return child;
}

test("stops a tracked child gracefully without forcing its process tree", async () => {
  const child = fakeChild();
  const treeKills: number[] = [];
  const manager = new processModule.ManagedChildProcessManager({
    platform: "win32",
    waitForExit: async () => true,
    killTree: async (pid: number) => { treeKills.push(pid); }
  });

  manager.track(child);
  await manager.stop(child);

  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.deepEqual(treeKills, []);
  assert.equal(manager.size, 0);
});

test("forces the Windows process tree when graceful shutdown times out", async () => {
  const child = fakeChild(9876);
  const treeKills: number[] = [];
  const manager = new processModule.ManagedChildProcessManager({
    platform: "win32",
    gracefulTimeoutMs: 25,
    waitForExit: async (_child: unknown, timeoutMs: number) => {
      assert.equal(timeoutMs, 25);
      return false;
    },
    killTree: async (pid: number) => { treeKills.push(pid); }
  });

  manager.track(child);
  await manager.stop(child);

  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.deepEqual(treeKills, [9876]);
  assert.equal(manager.size, 0);
});

test("deduplicates concurrent stops and shuts down every tracked child", async () => {
  const first = fakeChild(1);
  const second = fakeChild(2);
  const manager = new processModule.ManagedChildProcessManager({ waitForExit: async () => true });
  manager.track(first);
  manager.track(second);

  await Promise.all([manager.stop(first), manager.stop(first)]);
  await manager.shutdown();

  assert.deepEqual(first.signals, ["SIGTERM"]);
  assert.deepEqual(second.signals, ["SIGTERM"]);
  assert.equal(manager.size, 0);
});

test("builds the Windows tree-kill command without a shell", () => {
  assert.deepEqual(processModule.windowsTreeKillCommand(321), {
    executable: "taskkill.exe",
    args: ["/PID", "321", "/T", "/F"]
  });
});
