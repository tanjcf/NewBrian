import assert from "node:assert/strict";
import test from "node:test";
import { SimulationLedger } from "./simulation-ledger.ts";

test("ledger tracks cash, position and pnl", () => {
  const ledger = new SimulationLedger(10_000);
  ledger.execute({ id: "1", symbol: "600519", side: "buy", quantity: 100, price: 10, feeRate: 0, createdAt: "now" });
  assert.equal(ledger.snapshot({ "600519": 12 }).marketValue, 1200);
  const sell = ledger.execute({ id: "2", symbol: "600519", side: "sell", quantity: 100, price: 12, feeRate: 0, createdAt: "now" });
  assert.equal(sell.realizedPnl, 200);
  assert.equal(ledger.snapshot({}).realizedPnl, 200);
});

test("ledger rejects unsafe orders", () => {
  const ledger = new SimulationLedger(100);
  assert.throws(() => ledger.execute({ id: "1", symbol: "A", side: "buy", quantity: 20, price: 10, createdAt: "now" }), /INSUFFICIENT_CASH/);
  assert.throws(() => ledger.execute({ id: "2", symbol: "A", side: "sell", quantity: 1, price: 1, createdAt: "now" }), /INSUFFICIENT_POSITION/);
});

test("ledger makes repeated order ids idempotent", () => {
  const ledger = new SimulationLedger(1_000);
  const order = { id: "scheduled-skill-1", symbol: "A", side: "buy" as const, quantity: 10, price: 10, feeRate: 0, createdAt: "now" };
  const first = ledger.execute(order);
  const second = ledger.execute({ ...order, price: 99 });
  assert.deepEqual(second, first);
  assert.equal(ledger.snapshot({ A: 10 }).cash, 900);
  assert.equal(ledger.snapshot({ A: 10 }).positions[0]?.quantity, 10);
});
