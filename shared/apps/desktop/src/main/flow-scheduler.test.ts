import assert from "node:assert/strict";
import test from "node:test";
import { FlowScheduler, type FlowSchedule } from "./flow-scheduler.ts";

test("claims each Flow occurrence once and respects local run time", async () => {
  const schedule: FlowSchedule = { id: "schedule-1", ownerId: "owner-a", flowId: "flow-1", enabled: true, timezone: "Asia/Shanghai", runAt: "15:10" };
  const claims = new Set<string>(); let executions = 0;
  const scheduler = new FlowScheduler({ store: { listEnabled: () => [schedule], claim: (_id, key) => !claims.has(key) && (claims.add(key), true), fail: () => {}, complete: () => {} }, resolveOwnerId: () => "owner-a", getFlow: () => ({ id: "flow-1", projectId: "project-1", name: "flow", definition: { schemaVersion: 1, nodes: [{ id: "start", type: "start" }] }, createdAt: "", updatedAt: "" }), execute: async () => { executions += 1; } });
  await scheduler.tick(new Date("2026-08-21T07:09:00.000Z"));
  await scheduler.tick(new Date("2026-08-21T07:10:00.000Z"));
  await scheduler.tick(new Date("2026-08-21T07:11:00.000Z"));
  assert.equal(executions, 1);
});
