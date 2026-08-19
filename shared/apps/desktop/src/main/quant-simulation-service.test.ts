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
