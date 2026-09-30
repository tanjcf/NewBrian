import type { PortfolioActivity, PortfolioEquityPoint, PortfolioSnapshot, PositionSnapshot, SimulatedFill, SimulatedOrder, SkillPerformance } from "@codex-forge/protocol/quant-types";

export interface SimulationLedgerState {
  version: 1;
  initialCash: number;
  fills: SimulatedFill[];
  skillValues: Array<{ skillId: string; values: number[] }>;
}

export type SimulationAccount = "cash" | "position_cost" | "fees" | "trade_proceeds" | "cost_of_sales";
export interface SimulationJournalEntry {
  orderId: string;
  account: SimulationAccount;
  debit: number;
  credit: number;
  createdAt: string;
}

export class SimulationLedger {
  private cash: number;
  private readonly initialCash: number;
  private realizedPnl = 0;
  private readonly positions = new Map<string, { quantity: number; averageCost: number }>();
  private readonly fills: SimulatedFill[] = [];
  private readonly fillsByOrderId = new Map<string, SimulatedFill>();
  private readonly skillValues = new Map<string, number[]>();
  private readonly journal: SimulationJournalEntry[] = [];

  constructor(initialCash: number) {
    if (!Number.isFinite(initialCash) || initialCash <= 0) throw new RangeError("initialCash must be positive");
    this.cash = this.initialCash = initialCash;
  }

  static restore(value: unknown): SimulationLedger {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("QUANT_LEDGER_STATE_INVALID");
    const state = value as Partial<SimulationLedgerState>;
    if (state.version !== 1 || !Number.isFinite(state.initialCash) || Number(state.initialCash) <= 0 || !Array.isArray(state.fills) || !Array.isArray(state.skillValues)) {
      throw new TypeError("QUANT_LEDGER_STATE_INVALID");
    }
    const ledger = new SimulationLedger(Number(state.initialCash));
    for (const fill of state.fills) ledger.execute(fill);
    for (const entry of state.skillValues) {
      if (!entry || typeof entry.skillId !== "string" || !entry.skillId.trim() || !Array.isArray(entry.values)
        || entry.values.some((item) => !Number.isFinite(item) || item <= 0)) throw new TypeError("QUANT_LEDGER_STATE_INVALID");
      ledger.skillValues.set(entry.skillId, [...entry.values]);
    }
    return ledger;
  }

  exportState(): SimulationLedgerState {
    return {
      version: 1,
      initialCash: this.initialCash,
      fills: this.fills.map((fill) => ({ ...fill })),
      skillValues: [...this.skillValues].map(([skillId, values]) => ({ skillId, values: [...values] }))
    };
  }

  execute(order: SimulatedOrder): SimulatedFill {
    const orderId = order.id.trim();
    if (!orderId) throw new TypeError("order id is required");
    const previous = this.fillsByOrderId.get(orderId);
    if (previous) return { ...previous };
    if (!Number.isInteger(order.quantity) || order.quantity <= 0) throw new RangeError("quantity must be a positive integer");
    if (!Number.isFinite(order.price) || order.price <= 0) throw new RangeError("price must be positive");
    const feeRate = order.feeRate ?? 0.0003;
    const grossAmount = order.quantity * order.price;
    const fee = grossAmount * feeRate;
    const current = this.positions.get(order.symbol) ?? { quantity: 0, averageCost: 0 };
    const costBasis = current.averageCost * order.quantity;
    let fillRealizedPnl = 0;
    if (order.side === "buy") {
      if (this.cash < grossAmount + fee) throw new Error("INSUFFICIENT_CASH");
      current.averageCost = (current.quantity * current.averageCost + grossAmount) / (current.quantity + order.quantity);
      current.quantity += order.quantity;
      this.cash -= grossAmount + fee;
    } else {
      if (current.quantity < order.quantity) throw new Error("INSUFFICIENT_POSITION");
      this.cash += grossAmount - fee;
      fillRealizedPnl = (order.price - current.averageCost) * order.quantity - fee;
      this.realizedPnl += fillRealizedPnl;
      current.quantity -= order.quantity;
      if (current.quantity === 0) current.averageCost = 0;
    }
    this.positions.set(order.symbol, current);
    const fill: SimulatedFill = { ...order, fee, grossAmount, netCashChange: order.side === "buy" ? -(grossAmount + fee) : grossAmount - fee, realizedPnl: fillRealizedPnl };
    this.fills.push(fill);
    this.fillsByOrderId.set(orderId, fill);
    this.recordJournal(fill, costBasis);
    return fill;
  }

  journalEntries(): SimulationJournalEntry[] { return this.journal.map((entry) => ({ ...entry })); }

  private recordJournal(fill: SimulatedFill, costBasis: number): void {
    const entries: SimulationJournalEntry[] = fill.side === "buy"
      ? [
          { orderId: fill.id, account: "position_cost", debit: fill.grossAmount, credit: 0, createdAt: fill.createdAt },
          { orderId: fill.id, account: "fees", debit: fill.fee, credit: 0, createdAt: fill.createdAt },
          { orderId: fill.id, account: "cash", debit: 0, credit: fill.grossAmount + fill.fee, createdAt: fill.createdAt }
        ]
      : [
          { orderId: fill.id, account: "cash", debit: fill.grossAmount - fill.fee, credit: 0, createdAt: fill.createdAt },
          { orderId: fill.id, account: "fees", debit: fill.fee, credit: 0, createdAt: fill.createdAt },
          { orderId: fill.id, account: "cost_of_sales", debit: costBasis, credit: 0, createdAt: fill.createdAt },
          { orderId: fill.id, account: "position_cost", debit: 0, credit: costBasis, createdAt: fill.createdAt },
          { orderId: fill.id, account: "trade_proceeds", debit: 0, credit: fill.grossAmount, createdAt: fill.createdAt }
        ];
    const debit = entries.reduce((sum, entry) => sum + entry.debit, 0);
    const credit = entries.reduce((sum, entry) => sum + entry.credit, 0);
    if (Math.abs(debit - credit) > 1e-7) throw new Error("QUANT_JOURNAL_UNBALANCED");
    this.journal.push(...entries);
  }

  snapshot(prices: Record<string, number>): PortfolioSnapshot {
    const positions: PositionSnapshot[] = [];
    for (const [symbol, position] of this.positions) {
      const marketPrice = prices[symbol] ?? position.averageCost;
      positions.push({ symbol, quantity: position.quantity, averageCost: position.averageCost, marketPrice, marketValue: position.quantity * marketPrice, unrealizedPnl: (marketPrice - position.averageCost) * position.quantity });
    }
    const marketValue = positions.reduce((sum, item) => sum + item.marketValue, 0);
    const unrealizedPnl = positions.reduce((sum, item) => sum + item.unrealizedPnl, 0);
    return { cash: this.cash, initialCash: this.initialCash, marketValue, totalValue: this.cash + marketValue, realizedPnl: this.realizedPnl, unrealizedPnl, totalReturnPercent: ((this.cash + marketValue - this.initialCash) / this.initialCash) * 100, positions };
  }

  activity(prices: Record<string, number>): PortfolioActivity {
    const replay = new SimulationLedger(this.initialCash);
    const observedPrices: Record<string, number> = {};
    const equityCurve: PortfolioEquityPoint[] = [{ timestamp: "", totalValue: this.initialCash, cash: this.initialCash, marketValue: 0 }];
    for (const fill of this.fills) {
      observedPrices[fill.symbol] = fill.price;
      replay.execute(fill);
      const point = replay.snapshot(observedPrices);
      equityCurve.push({ timestamp: fill.createdAt, totalValue: point.totalValue, cash: point.cash, marketValue: point.marketValue });
    }
    return { snapshot: this.snapshot(prices), fills: this.fills.map((fill) => ({ ...fill })), equityCurve };
  }

  recordSkillSnapshot(skillId: string, prices: Record<string, number>): void {
    const value = this.snapshot(prices).totalValue;
    this.skillValues.set(skillId, [...(this.skillValues.get(skillId) ?? [this.initialCash]), value]);
  }
  performance(skillId: string): SkillPerformance {
    const values = this.skillValues.get(skillId) ?? [this.initialCash];
    let peak = values[0]; let maxDrawdown = 0;
    for (const value of values) { peak = Math.max(peak, value); maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak * 100); }
    const trades = this.fills.filter((fill) => fill.skillId === skillId);
    const sells = trades.filter((fill) => fill.side === "sell");
    const wins = sells.filter((fill) => fill.realizedPnl > 0).length;
    const returns = values.slice(1).map((value, index) => values[index] > 0 ? value / values[index] - 1 : 0);
    const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
    const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : 0;
    const volatilityPercent = Math.sqrt(variance) * 100;
    return {
      skillId,
      totalReturnPercent: ((values.at(-1)! - this.initialCash) / this.initialCash) * 100,
      maxDrawdownPercent: maxDrawdown,
      volatilityPercent,
      riskAdjustedReturn: volatilityPercent > 0 ? (mean * 100) / volatilityPercent : 0,
      tradeCount: trades.length,
      winRatePercent: sells.length ? wins / sells.length * 100 : 0
    };
  }
}
