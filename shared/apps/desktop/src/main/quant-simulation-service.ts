import type { MarketDataQuery, PortfolioSnapshot, QuantBar, SimulatedFill, SimulatedOrder, SkillPerformance } from "@codex-forge/protocol/quant-types";
import { MarketDataService } from "./market-data-service.js";
import { SimulationLedger } from "./simulation-ledger.js";

type QuantSession = { ledger: SimulationLedger; market: MarketDataService };

export class QuantSimulationService {
  private readonly sessions = new Map<string, QuantSession>();

  createSession(projectId: string, initialCash = 100_000, fixtures: QuantBar[] = []): void {
    if (!projectId.trim()) throw new TypeError("projectId is required");
    if (this.sessions.has(projectId)) return;
    this.sessions.set(projectId, { ledger: new SimulationLedger(initialCash), market: new MarketDataService(fixtures) });
  }

  private session(projectId: string): QuantSession {
    const session = this.sessions.get(projectId);
    if (!session) throw new Error("QUANT_SESSION_NOT_FOUND");
    return session;
  }

  queryBars(projectId: string, query: MarketDataQuery): QuantBar[] { return this.session(projectId).market.query(query); }
  executeOrder(projectId: string, order: SimulatedOrder): SimulatedFill { return this.session(projectId).ledger.execute(order); }
  snapshot(projectId: string, prices: Record<string, number>): PortfolioSnapshot { return this.session(projectId).ledger.snapshot(prices); }
  recordSkillSnapshot(projectId: string, skillId: string, prices: Record<string, number>): void { this.session(projectId).ledger.recordSkillSnapshot(skillId, prices); }
  performance(projectId: string, skillId: string): SkillPerformance { return this.session(projectId).ledger.performance(skillId); }
}
