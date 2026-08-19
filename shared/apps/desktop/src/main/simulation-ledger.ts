import type { PortfolioSnapshot, PositionSnapshot, SimulatedFill, SimulatedOrder, SkillPerformance } from "@codex-forge/protocol/quant-types";

export class SimulationLedger {
  private cash: number;
  private readonly initialCash: number;
  private realizedPnl = 0;
  private readonly positions = new Map<string, { quantity: number; averageCost: number }>();
  private readonly fills: SimulatedFill[] = [];
  private readonly fillsByOrderId = new Map<string, SimulatedFill>();
  private readonly skillValues = new Map<string, number[]>();

  constructor(initialCash: number) {
    if (!Number.isFinite(initialCash) || initialCash <= 0) throw new RangeError("initialCash must be positive");
    this.cash = this.initialCash = initialCash;
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
    if (order.side === "buy") {
      if (this.cash < grossAmount + fee) throw new Error("INSUFFICIENT_CASH");
      current.averageCost = (current.quantity * current.averageCost + grossAmount + fee) / (current.quantity + order.quantity);
      current.quantity += order.quantity;
      this.cash -= grossAmount + fee;
    } else {
      if (current.quantity < order.quantity) throw new Error("INSUFFICIENT_POSITION");
      this.cash += grossAmount - fee;
      this.realizedPnl += (order.price - current.averageCost) * order.quantity - fee;
      current.quantity -= order.quantity;
      if (current.quantity === 0) current.averageCost = 0;
    }
    this.positions.set(order.symbol, current);
    const fill: SimulatedFill = { ...order, fee, grossAmount, netCashChange: order.side === "buy" ? -(grossAmount + fee) : grossAmount - fee };
    this.fills.push(fill);
    this.fillsByOrderId.set(orderId, fill);
    return fill;
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

  recordSkillSnapshot(skillId: string, prices: Record<string, number>): void { const value = this.snapshot(prices).totalValue; this.skillValues.set(skillId, [...(this.skillValues.get(skillId) ?? []), value]); }
  performance(skillId: string): SkillPerformance {
    const values = this.skillValues.get(skillId) ?? [this.initialCash];
    let peak = values[0]; let maxDrawdown = 0;
    for (const value of values) { peak = Math.max(peak, value); maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak * 100); }
    const trades = this.fills.filter((fill) => fill.skillId === skillId);
    const wins = trades.filter((fill) => fill.side === "sell" && fill.netCashChange > 0).length;
    return { skillId, totalReturnPercent: ((values.at(-1)! - this.initialCash) / this.initialCash) * 100, maxDrawdownPercent: maxDrawdown, tradeCount: trades.length, winRatePercent: trades.length ? wins / trades.length * 100 : 0 };
  }
}
