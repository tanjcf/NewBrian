import type { MarketDataQuery, PortfolioActivity, PortfolioSnapshot, QuantBar, SimulatedFill, SimulatedOrder, SkillPerformance } from "@codex-forge/protocol/quant-types";
import { QuantSkillSignalError, quantSkillSignal } from "./quant-skill-signal.ts";
import { MarketDataService, type MarketBarsRemoteQuery } from "./market-data-service.ts";
import { SimulationLedger, type SimulationLedgerState } from "./simulation-ledger.ts";

type QuantSession = { ledger: SimulationLedger; skillLedgers: Map<string, SimulationLedger>; market: MarketDataService; initialCash: number };
interface QuantSessionState { version: 1; initialCash: number; ledger: SimulationLedgerState; skillLedgers: Array<{ skillId: string; ledger: SimulationLedgerState }> }
export interface QuantSimulationPersistence {
  load(projectId: string): string | null;
  save(projectId: string, stateJson: string): void;
}

export type QuantSimulationMarketOptions = {
  remoteUrl?: string;
  queryRemote?: MarketBarsRemoteQuery;
};

export type QuantSkillSimulationResult = {
  skillId: string;
  symbol: string;
  barCount: number;
  tradeCount: number;
  performance: SkillPerformance;
  snapshot: PortfolioSnapshot;
};

export class QuantSimulationService {
  private readonly sessions = new Map<string, QuantSession>();
  private readonly remoteUrl?: string;
  private readonly queryRemote?: MarketBarsRemoteQuery;
  private readonly persistence?: QuantSimulationPersistence;
  constructor(
    remote?: string | QuantSimulationMarketOptions,
    persistence?: QuantSimulationPersistence
  ) {
    if (typeof remote === "string") {
      this.remoteUrl = remote;
    } else if (remote) {
      this.remoteUrl = remote.remoteUrl;
      this.queryRemote = remote.queryRemote;
    }
    this.persistence = persistence;
  }

  private createMarket(fixtures: QuantBar[]): MarketDataService {
    return new MarketDataService(fixtures, {
      remoteUrl: this.remoteUrl,
      queryRemote: this.queryRemote
    });
  }

  createSession(projectId: string, initialCash = 100_000, fixtures: QuantBar[] = []): void {
    if (!projectId.trim()) throw new TypeError("projectId is required");
    if (this.sessions.has(projectId)) return;
    const stored = this.persistence?.load(projectId);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<QuantSessionState>;
      if (parsed.version !== 1 || !Number.isFinite(parsed.initialCash) || !parsed.ledger || !Array.isArray(parsed.skillLedgers)) throw new TypeError("QUANT_SESSION_STATE_INVALID");
      const skillLedgers = new Map<string, SimulationLedger>();
      for (const entry of parsed.skillLedgers) {
        if (!entry || typeof entry.skillId !== "string" || !entry.skillId.trim() || !entry.ledger) throw new TypeError("QUANT_SESSION_STATE_INVALID");
        skillLedgers.set(entry.skillId, SimulationLedger.restore(entry.ledger));
      }
      this.sessions.set(projectId, { ledger: SimulationLedger.restore(parsed.ledger), skillLedgers, market: this.createMarket(fixtures), initialCash: Number(parsed.initialCash) });
      return;
    }
    this.sessions.set(projectId, { ledger: new SimulationLedger(initialCash), skillLedgers: new Map(), market: this.createMarket(fixtures), initialCash });
    this.persist(projectId);
  }

  private session(projectId: string): QuantSession {
    const session = this.sessions.get(projectId);
    if (!session) throw new Error("QUANT_SESSION_NOT_FOUND");
    return session;
  }

  resetSkillLedger(projectId: string, skillId: string): void {
    const session = this.session(projectId);
    const id = skillId.trim();
    if (!id) throw new TypeError("skillId is required");
    session.skillLedgers.set(id, new SimulationLedger(session.initialCash));
    this.persist(projectId);
  }

  removeSkillLedger(projectId: string, skillId: string): boolean {
    const session = this.session(projectId);
    const id = skillId.trim();
    if (!id) throw new TypeError("skillId is required");
    const removed = session.skillLedgers.delete(id);
    if (removed) this.persist(projectId);
    return removed;
  }

  queryBars(projectId: string, query: MarketDataQuery): QuantBar[] { return this.session(projectId).market.query(query); }
  queryBarsAsync(projectId: string, query: MarketDataQuery): Promise<QuantBar[]> { return this.session(projectId).market.queryAsync(query); }
  executeOrder(projectId: string, order: SimulatedOrder): SimulatedFill {
    const session = this.session(projectId);
    if (!order.skillId) {
      const fill = session.ledger.execute(order);
      this.persist(projectId);
      return fill;
    }
    let ledger = session.skillLedgers.get(order.skillId);
    if (!ledger) {
      ledger = new SimulationLedger(session.initialCash);
      session.skillLedgers.set(order.skillId, ledger);
    }
    const fill = ledger.execute(order);
    this.persist(projectId);
    return fill;
  }
  snapshot(projectId: string, prices: Record<string, number>): PortfolioSnapshot { return this.session(projectId).ledger.snapshot(prices); }
  activity(projectId: string, prices: Record<string, number>): PortfolioActivity { return this.session(projectId).ledger.activity(prices); }
  skillSnapshot(projectId: string, skillId: string, prices: Record<string, number>): PortfolioSnapshot {
    const ledger = this.session(projectId).skillLedgers.get(skillId);
    return ledger ? ledger.snapshot(prices) : new SimulationLedger(this.session(projectId).initialCash).snapshot(prices);
  }
  recordSkillSnapshot(projectId: string, skillId: string, prices: Record<string, number>): void {
    const session = this.session(projectId);
    let ledger = session.skillLedgers.get(skillId);
    if (!ledger) {
      ledger = new SimulationLedger(session.initialCash);
      session.skillLedgers.set(skillId, ledger);
    }
    ledger.recordSkillSnapshot(skillId, prices);
    this.persist(projectId);
  }
  performance(projectId: string, skillId: string): SkillPerformance {
    const ledger = this.session(projectId).skillLedgers.get(skillId);
    if (!ledger) {
      return { skillId, totalReturnPercent: 0, maxDrawdownPercent: 0, volatilityPercent: 0, riskAdjustedReturn: 0, tradeCount: 0, winRatePercent: 0 };
    }
    return ledger.performance(skillId);
  }

  listSkillIds(projectId: string): string[] {
    return [...this.session(projectId).skillLedgers.keys()];
  }

  skillActivity(projectId: string, skillId: string, prices: Record<string, number>): PortfolioActivity {
    const ledger = this.session(projectId).skillLedgers.get(skillId);
    if (!ledger) return new SimulationLedger(this.session(projectId).initialCash).activity(prices);
    return ledger.activity(prices);
  }

  /** Walk real bars; Skill auto-trades into its isolated ledger. Manual portfolio is untouched. */
  async runSkillSimulation(projectId: string, input: {
    skillId: string;
    strategyId?: string;
    symbol: string;
    quantity: number;
    query: MarketDataQuery;
    reset?: boolean;
  }): Promise<QuantSkillSimulationResult> {
    const skillId = input.skillId.trim();
    const symbol = input.symbol.trim();
    if (!skillId) throw new TypeError("skillId is required");
    if (!symbol) throw new TypeError("symbol is required");
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new TypeError("quantity must be a positive integer");
    this.createSession(projectId);
    if (input.reset !== false) this.resetSkillLedger(projectId, skillId);
    const bars = (await this.queryBarsAsync(projectId, { ...input.query, symbol }))
      .filter((bar) => bar.symbol === symbol)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    if (bars.length < 20) {
      throw new QuantSkillSignalError("QUANT_MARKET_DATA_INSUFFICIENT", "At least 20 daily bars are required for Skill simulation");
    }
    let tradeCount = 0;
    for (let index = 19; index < bars.length; index += 1) {
      const window = bars.slice(0, index + 1);
      const bar = bars[index]!;
      const signal = quantSkillSignal(input.strategyId?.trim() || skillId, window);
      const prices = { [symbol]: bar.close };
      const before = this.skillSnapshot(projectId, skillId, prices);
      const position = before.positions.find((item) => item.symbol === symbol);
      const stamp = String(bar.timestamp);
      if (signal === "buy" && !position?.quantity) {
        this.executeOrder(projectId, {
          id: `skill-sim:${skillId}:${symbol}:buy:${stamp}`,
          symbol,
          side: "buy",
          quantity: input.quantity,
          price: bar.close,
          feeRate: 0.0003,
          skillId,
          createdAt: stamp
        });
        tradeCount += 1;
      } else if (signal === "sell" && position?.quantity) {
        this.executeOrder(projectId, {
          id: `skill-sim:${skillId}:${symbol}:sell:${stamp}`,
          symbol,
          side: "sell",
          quantity: position.quantity,
          price: bar.close,
          feeRate: 0.0003,
          skillId,
          createdAt: stamp
        });
        tradeCount += 1;
      }
      this.recordSkillSnapshot(projectId, skillId, prices);
    }
    const latest = bars.at(-1)!;
    const prices = { [symbol]: latest.close };
    return {
      skillId,
      symbol,
      barCount: bars.length,
      tradeCount,
      performance: this.performance(projectId, skillId),
      snapshot: this.skillSnapshot(projectId, skillId, prices)
    };
  }

  private persist(projectId: string): void {
    if (!this.persistence) return;
    const session = this.session(projectId);
    const state: QuantSessionState = {
      version: 1,
      initialCash: session.initialCash,
      ledger: session.ledger.exportState(),
      skillLedgers: [...session.skillLedgers].map(([skillId, ledger]) => ({ skillId, ledger: ledger.exportState() }))
    };
    this.persistence.save(projectId, JSON.stringify(state));
  }
}
