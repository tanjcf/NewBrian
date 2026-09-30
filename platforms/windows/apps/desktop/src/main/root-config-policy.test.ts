import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./root-config-policy.ts", import.meta.url).href);
const modelDefaults = {
  provider: "Default",
  baseUrl: "https://default.example/v1",
  apiKey: "",
  wireApi: "responses",
  model: "main",
  reviewModel: "review",
  reasoningEffort: "medium",
  disableResponseStorage: true,
  systemPrompt: "system"
};
const context = {
  defaultGatewayBaseUrl: modelDefaults.baseUrl,
  defaultModelConfig: modelDefaults,
  migrateLegacyGatewayBaseUrl: (value: string | undefined, fallback: string) => value === "https://legacy.example" ? fallback : value || fallback,
  normalizeModelConfig: (input: Record<string, unknown>, fallback = modelDefaults) => ({ ...fallback, ...input }),
  normalizeDesktopPreferences: (input: Record<string, unknown> | undefined) => ({ normalized: true, ...input }),
  normalizeMcpServers: (input: unknown[] | undefined) => input ?? []
};

test("migrates legacy gateway URLs and normalizes every root section", () => {
  const result = policy.normalizeRootConfig({
    llm: { baseUrl: "https://legacy.example", model: "custom" },
    preferences: { theme: "dark" },
    mcpServers: [{ id: "server-1" }],
    mcpDiscoveredTools: [{ id: "tool-1" }]
  }, null, context);
  assert.equal(result.llm.baseUrl, modelDefaults.baseUrl);
  assert.equal(result.llm.model, "custom");
  assert.equal(result.preferences.normalized, true);
  assert.equal(result.mcpServers.length, 1);
  assert.equal(result.mcpDiscoveredTools.length, 1);
});

test("uses the bundled gateway as the migration target", () => {
  const bundled = { llm: { ...modelDefaults, baseUrl: "https://bundled.example/v1" } };
  const result = policy.normalizeRootConfig({ llm: { baseUrl: "https://legacy.example" } }, bundled, context);
  assert.equal(result.llm.baseUrl, "https://bundled.example/v1");
});

test("requests repair only when persisted and normalized gateway URLs differ", () => {
  const normalized = { llm: { ...modelDefaults, baseUrl: "https://new.example/v1" } };
  assert.equal(policy.shouldRepairRootConfig({ llm: { baseUrl: " https://new.example/v1 " } }, normalized), false);
  assert.equal(policy.shouldRepairRootConfig({ llm: { baseUrl: "https://legacy.example" } }, normalized), true);
});
