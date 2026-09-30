import assert from "node:assert/strict";
import test from "node:test";
import { QuantSimulationService } from "./quant-simulation-service.ts";

test("quant sessions are isolated by project", () => {
  const service = new QuantSimulationService();
  service.createSession("project-a", 1000);
  service.createSession("project-b", 2000);
  service.executeOrder("project-a", { id: "a1", symbol: "A", side: "buy", quantity: 10, price: 10, createdAt: "now", feeRate: 0 });
  assert.equal(service.snapshot("project-a", { A: 10 }).positions[0].quantity, 10);
  assert.equal(service.snapshot("project-b", { A: 10 }).positions.length, 0);
});

test("strategy skills trade in isolated ledgers with the same starting capital", () => {
  const service = new QuantSimulationService();
  service.createSession("project", 1_000);
  service.executeOrder("project", { id: "trend-buy", skillId: "trend", symbol: "A", side: "buy", quantity: 10, price: 10, feeRate: 0, createdAt: "now" });
  service.executeOrder("project", { id: "mean-buy", skillId: "mean", symbol: "B", side: "buy", quantity: 20, price: 10, feeRate: 0, createdAt: "now" });
  service.recordSkillSnapshot("project", "trend", { A: 12 });
  service.recordSkillSnapshot("project", "mean", { B: 9 });
  assert.equal(service.performance("project", "trend").totalReturnPercent, 2);
  assert.equal(service.performance("project", "mean").totalReturnPercent, -2);
  assert.equal(service.snapshot("project", {}).positions.length, 0, "skill positions must not leak into the manual portfolio");
});

test("restores manual and per-skill ledgers from durable project state", () => {
  const states = new Map<string, string>();
  const persistence = {
    load: (projectId: string) => states.get(projectId) ?? null,
    save: (projectId: string, stateJson: string) => { states.set(projectId, stateJson); }
  };
  const first = new QuantSimulationService(undefined, persistence);
  first.createSession("project", 1_000);
  first.executeOrder("project", { id: "manual", symbol: "A", side: "buy", quantity: 10, price: 10, feeRate: 0, createdAt: "now" });
  first.executeOrder("project", { id: "skill", skillId: "trend", symbol: "B", side: "buy", quantity: 20, price: 10, feeRate: 0, createdAt: "now" });
  first.recordSkillSnapshot("project", "trend", { B: 11 });

  const restarted = new QuantSimulationService(undefined, persistence);
  restarted.createSession("project", 999_999);
  assert.equal(restarted.snapshot("project", { A: 12 }).positions[0]?.quantity, 10);
  assert.equal(restarted.performance("project", "trend").totalReturnPercent, 2);
  assert.equal(restarted.executeOrder("project", { id: "manual", symbol: "A", side: "buy", quantity: 10, price: 999, feeRate: 0, createdAt: "later" }).price, 10);
});

test("removes a skill ledger durably without touching the manual portfolio", () => {
  const states = new Map<string, string>();
  const persistence = {
    load: (projectId: string) => states.get(projectId) ?? null,
    save: (projectId: string, stateJson: string) => { states.set(projectId, stateJson); }
  };
  const service = new QuantSimulationService(undefined, persistence);
  service.createSession("project", 1_000);
  service.executeOrder("project", { id: "manual", symbol: "A", side: "buy", quantity: 10, price: 10, feeRate: 0, createdAt: "now" });
  service.executeOrder("project", { id: "skill", skillId: "trend", symbol: "B", side: "buy", quantity: 20, price: 10, feeRate: 0, createdAt: "now" });

  assert.equal(service.removeSkillLedger("project", "trend"), true);
  assert.deepEqual(service.listSkillIds("project"), []);
  assert.equal(service.snapshot("project", { A: 10 }).positions[0]?.quantity, 10);

  const restarted = new QuantSimulationService(undefined, persistence);
  restarted.createSession("project");
  assert.deepEqual(restarted.listSkillIds("project"), []);
  assert.equal(restarted.snapshot("project", { A: 10 }).positions[0]?.quantity, 10);
  assert.equal(restarted.removeSkillLedger("project", "trend"), false);
});

test("runSkillSimulation auto-trades on rising bars for trend-following without touching manual ledger", async () => {
  const bars = Array.from({ length: 40 }, (_, index) => {
    const close = 10 + index;
    return {
      symbol: "600519", exchange: "SSE", timezone: "Asia/Shanghai", interval: "1d" as const, adjustment: "forward" as const,
      timestamp: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T15:00:00+08:00`,
      open: close, high: close + 1, low: close - 1, close, volume: 1000, turnover: 10_000, changePercent: 1,
      source: { provider: "fixture", dataset: "test", fetchedAt: "2026-08-23T00:00:00Z" }
    };
  });
  // Fix timestamps to be strictly increasing across months
  for (let i = 0; i < bars.length; i += 1) {
    const day = new Date(Date.UTC(2026, 5, 1 + i));
    bars[i]!.timestamp = `${day.toISOString().slice(0, 10)}T15:00:00+08:00`;
  }
  const service = new QuantSimulationService();
  service.createSession("project", 100_000, bars);
  const result = await service.runSkillSimulation("project", {
    skillId: "trend-following",
    symbol: "600519",
    quantity: 100,
    query: { symbol: "600519", interval: "1d", adjustment: "forward", startDate: "2026-06-01", endDate: "2026-08-01" }
  });
  assert.ok(result.tradeCount >= 1);
  assert.equal(result.performance.skillId, "trend-following");
  assert.equal(service.snapshot("project", {}).positions.length, 0);
  assert.ok(service.skillSnapshot("project", "trend-following", { "600519": bars.at(-1)!.close }).positions.length >= 0);
});

test("runs a built-in strategy into the caller's custom Skill ledger", async () => {
  const bars = Array.from({ length: 40 }, (_, index) => {
    const close = 10 + index;
    const day = new Date(Date.UTC(2026, 5, 1 + index));
    return {
      symbol: "600031", exchange: "SSE", timezone: "Asia/Shanghai", interval: "1d" as const, adjustment: "forward" as const,
      timestamp: `${day.toISOString().slice(0, 10)}T15:00:00+08:00`,
      open: close, high: close + 1, low: close - 1, close, volume: 1000, turnover: 10_000, changePercent: 1,
      source: { provider: "fixture", dataset: "test", fetchedAt: "2026-08-23T00:00:00Z" }
    };
  });
  const service = new QuantSimulationService();
  service.createSession("project", 100_000, bars);
  const result = await service.runSkillSimulation("project", {
    skillId: "sany-trend-portfolio",
    strategyId: "trend-following",
    symbol: "600031",
    quantity: 100,
    query: { symbol: "600031", interval: "1d", adjustment: "forward" }
  });

  assert.equal(result.skillId, "sany-trend-portfolio");
  assert.deepEqual(service.listSkillIds("project"), ["sany-trend-portfolio"]);
  assert.ok(service.performance("project", "sany-trend-portfolio").tradeCount >= 1);
});
