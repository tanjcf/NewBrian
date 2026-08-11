import assert from "node:assert/strict";
import test from "node:test";
import { GrowthHostService } from "./growth-host-service.ts";
import type { GrowthControlPlaneService } from "./growth-control-plane-service.ts";

test("GrowthHostService leases due running instances and advances auto nodes", async () => {
  const calls: string[] = [];
  const client = {
    listDueInstances: async () => {
      calls.push("due");
      return {
        items: [
          { id: "gpi_auto", status: "running", cursor_node_id: "n1" },
          { id: "gpi_skip", status: "waiting_human", cursor_node_id: "h1" }
        ]
      };
    },
    lease: async (id: string, owner: string) => {
      calls.push(`lease:${id}:${owner}`);
      return { ok: true };
    },
    advance: async (id: string) => {
      calls.push(`advance:${id}`);
      return { id, status: "running", cursor_node_id: "n2" };
    }
  } as unknown as GrowthControlPlaneService;

  const host = new GrowthHostService({
    client,
    leaseOwner: "host-a",
    isLocallyEnabled: () => true,
    readCapabilities: async () => ({ fleet: { growth_enabled: true } })
  });
  const result = await host.tick();
  assert.equal(result.advanced, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(calls, ["due", "lease:gpi_auto:host-a", "advance:gpi_auto"]);
});

test("GrowthHostService respects fleet.growth_enabled=false", async () => {
  let dueCalled = false;
  const client = {
    listDueInstances: async () => {
      dueCalled = true;
      return { items: [] };
    }
  } as unknown as GrowthControlPlaneService;
  const host = new GrowthHostService({
    client,
    readCapabilities: async () => ({ fleet: { growth_enabled: false } })
  });
  await host.tick();
  assert.equal(dueCalled, false);
});

test("GrowthHostService swallows gateway fetch failures without rejecting the timer", async () => {
  const errors: string[] = [];
  const client = {
    listDueInstances: async () => {
      throw new TypeError("fetch failed");
    }
  } as unknown as GrowthControlPlaneService;
  const host = new GrowthHostService({
    client,
    isLocallyEnabled: () => true,
    readCapabilities: async () => ({ fleet: { growth_enabled: true } }),
    onError: (error) => errors.push(error instanceof Error ? error.message : String(error))
  });
  const result = await host.tick();
  assert.deepEqual(result, { advanced: 0, skipped: 0 });
  assert.deepEqual(errors, ["fetch failed"]);

  let ticks = 0;
  const timerHost = new GrowthHostService({
    client,
    intervalMs: 5_000,
    setIntervalFn: ((fn: () => void) => {
      void Promise.resolve().then(fn);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    clearIntervalFn: (() => undefined) as typeof clearInterval,
    isLocallyEnabled: () => true,
    readCapabilities: async () => {
      ticks += 1;
      return { fleet: { growth_enabled: true } };
    },
    onError: () => undefined
  });
  timerHost.start();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(ticks >= 1);
  timerHost.stop();
});
