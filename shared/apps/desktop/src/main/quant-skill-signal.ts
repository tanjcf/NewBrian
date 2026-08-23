import type { QuantBar } from "@codex-forge/protocol/quant-types";

export const BUILTIN_QUANT_SKILLS = [
  { id: "trend-following", label: "趋势跟踪", detail: "5 日均线突破 20 日均线时买入，跌破时卖出" },
  { id: "mean-reversion", label: "均值回归", detail: "价格低于 20 日均线时买入，回到均线上方时卖出" }
] as const;

export type BuiltinQuantSkillId = (typeof BUILTIN_QUANT_SKILLS)[number]["id"];

export class QuantSkillSignalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "QuantSkillSignalError";
  }
}

/** Shared Skill signal used by scheduled radar tasks and interactive Skill simulation. */
export function quantSkillSignal(skillId: string, bars: QuantBar[]): "buy" | "sell" {
  if (bars.length < 20) {
    throw new QuantSkillSignalError("QUANT_MARKET_DATA_INSUFFICIENT", "At least 20 daily bars are required");
  }
  const closes = bars.map((bar) => bar.close);
  const latest = closes.at(-1)!;
  const mean = (count: number) => closes.slice(-count).reduce((sum, value) => sum + value, 0) / count;
  if (skillId === "trend-following") return mean(5) > mean(20) ? "buy" : "sell";
  if (skillId === "mean-reversion") return latest < mean(20) ? "buy" : "sell";
  throw new QuantSkillSignalError("QUANT_SKILL_UNSUPPORTED", `Unsupported quantitative Skill: ${skillId}`);
}

export function isBuiltinQuantSkillId(skillId: string): skillId is BuiltinQuantSkillId {
  return BUILTIN_QUANT_SKILLS.some((skill) => skill.id === skillId);
}
