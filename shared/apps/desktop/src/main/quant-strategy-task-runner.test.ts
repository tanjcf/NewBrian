import assert from "node:assert/strict";
import test from "node:test";
import type { QuantBar, SimulatedOrder } from "@codex-forge/protocol/quant-types";
import type { BrainTaskRecord } from "./brain-workspace-storage.ts";
import { QuantSimulationService } from "./quant-simulation-service.ts";
import { QuantStrategyTaskRunner } from "./quant-strategy-task-runner.ts";

function bars(rising = true): QuantBar[] {
  return Array.from({ length: 24 }, (_, index) => {
    const close = rising ? 10 + index : 34 - index;
    return { symbol: "600519", exchange: "SSE", timezone: "Asia/Shanghai", interval: "1d", adjustment: "forward",
      timestamp: `2026-07-${String(index + 1).padStart(2, "0")}T15:00:00+08:00`, open: close, high: close + 1, low: close - 1,
      close, volume: 1000, turnover: 10000, changePercent: 1, source: { provider: "fixture", dataset: "test", fetchedAt: "2026-08-20T00:00:00Z" } };
  });
}

function task(skillId = "trend-following"): BrainTaskRecord {
  return { id: "task-1", projectId: "project-1", conversationId: "", workspaceKey: "quant", taskType: `quant.strategy.${skillId}`,
    status: "QUEUED", progress: 0, requestId: "request-1", idempotencyKey: "quant-strategy:schedule-1:2026-08-20",
    attempt: 0, maxAttempts: 3, resourceLimitsJson: JSON.stringify({ exchange: "SSE", tradingDate: "2026-08-20", symbol: "600519", quantity: 100, strategyId: "trend-following", simulationOnly: true }),
    resultJson: "{}", errorCode: "", errorDetail: "", startedAt: "", finishedAt: "", heartbeatAt: "" };
}

test("consumes a strategy task and writes simulated fill and performance", async () => {
  const current = task(); const updates: Array<Partial<BrainTaskRecord>> = [];
  const simulation = new QuantSimulationService(undefined);
  simulation.createSession(current.projectId, 100_000, bars(true));
  const runner = new QuantStrategyTaskRunner({
    resolveOwnerId: () => "owner-a",
    store: {
      listRunnableQuantStrategyTasks: () => [current],
      claimQuantStrategyTask: () => ({ ...current, status: "RUNNING", attempt: 1 }),
      getTask: () => current,
      updateTask: (input) => { updates.push(input); return { ...current, ...input }; }
    },
    simulation
  });
  await runner.tick();
  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
  const result = JSON.parse(String(updates.at(-1)?.resultJson));
  assert.equal(result.simulationOnly, true);
  assert.equal(result.signal, "buy");
  assert.equal(result.fill.quantity, 100);
  assert.equal(result.performance.tradeCount, 1);
});

test("does not accumulate another position when the strategy is already aligned", async () => {
  const current = task(); const orders: SimulatedOrder[] = []; const simulation = new QuantSimulationService();
  simulation.createSession(current.projectId, 100_000, bars(true));
  const original = simulation.executeOrder.bind(simulation);
  simulation.executeOrder = (projectId, order) => { orders.push(order); return original(projectId, order); };
  const store = { listRunnableQuantStrategyTasks: () => [current], claimQuantStrategyTask: () => current, getTask: () => current,
    updateTask: (input: any) => ({ ...current, ...input }) };
  const runner = new QuantStrategyTaskRunner({ store, simulation, resolveOwnerId: () => "owner-a" });
  await runner.tick();
  await runner.tick();
  assert.equal(orders.length, 1);
});

test("runs a supported signal strategy into a custom Skill ledger", async () => {
  const current = task("custom-portfolio"); const updates: any[] = []; const simulation = new QuantSimulationService();
  simulation.createSession(current.projectId, 100_000, bars(true));
  const runner = new QuantStrategyTaskRunner({
    resolveOwnerId: () => "owner-a", simulation,
    store: { listRunnableQuantStrategyTasks: () => [current], claimQuantStrategyTask: () => current, getTask: () => current,
      updateTask: (input) => { updates.push(input); return { ...current, ...input }; } }
  });
  await runner.tick();
  assert.equal(updates.at(-1)?.status, "SUCCEEDED");
  assert.equal(JSON.parse(updates.at(-1)?.resultJson).skillId, "custom-portfolio");
});

test("rejects non-simulation task configuration before reading market data", async () => {
  const current = { ...task(), resourceLimitsJson: JSON.stringify({ exchange: "SSE", tradingDate: "2026-08-20", symbol: "600519", quantity: 100, simulationOnly: false }) };
  const updates: any[] = []; let queried = false;
  const runner = new QuantStrategyTaskRunner({ resolveOwnerId: () => "owner-a",
    store: { listRunnableQuantStrategyTasks: () => [current], claimQuantStrategyTask: () => current, getTask: () => current,
      updateTask: (input) => { updates.push(input); return { ...current, ...input }; } },
    simulation: { createSession: () => {}, queryBarsAsync: async () => { queried = true; return []; }, skillSnapshot: () => { throw new Error("unexpected"); },
      executeOrder: () => { throw new Error("unexpected"); }, recordSkillSnapshot: () => {}, performance: () => { throw new Error("unexpected"); } }
  });
  await runner.tick();
  assert.equal(queried, false);
  assert.equal(updates.at(-1)?.errorCode, "QUANT_TASK_CONFIG_INVALID");
});

test("honors cancellation after market data returns and before simulated trading", async () => {
  const current = task(); let traded = false; let updated = false;
  const simulation = new QuantSimulationService();
  simulation.createSession(current.projectId, 100_000, bars(true));
  const original = simulation.executeOrder.bind(simulation);
  simulation.executeOrder = (projectId, order) => { traded = true; return original(projectId, order); };
  const runner = new QuantStrategyTaskRunner({ resolveOwnerId: () => "owner-a", simulation,
    store: { listRunnableQuantStrategyTasks: () => [current], claimQuantStrategyTask: () => current,
      getTask: () => ({ ...current, status: "CANCELLED" }),
      updateTask: (input) => { updated = true; return { ...current, ...input }; } }
  });
  await runner.tick();
  assert.equal(traded, false);
  assert.equal(updated, false);
});
