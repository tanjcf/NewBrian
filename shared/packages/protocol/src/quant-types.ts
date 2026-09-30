export type BarInterval = "1d" | "1w" | "1mo";
export type AdjustmentMode = "forward" | "backward" | "none";
export type OrderSide = "buy" | "sell";

export interface QuantBar {
  symbol: string;
  exchange: string;
  timezone: string;
  interval: BarInterval;
  adjustment: AdjustmentMode;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  changePercent: number;
  source: {
    provider: string;
    dataset: string;
    fetchedAt: string;
  };
}

export interface MarketDataQuery {
  symbol: string;
  interval: BarInterval;
  startDate?: string;
  endDate?: string;
  adjustment: AdjustmentMode;
}

export interface SimulatedOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  feeRate?: number;
  skillId?: string;
  createdAt: string;
}

export interface SimulatedFill extends SimulatedOrder {
  fee: number;
  grossAmount: number;
  netCashChange: number;
  realizedPnl: number;
}

export interface PositionSnapshot {
  symbol: string;
  quantity: number;
  averageCost: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface PortfolioSnapshot {
  cash: number;
  initialCash: number;
  marketValue: number;
  totalValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalReturnPercent: number;
  positions: PositionSnapshot[];
}

export interface PortfolioEquityPoint {
  timestamp: string;
  totalValue: number;
  cash: number;
  marketValue: number;
}

export interface PortfolioActivity {
  snapshot: PortfolioSnapshot;
  fills: SimulatedFill[];
  equityCurve: PortfolioEquityPoint[];
}

export interface SkillPerformance {
  skillId: string;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  volatilityPercent: number;
  riskAdjustedReturn: number;
  tradeCount: number;
  winRatePercent: number;
}
