import type { MarketDataQuery, PortfolioSnapshot, QuantBar, SimulatedFill, SimulatedOrder, SkillPerformance } from "@codex-forge/protocol/quant-types";
import type { BrainTaskRecord } from "./brain-workspace-storage.ts";
import { QuantSkillSignalError, quantSkillSignal } from "./quant-skill-signal.ts";

interface StrategyTaskConfig {
  exchange: "SSE" | "SZSE" | "BSE";
  tradingDate: string;
  symbol: string;
  quantity: number;
  strategyId: "trend-following" | "mean-reversion";
  simulationOnly: true;
}

export interface QuantStrategyTaskStore {
  listRunnableQuantStrategyTasks(ownerId: string): BrainTaskRecord[];
  claimQuantStrategyTask(ownerId: string, taskId: string): BrainTaskRecord | null;
  getTask(ownerId: string, taskId: string): BrainTaskRecord;
  updateTask(input: { ownerId: string; taskId: string; status: BrainTaskRecord["status"]; progress?: number; errorCode?: string; errorDetail?: string; resultJson?: string }): BrainTaskRecord;
}

export interface QuantStrategySimulation {
  createSession(projectId: string): void;
  queryBarsAsync(projectId: string, query: MarketDataQuery): Promise<QuantBar[]>;
  skillSnapshot(projectId: string, skillId: string, prices: Record<string, number>): PortfolioSnapshot;
  executeOrder(projectId: string, order: SimulatedOrder): SimulatedFill;
  recordSkillSnapshot(projectId: string, skillId: string, prices: Record<string, number>): void;
  performance(projectId: string, skillId: string): SkillPerformance;
}

export class QuantStrategyTaskError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "QuantStrategyTaskError"; }
}

function parseConfig(value: string): StrategyTaskConfig {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new QuantStrategyTaskError("QUANT_TASK_CONFIG_INVALID", "Strategy task configuration is not valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new QuantStrategyTaskError("QUANT_TASK_CONFIG_INVALID", "Strategy task configuration is invalid");
  const config = parsed as Record<string, unknown>;
  if (!(["SSE", "SZSE", "BSE"] as const).includes(config.exchange as StrategyTaskConfig["exchange"])
    || typeof config.tradingDate !== "string" || Number.isNaN(Date.parse(config.tradingDate))
    || typeof config.symbol !== "string" || !config.symbol.trim()
    || !Number.isInteger(config.quantity) || Number(config.quantity) <= 0
    || (config.strategyId !== "trend-following" && config.strategyId !== "mean-reversion")
    || config.simulationOnly !== true) {
    throw new QuantStrategyTaskError("QUANT_TASK_CONFIG_INVALID", "Strategy task configuration is invalid");
  }
  return { exchange: config.exchange as StrategyTaskConfig["exchange"], tradingDate: config.tradingDate, symbol: config.symbol.trim(), quantity: Number(config.quantity), strategyId: config.strategyId, simulationOnly: true };
}

function startDate(tradingDate: string): string {
  const date = new Date(`${tradingDate}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() - 90);
  return date.toISOString().slice(0, 10);
}

export class QuantStrategyTaskRunner {
  private running = false;
  private readonly options: { store: QuantStrategyTaskStore; simulation: QuantStrategySimulation; resolveOwnerId: () => Promise<string> | string };
  constructor(options: { store: QuantStrategyTaskStore; simulation: QuantStrategySimulation; resolveOwnerId: () => Promise<string> | string }) { this.options = options; }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ownerId = (await this.options.resolveOwnerId()).trim();
      if (!ownerId) return;
      for (const candidate of this.options.store.listRunnableQuantStrategyTasks(ownerId)) {
        const task = this.options.store.claimQuantStrategyTask(ownerId, candidate.id);
        if (!task) continue;
        await this.run(ownerId, task);
      }
    } finally { this.running = false; }
  }

  private async run(ownerId: string, task: BrainTaskRecord): Promise<void> {
    try {
      const config = parseConfig(task.resourceLimitsJson);
      const skillId = task.taskType.replace(/^quant\.strategy\./u, "");
      if (!skillId) throw new QuantStrategyTaskError("QUANT_SKILL_UNSUPPORTED", "Strategy task has no Skill identifier");
      this.options.simulation.createSession(task.projectId);
      const bars = (await this.options.simulation.queryBarsAsync(task.projectId, {
        symbol: config.symbol, interval: "1d", adjustment: "forward",
        startDate: startDate(config.tradingDate), endDate: config.tradingDate
      })).sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
      if (this.options.store.getTask(ownerId, task.id).status === "CANCELLED") return;
      let signal: "buy" | "sell";
      try {
        signal = quantSkillSignal(config.strategyId, bars);
      } catch (error) {
        if (error instanceof QuantSkillSignalError) throw new QuantStrategyTaskError(error.code, error.message);
        throw error;
      }
      const latest = bars.at(-1)!;
      const prices = { [config.symbol]: latest.close };
      const before = this.options.simulation.skillSnapshot(task.projectId, skillId, prices);
      const position = before.positions.find((item) => item.symbol === config.symbol);
      let fill: SimulatedFill | null = null;
      if (signal === "buy" && !position?.quantity) {
        fill = this.options.simulation.executeOrder(task.projectId, {
          id: `${task.idempotencyKey}:buy`, symbol: config.symbol, side: "buy", quantity: config.quantity,
          price: latest.close, feeRate: 0.0003, skillId, createdAt: new Date().toISOString()
        });
      } else if (signal === "sell" && position?.quantity) {
        fill = this.options.simulation.executeOrder(task.projectId, {
          id: `${task.idempotencyKey}:sell`, symbol: config.symbol, side: "sell", quantity: position.quantity,
          price: latest.close, feeRate: 0.0003, skillId, createdAt: new Date().toISOString()
        });
      }
      this.options.simulation.recordSkillSnapshot(task.projectId, skillId, prices);
      const portfolio = this.options.simulation.skillSnapshot(task.projectId, skillId, prices);
      const performance = this.options.simulation.performance(task.projectId, skillId);
      this.options.store.updateTask({
        ownerId, taskId: task.id, status: "SUCCEEDED", progress: 1,
        resultJson: JSON.stringify({ schemaVersion: 1, simulationOnly: true, skillId, signal, fill, portfolio, performance, marketData: { symbol: config.symbol, adjustment: "forward", barCount: bars.length, latestTimestamp: latest.timestamp } })
      });
    } catch (error) {
      const code = error instanceof QuantStrategyTaskError ? error.code : "QUANT_STRATEGY_TASK_FAILED";
      const detail = error instanceof Error ? error.message : String(error);
      this.options.store.updateTask({ ownerId, taskId: task.id, status: "FAILED", progress: 0, errorCode: code.slice(0, 120), errorDetail: detail.slice(0, 2_000) });
    }
  }
}
