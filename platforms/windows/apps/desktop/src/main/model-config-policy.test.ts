import assert from "node:assert/strict";
import test from "node:test";

const { normalizeModelConfig } = await import(new URL("./model-config-policy.ts", import.meta.url).href);
const fallback = {
  provider: "DeepSeek",
  baseUrl: "https://gateway.example/v1",
  apiKey: "fallback-key",
  wireApi: "responses",
  model: "model-main",
  reviewModel: "model-review",
  reasoningEffort: "medium",
  disableResponseStorage: true,
  systemPrompt: "system"
};

test("trims supplied model configuration and preserves explicit booleans", () => {
  const result = normalizeModelConfig({
    provider: " OpenAI ",
    baseUrl: " https://api.example/v1 ",
    apiKey: " secret ",
    wireApi: "chat.completions",
    model: " gpt-main ",
    reasoningEffort: "high",
    disableResponseStorage: false
  }, fallback);
  assert.equal(result.provider, "OpenAI");
  assert.equal(result.baseUrl, "https://api.example/v1");
  assert.equal(result.apiKey, "secret");
  assert.equal(result.wireApi, "chat.completions");
  assert.equal(result.reasoningEffort, "high");
  assert.equal(result.disableResponseStorage, false);
});

test("falls back for blank values and unsupported enum values", () => {
  const result = normalizeModelConfig({
    provider: " ",
    baseUrl: " ",
    model: " ",
    wireApi: "unsupported",
    reasoningEffort: "unsupported"
  }, fallback);
  assert.equal(result.provider, fallback.provider);
  assert.equal(result.baseUrl, fallback.baseUrl);
  assert.equal(result.model, fallback.model);
  assert.equal(result.wireApi, "responses");
  assert.equal(result.reasoningEffort, fallback.reasoningEffort);
});

test("allows an explicitly blank API key to clear stored credentials", () => {
  assert.equal(normalizeModelConfig({ apiKey: " " }, fallback).apiKey, "");
});

test("normalizes optimizeFor for Auto mode persistence", () => {
  assert.equal(normalizeModelConfig({ optimizeFor: "intelligence" }, fallback).optimizeFor, "intelligence");
  assert.equal(normalizeModelConfig({ optimizeFor: "nope" as never }, { ...fallback, optimizeFor: "cost" }).optimizeFor, "cost");
  assert.equal(normalizeModelConfig({}, fallback).optimizeFor, "balanced");
});

test("normalizeModelConfig preserves parent Auto display name", () => {
  const fallback = {
    provider: "DeepSeek",
    baseUrl: "http://127.0.0.1:8790/v1",
    apiKey: "",
    wireApi: "responses" as const,
    model: "auto",
    reviewModel: "auto",
    reasoningEffort: "medium" as const,
    disableResponseStorage: true,
    systemPrompt: "",
    autoParentDisplayName: "brain"
  };
  assert.equal(normalizeModelConfig({ autoParentDisplayName: "neo" }, fallback).autoParentDisplayName, "neo");
  assert.equal(normalizeModelConfig({}, fallback).autoParentDisplayName, "brain");
});
