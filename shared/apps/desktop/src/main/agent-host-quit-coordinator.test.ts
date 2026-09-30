import assert from "node:assert/strict";
import test from "node:test";

const coordinatorModule = await import(new URL("./agent-host-quit-coordinator.ts", import.meta.url).href);

test("blocks quit until one host shutdown completes, then allows the retry", async () => {
  let release!: () => void;
  const shutdownGate = new Promise<void>((resolve) => { release = resolve; });
  let shutdowns = 0;
  let quits = 0;
  let prevented = 0;
  const coordinator = coordinatorModule.createAgentHostQuitCoordinator({
    shutdown: async () => { shutdowns += 1; await shutdownGate; },
    quit: () => { quits += 1; }
  });
  const event = { preventDefault: () => { prevented += 1; } };

  coordinator.beforeQuit(event);
  coordinator.beforeQuit(event);
  assert.equal(shutdowns, 1);
  assert.equal(prevented, 2);
  assert.equal(quits, 0);

  release();
  await coordinator.wait();
  assert.equal(quits, 1);

  coordinator.beforeQuit(event);
  assert.equal(prevented, 2);
  assert.equal(shutdowns, 1);
});

test("reports shutdown failure but still releases application quit", async () => {
  const errors: unknown[] = [];
  let quits = 0;
  const coordinator = coordinatorModule.createAgentHostQuitCoordinator({
    shutdown: async () => { throw new Error("host failed"); },
    quit: () => { quits += 1; },
    onError: (error: unknown) => errors.push(error)
  });

  coordinator.beforeQuit({ preventDefault: () => undefined });
  await coordinator.wait();

  assert.equal(errors.length, 1);
  assert.equal(quits, 1);
});
