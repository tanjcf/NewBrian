import assert from "node:assert/strict";
import test from "node:test";
import { SimulationLedger } from "./simulation-ledger.ts";

test("buy order preserves cash plus position market value", () => {
  const ledger = new SimulationLedger(10_000);
  ledger.execute({ id: "buy-a", symbol: "600519", side: "buy", quantity: 100, price: 10, feeRate: 0, createdAt: "now" });
  const snapshot = ledger.snapshot({ "600519": 12 });
  assert.equal(snapshot.cash + snapshot.marketValue, 10_000);
  assert.equal(snapshot.totalValue, 10_200);
});

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

test("skill performance includes volatility and risk-adjusted return", () => {
  const ledger = new SimulationLedger(1_000);
  ledger.execute({ id: "skill-buy", skillId: "trend", symbol: "A", side: "buy", quantity: 10, price: 10, feeRate: 0, createdAt: "now" });
  ledger.recordSkillSnapshot("trend", { A: 11 });
  ledger.recordSkillSnapshot("trend", { A: 9 });
  const result = ledger.performance("trend");
  assert.ok(result.volatilityPercent > 0);
  assert.equal(Number.isFinite(result.riskAdjustedReturn), true);
});

test("ledger state survives restart without duplicating an idempotent order", () => {
  const original = new SimulationLedger(1_000);
  const order = { id: "restart-buy", symbol: "A", side: "buy" as const, quantity: 10, price: 10, feeRate: 0, createdAt: "2026-08-20T01:00:00.000Z" };
  original.execute(order);
  const restored = SimulationLedger.restore(original.exportState());
  assert.deepEqual(restored.execute({ ...order, price: 999 }), original.execute(order));
  assert.deepEqual(restored.snapshot({ A: 12 }), original.snapshot({ A: 12 }));
});

test("records balanced double-entry journals for buys and sells", () => {
  const ledger = new SimulationLedger(10_000);
  ledger.execute({ id: "buy-1", symbol: "A", side: "buy", quantity: 100, price: 10, feeRate: 0.001, createdAt: "2026-08-20T01:00:00Z" });
  ledger.execute({ id: "sell-1", symbol: "A", side: "sell", quantity: 40, price: 12, feeRate: 0.001, createdAt: "2026-08-21T01:00:00Z" });
  for (const orderId of ["buy-1", "sell-1"]) {
    const entries = ledger.journalEntries().filter((entry) => entry.orderId === orderId);
    assert.ok(entries.some((entry) => entry.account === "cash"));
    assert.ok(entries.some((entry) => entry.account === "position_cost"));
    assert.ok(entries.some((entry) => entry.account === "fees"));
    const debit = entries.reduce((sum, entry) => sum + entry.debit, 0);
    const credit = entries.reduce((sum, entry) => sum + entry.credit, 0);
    assert.ok(Math.abs(debit - credit) < 1e-7);
  }
});

test("rebuilds the same balanced journal after ledger restart", () => {
  const ledger = new SimulationLedger(10_000);
  ledger.execute({ id: "buy-restore", symbol: "A", side: "buy", quantity: 10, price: 10, feeRate: 0.001, createdAt: "2026-08-20T01:00:00Z" });
  const restored = SimulationLedger.restore(ledger.exportState());
  assert.deepEqual(restored.journalEntries(), ledger.journalEntries());
});

test("reports persisted fills and an accounting-derived equity curve", () => {
  const ledger = new SimulationLedger(10_000);
  ledger.execute({ id: "buy-a", symbol: "A", side: "buy", quantity: 100, price: 10, feeRate: 0, createdAt: "2026-08-20T01:00:00Z" });
  ledger.execute({ id: "buy-b", symbol: "B", side: "buy", quantity: 50, price: 20, feeRate: 0, createdAt: "2026-08-21T01:00:00Z" });
  ledger.execute({ id: "sell-a", symbol: "A", side: "sell", quantity: 40, price: 12, feeRate: 0, createdAt: "2026-08-22T01:00:00Z" });

  const activity = ledger.activity({ A: 12, B: 21 });
  assert.deepEqual(activity.fills.map((fill) => fill.id), ["buy-a", "buy-b", "sell-a"]);
  assert.equal(activity.equityCurve[0]?.totalValue, 10_000);
  assert.equal(activity.equityCurve.at(-1)?.totalValue, 10_200);
  assert.equal(activity.snapshot.totalValue, 10_250);
});
