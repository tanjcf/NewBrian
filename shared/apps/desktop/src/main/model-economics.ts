import type { ModelRoutingProfile, ModelRoutingRole } from "@codex-forge/protocol";

export type ModelEconomicsOption = {
  id?: string;
  model: string;
  label?: string;
  provider?: string;
  capabilities?: string[];
  input_token_price_per_million?: number;
  output_token_price_per_million?: number;
  capability_intro?: string;
  best_for?: string;
  strengths?: string;
  routing?: ModelRoutingProfile;
};

export type EconomicsTaskClass = "chat" | "code" | "gov_write" | "research" | "general";
export type EconomicsOptimizeFor = "balanced" | "cost" | "intelligence";

/** Quality gap below which cost becomes the tie-breaker (effectiveness-first). */
export const QUALITY_COST_TIE_MARGIN = 8;

const LIGHT_MODEL_RE = /flash|lite|mini|small|haiku|seed|turbo|fast/i;
const HEAVY_MODEL_RE = /(?:^|[^a-z0-9])(?:pro|max|opus|ultra|reasoner|\br1\b|sonnet|o3|o4-mini)(?:[^a-z0-9]|$)/i;

function isLightNamed(option: Pick<ModelEconomicsOption, "model" | "label">): boolean {
  return LIGHT_MODEL_RE.test(option.model) || LIGHT_MODEL_RE.test(option.label || "");
}

function isHeavyNamed(option: Pick<ModelEconomicsOption, "model" | "label">): boolean {
  return HEAVY_MODEL_RE.test(option.model) || HEAVY_MODEL_RE.test(option.label || "");
}

export function unitTokenPricePerMillion(option: Pick<ModelEconomicsOption, "input_token_price_per_million" | "output_token_price_per_million" | "routing">): number {
  const input = Number(option.input_token_price_per_million);
  const output = Number(option.output_token_price_per_million);
  if (Number.isFinite(input) || Number.isFinite(output)) {
    return Math.max(0, Number.isFinite(input) ? input : 0) + Math.max(0, Number.isFinite(output) ? output : 0);
  }
  const weight = Number(option.routing?.cost_weight);
  return Number.isFinite(weight) ? Math.max(0, weight) : 50;
}

export function taskQualityScore(
  option: ModelEconomicsOption,
  taskClass: EconomicsTaskClass
): number {
  const profile = option.routing;
  let quality = profile?.quality_by_task?.[taskClass] ?? profile?.quality_weight ?? 50;
  if (isLightNamed(option)) {
    if (taskClass === "chat") quality += 8;
    if (taskClass === "code" || taskClass === "research" || taskClass === "gov_write") quality -= 10;
  }
  if (isHeavyNamed(option)) {
    if (taskClass === "code" || taskClass === "research" || taskClass === "gov_write" || taskClass === "general") {
      quality += 14;
    }
    if (taskClass === "chat") quality -= 4;
  }
  return quality;
}

/**
 * Effectiveness-first ranking:
 * - balanced / intelligence: higher task quality wins; only when close, cheaper wins
 * - cost: cheaper wins; only when close, higher quality wins
 */
export function compareModelsByEffectivenessThenCost(input: {
  left: ModelEconomicsOption;
  right: ModelEconomicsOption;
  taskClass: EconomicsTaskClass;
  optimizeFor: EconomicsOptimizeFor;
}): number {
  const leftQuality = taskQualityScore(input.left, input.taskClass);
  const rightQuality = taskQualityScore(input.right, input.taskClass);
  const leftCost = unitTokenPricePerMillion(input.left);
  const rightCost = unitTokenPricePerMillion(input.right);
  const qualityDelta = rightQuality - leftQuality;
  const costDelta = leftCost - rightCost;

  if (input.optimizeFor === "cost") {
    if (Math.abs(costDelta) >= 0.01) return costDelta > 0 ? 1 : -1;
    if (Math.abs(qualityDelta) >= 1) return qualityDelta > 0 ? 1 : -1;
    return 0;
  }

  if (Math.abs(qualityDelta) >= QUALITY_COST_TIE_MARGIN) {
    return qualityDelta > 0 ? 1 : -1;
  }
  if (Math.abs(costDelta) >= 0.01) return costDelta > 0 ? 1 : -1;
  if (Math.abs(qualityDelta) >= 1) return qualityDelta > 0 ? 1 : -1;
  return 0;
}

function inferRoles(option: ModelEconomicsOption): ModelRoutingRole[] {
  const tags = new Set((option.capabilities ?? []).map((tag) => tag.toLowerCase()));
  const name = `${option.model} ${option.label || ""}`.toLowerCase();
  const roles = new Set<ModelRoutingRole>(["chat"]);
  if (tags.has("code") || /code|coder|sonnet|qwen-coder/.test(name)) roles.add("code");
  if (tags.has("vision") || tags.has("multimodal") || /vision|vl|kimi-k2/.test(name)) roles.add("vision");
  if (/gov|research|long|pro|reason/.test(name)) {
    roles.add("gov");
    roles.add("research");
  }
  if (isHeavyNamed(option)) roles.add("review");
  return [...roles];
}

function inferTier(option: ModelEconomicsOption): 1 | 2 | 3 {
  if (isHeavyNamed(option)) return 3;
  if (isLightNamed(option)) return 1;
  return 2;
}

function inferQualityByTask(option: ModelEconomicsOption): NonNullable<ModelRoutingProfile["quality_by_task"]> {
  const base = isHeavyNamed(option) ? 78 : isLightNamed(option) ? 58 : 68;
  return {
    chat: isLightNamed(option) ? base + 8 : base - 4,
    code: isHeavyNamed(option) ? base + 12 : base - 8,
    gov_write: isHeavyNamed(option) ? base + 10 : base - 6,
    research: isHeavyNamed(option) ? base + 10 : base - 6,
    general: base
  };
}

/** Build an active routing profile when the gateway only sent prices / capabilities. */
export function synthesizeRoutingProfile(option: ModelEconomicsOption): ModelRoutingProfile {
  const unit = unitTokenPricePerMillion(option);
  const costWeight = Math.min(95, Math.max(5, Math.log10(unit + 1) * 40));
  const qualityByTask = inferQualityByTask(option);
  const qualityWeight = qualityByTask.general ?? 65;
  return {
    schema_version: 1,
    status: "active",
    tier: inferTier(option),
    cost_weight: Number(costWeight.toFixed(2)),
    quality_weight: qualityWeight,
    quality_by_task: qualityByTask,
    roles: inferRoles(option),
    capabilities: [...new Set((option.capabilities ?? []).map((tag) => tag.toLowerCase()))]
  };
}

export function ensureRoutingProfile<T extends ModelEconomicsOption>(option: T): T {
  // Only synthesize when the gateway omitted a profile. Keep probing/failed/disabled intact
  // so Auto can still degrade instead of pretending incomplete probes are active.
  if (option.routing?.schema_version === 1) {
    return option;
  }
  return {
    ...option,
    routing: synthesizeRoutingProfile(option)
  };
}

/** Compact catalog the main agent can use when choosing models / workers. */
export function buildModelEconomicsBrief(
  models: ModelEconomicsOption[],
  limit = 12
): string {
  const usable = models
    .filter((item) => String(item.model || "").trim())
    .slice(0, limit);
  if (!usable.length) return "";
  const lines = usable.map((item) => {
    const input = Number(item.input_token_price_per_million);
    const output = Number(item.output_token_price_per_million);
    const price = Number.isFinite(input) || Number.isFinite(output)
      ? `输入 ${Number.isFinite(input) ? input.toFixed(4) : "?"} /M · 输出 ${Number.isFinite(output) ? output.toFixed(4) : "?"} /M`
      : `成本权重 ${item.routing?.cost_weight ?? "未知"}`;
    const quality = item.routing?.quality_by_task;
    const perf = quality
      ? `效果 chat=${quality.chat ?? "-"} code=${quality.code ?? "-"} write=${quality.gov_write ?? "-"} research=${quality.research ?? "-"}`
      : `综合质量 ${item.routing?.quality_weight ?? "未知"}`;
    const tier = item.routing?.tier
      ? `档位 T${item.routing.tier}`
      : isHeavyNamed(item)
        ? "档位 heavy"
        : isLightNamed(item)
          ? "档位 light"
          : "档位 general";
    const caps = (item.capabilities ?? []).slice(0, 4).join(",") || "general";
    const intro = String(item.capability_intro || "").trim();
    const bestFor = String(item.best_for || "").trim();
    const strengths = String(item.strengths || "").trim();
    const detailParts = [
      price,
      perf,
      tier,
      `能力=${caps}`,
      intro ? `介绍=${intro}` : "",
      bestFor ? `适合=${bestFor}` : "",
      strengths ? `优势=${strengths}` : ""
    ].filter(Boolean);
    return `- ${item.model}（${item.provider || "unknown"}）：${detailParts.join("；")}`;
  });
  return [
    "可用模型价格、性能与能力介绍（主 Agent 选型依据）：",
    "规则：先按任务效果选择最合适的模型；仅当效果接近时，再优先更低成本。不要为了省钱牺牲关键交付质量。",
    "轻量闲聊/确认可用 flash/lite；代码、长文写作、研究、复杂多步优先 pro/max/reasoner 等更强模型。识图优先视觉/多模态模型。",
    ...lines
  ].join("\n");
}
