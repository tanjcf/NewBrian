import type { MarketDataQuery, PortfolioSnapshot, QuantBar, SimulatedFill, SimulatedOrder, SkillPerformance } from "@codex-forge/protocol/quant-types";
import { MarketDataService } from "./market-data-service.ts";
import { SimulationLedger, type SimulationLedgerState } from "./simulation-ledger.ts";

type QuantSession = { ledger: SimulationLedger; skillLedgers: Map<string, SimulationLedger>; market: MarketDataService; initialCash: number };
interface QuantSessionState { version: 1; initialCash: number; ledger: SimulationLedgerState; skillLedgers: Array<{ skillId: string; ledger: SimulationLedgerState }> }
export interface QuantSimulationPersistence {
  load(projectId: string): string | null;
  save(projectId: string, stateJson: string): void;
}

export class QuantSimulationService {
  private readonly sessions = new Map<string, QuantSession>();
  private readonly remoteUrl?: string;
  private readonly persistence?: QuantSimulationPersistence;
  constructor(remoteUrl?: string, persistence?: QuantSimulationPersistence) { this.remoteUrl = remoteUrl; this.persistence = persistence; }

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
      this.sessions.set(projectId, { ledger: SimulationLedger.restore(parsed.ledger), skillLedgers, market: new MarketDataService(fixtures, this.remoteUrl), initialCash: Number(parsed.initialCash) });
      return;
    }
    this.sessions.set(projectId, { ledger: new SimulationLedger(initialCash), skillLedgers: new Map(), market: new MarketDataService(fixtures, this.remoteUrl), initialCash });
    this.persist(projectId);
  }

  private session(projectId: string): QuantSession {
    const session = this.sessions.get(projectId);
    if (!session) throw new Error("QUANT_SESSION_NOT_FOUND");
    return session;
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
  recordSkillSnapshot(projectId: string, skillId: string, prices: Record<string, number>): void {
    const session = this.session(projectId);
    const ledger = session.skillLedgers.get(skillId);
    if (!ledger) throw new Error("QUANT_SKILL_SESSION_NOT_FOUND");
    ledger.recordSkillSnapshot(skillId, prices);
    this.persist(projectId);
  }
  performance(projectId: string, skillId: string): SkillPerformance {
    const ledger = this.session(projectId).skillLedgers.get(skillId);
    if (!ledger) throw new Error("QUANT_SKILL_SESSION_NOT_FOUND");
    return ledger.performance(skillId);
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
