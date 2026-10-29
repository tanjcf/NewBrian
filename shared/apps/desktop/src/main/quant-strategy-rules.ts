import type { QuantBar } from "@codex-forge/protocol/quant-types";

export type QuantMetric = "close" | "volume" | "turnover" | "changePercent" | "sma";
export type QuantOperand = { metric: QuantMetric; period?: number };
export type QuantComparison = "above" | "below" | "crosses_above" | "crosses_below";
export type QuantCondition = { left: QuantOperand; comparison: QuantComparison; right: QuantOperand | { value: number } };
export type QuantRuleGroup = { all?: QuantCondition[]; any?: QuantCondition[] };
export type QuantStrategyRules = { buy: QuantRuleGroup; sell: QuantRuleGroup; tracking?: QuantRuleGroup };

const operandSchema = { oneOf: [
  {
    type: "object",
    properties: { metric: { type: "string", enum: ["close", "volume", "turnover", "changePercent"] } },
    required: ["metric"], additionalProperties: false
  },
  {
    type: "object",
    properties: { metric: { type: "string", const: "sma" }, period: { type: "integer", minimum: 2, maximum: 250 } },
    required: ["metric", "period"], additionalProperties: false
  }
] };
const conditionSchema = {
  type: "object",
  properties: {
    left: operandSchema,
    comparison: { type: "string", enum: ["above", "below", "crosses_above", "crosses_below"] },
    right: { oneOf: [operandSchema, { type: "object", properties: { value: { type: "number" } }, required: ["value"], additionalProperties: false }] }
  },
  required: ["left", "comparison", "right"], additionalProperties: false
};
const groupSchema = {
  type: "object",
  properties: {
    all: { type: "array", minItems: 1, maxItems: 12, items: conditionSchema },
    any: { type: "array", minItems: 1, maxItems: 12, items: conditionSchema }
  },
  anyOf: [{ required: ["all"] }, { required: ["any"] }], additionalProperties: false
};
export const quantStrategyRulesInputSchema = {
  type: "object",
  properties: { buy: groupSchema, sell: groupSchema, tracking: groupSchema },
  required: ["buy", "sell"], additionalProperties: false
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function validateQuantStrategyRules(value: unknown): QuantStrategyRules {
  if (!isRecord(value)) throw new TypeError("strategy rules must be an object");
  if (Object.keys(value).some((key) => key !== "buy" && key !== "sell" && key !== "tracking")) throw new TypeError("strategy rules contain unsupported fields");
  const validateGroup = (group: unknown, name: string, required: boolean): QuantRuleGroup | undefined => {
    if (group === undefined && !required) return undefined;
    if (!isRecord(group)) throw new TypeError(`${name} rules must be an object`);
    if (Object.keys(group).some((key) => key !== "all" && key !== "any")) throw new TypeError(`${name} rules contain unsupported fields`);
    const validateConditions = (conditions: unknown, key: "all" | "any") => {
      if (conditions === undefined) return undefined;
      if (!Array.isArray(conditions) || conditions.length === 0 || conditions.length > 12) throw new TypeError(`${name}.${key} must contain 1 to 12 conditions`);
      return conditions.map((raw) => {
        if (!isRecord(raw) || !isRecord(raw.left)) throw new TypeError(`${name} condition is invalid`);
        const operand = (item: unknown): item is QuantOperand => isRecord(item)
          && (item.metric === "close" || item.metric === "volume" || item.metric === "turnover" || item.metric === "changePercent" || item.metric === "sma")
          && Object.keys(item).every((key) => key === "metric" || key === "period")
          && (item.metric === "sma" ? Object.keys(item).includes("period") : item.period === undefined)
          && (item.metric !== "sma" || (Number.isInteger(item.period) && Number(item.period) >= 2 && Number(item.period) <= 250));
        const validRight = operand(raw.right) || (isRecord(raw.right) && Object.keys(raw.right).length === 1 && typeof raw.right.value === "number" && Number.isFinite(raw.right.value));
        if (Object.keys(raw).some((key) => key !== "left" && key !== "comparison" && key !== "right")) throw new TypeError(`${name} condition is invalid`);
        if (!operand(raw.left) || !validRight || !["above", "below", "crosses_above", "crosses_below"].includes(String(raw.comparison))) throw new TypeError(`${name} condition is invalid`);
        return raw as unknown as QuantCondition;
      });
    };
    const all = validateConditions(group.all, "all");
    const any = validateConditions(group.any, "any");
    if (!all && !any) throw new TypeError(`${name} must define all or any conditions`);
    return { ...(all ? { all } : {}), ...(any ? { any } : {}) };
  };
  return {
    buy: validateGroup(value.buy, "buy", true)!,
    sell: validateGroup(value.sell, "sell", true)!,
    ...(value.tracking === undefined ? {} : { tracking: validateGroup(value.tracking, "tracking", true)! })
  };
}

function metricValue(bars: QuantBar[], operand: QuantOperand, offset = 0): number | null {
  const end = bars.length - offset;
  if (end <= 0) return null;
  if (operand.metric === "sma") {
    const period = operand.period!;
    if (end < period) return null;
    return bars.slice(end - period, end).reduce((sum, bar) => sum + bar.close, 0) / period;
  }
  const bar = bars[end - 1]!;
  return bar[operand.metric];
}

function conditionMatches(bars: QuantBar[], condition: QuantCondition): boolean {
  const left = metricValue(bars, condition.left);
  const right = "value" in condition.right ? condition.right.value : metricValue(bars, condition.right);
  if (left === null || right === null) return false;
  if (condition.comparison === "above") return left > right;
  if (condition.comparison === "below") return left < right;
  const previousLeft = metricValue(bars, condition.left, 1);
  const previousRight = "value" in condition.right ? condition.right.value : metricValue(bars, condition.right, 1);
  if (previousLeft === null || previousRight === null) return false;
  return condition.comparison === "crosses_above"
    ? previousLeft <= previousRight && left > right
    : previousLeft >= previousRight && left < right;
}

export function quantRuleGroupMatches(bars: QuantBar[], group: QuantRuleGroup): boolean {
  return (!group.all || group.all.every((condition) => conditionMatches(bars, condition)))
    && (!group.any || group.any.some((condition) => conditionMatches(bars, condition)));
}

export function quantStrategySignal(rules: QuantStrategyRules, bars: QuantBar[]): "buy" | "sell" | "hold" {
  const validated = validateQuantStrategyRules(rules);
  if (quantRuleGroupMatches(bars, validated.sell)) return "sell";
  if (quantRuleGroupMatches(bars, validated.buy)) return "buy";
  return "hold";
}
