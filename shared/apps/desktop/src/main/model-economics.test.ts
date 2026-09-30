import assert from "node:assert/strict";
import test from "node:test";
import {
  buildModelEconomicsBrief,
  compareModelsByEffectivenessThenCost,
  ensureRoutingProfile,
  unitTokenPricePerMillion
} from "./model-economics.ts";

test("unit price prefers real gateway prices over cost_weight", () => {
  assert.equal(
    unitTokenPricePerMillion({
      input_token_price_per_million: 1,
      output_token_price_per_million: 2,
      routing: {
        schema_version: 1,
        status: "active",
        tier: 1,
        cost_weight: 90,
        quality_weight: 50,
        roles: ["chat"],
        capabilities: []
      }
    }),
    3
  );
});

test("effectiveness-first ranking prefers stronger model even when pricier", () => {
  const flash = ensureRoutingProfile({
    model: "deepseek-v4-flash",
    label: "flash",
    provider: "ds",
    input_token_price_per_million: 0.5,
    output_token_price_per_million: 1
  });
  const pro = ensureRoutingProfile({
    model: "deepseek-v4-pro",
    label: "pro",
    provider: "ds",
    input_token_price_per_million: 5,
    output_token_price_per_million: 10
  });
  const order = compareModelsByEffectivenessThenCost({
    left: flash,
    right: pro,
    taskClass: "code",
    optimizeFor: "balanced"
  });
  assert.ok(order > 0, "pro should rank ahead of flash for code");
});

test("near-equal quality falls back to cheaper model", () => {
  const cheap = {
    model: "model-a",
    provider: "g",
    input_token_price_per_million: 1,
    output_token_price_per_million: 1,
    routing: {
      schema_version: 1 as const,
      status: "active" as const,
      tier: 2 as const,
      cost_weight: 10,
      quality_weight: 70,
      quality_by_task: { code: 80 },
      roles: ["code" as const],
      capabilities: []
    }
  };
  const pricey = {
    model: "model-b",
    provider: "g",
    input_token_price_per_million: 20,
    output_token_price_per_million: 20,
    routing: {
      schema_version: 1 as const,
      status: "active" as const,
      tier: 2 as const,
      cost_weight: 80,
      quality_weight: 70,
      quality_by_task: { code: 84 },
      roles: ["code" as const],
      capabilities: []
    }
  };
  const order = compareModelsByEffectivenessThenCost({
    left: cheap,
    right: pricey,
    taskClass: "code",
    optimizeFor: "balanced"
  });
  assert.ok(order < 0, "cheaper model wins when quality is within margin");
});

test("main agent brief includes price and effectiveness rule", () => {
  const brief = buildModelEconomicsBrief([
    ensureRoutingProfile({
      model: "deepseek-v4-pro",
      provider: "DeepSeek",
      input_token_price_per_million: 2,
      output_token_price_per_million: 4,
      capability_intro: "高质量长文与代码主力模型",
      best_for: "长文、代码、多步 Agent"
    })
  ]);
  assert.match(brief, /先按任务效果/);
  assert.match(brief, /deepseek-v4-pro/);
  assert.match(brief, /输入 2\.0000 \/M/);
  assert.match(brief, /输出 4\.0000 \/M/);
  assert.match(brief, /介绍=高质量长文与代码主力模型/);
  assert.match(brief, /适合=长文、代码、多步 Agent/);
});
