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
