import assert from "node:assert/strict";
import test from "node:test";
import type { ModelConfig } from "@codex-forge/protocol";
const { mergeRefreshedModelConfig } = await import(new URL("./model-config-refresh.ts", import.meta.url).href);

const availableModels = [
  { id: "1", model: "deepseek-v4-flash", label: "deepseek-v4-flash", provider: "DeepSeek" },
  { id: "2", model: "deepseek-v4-pro-BD", label: "deepseek-v4-pro-BD", provider: "DeepSeek" }
];

function config(model: string): ModelConfig {
  return {
    provider: "DeepSeek",
    baseUrl: "https://gateway.example/v1",
    apiKey: "",
    wireApi: "responses",
    model,
    reviewModel: model,
    reasoningEffort: "medium",
    disableResponseStorage: true,
    systemPrompt: "",
    availableModels
  };
}

test("keeps a current authorized selection when a model-list refresh returns another default", () => {
  const merged = mergeRefreshedModelConfig(config("deepseek-v4-pro-BD"), config("deepseek-v4-flash"));

  assert.equal(merged.model, "deepseek-v4-pro-BD");
  assert.equal(merged.availableModels, availableModels);
});

test("keeps Auto selection across model-list refresh", () => {
  const merged = mergeRefreshedModelConfig(config("auto"), config("deepseek-v4-flash"));
  assert.equal(merged.model, "auto");
  assert.equal(merged.availableModels, availableModels);
});
