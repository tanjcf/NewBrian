import assert from "node:assert/strict";
import test from "node:test";
import type { ModelConfig } from "@codex-forge/protocol";
const { ModelConfigService } = await import(new URL("./model-config-service.ts", import.meta.url).href);

const config = {
  provider: "gateway",
  wireApi: "responses",
  model: "allowed",
  reviewModel: "review",
  availableModels: [
    { provider: "gateway", model: "allowed" },
    { provider: "review-provider", model: "review" }
  ]
} as ModelConfig;

test("persists only authorized canonical model selections", async () => {
  let written: ModelConfig | undefined;
  const service = new ModelConfigService({
    readAuthorized: async () => config,
    writeRootConfig: async (next: ModelConfig) => {
      written = next;
      return { llm: next, preferences: {} } as never;
    },
    isCredentialConfigured: async () => true
  });
  const saved = await service.saveConfig({ ...config, model: "ALLOWED", reviewModel: "REVIEW" });
  assert.equal(written?.model, "allowed");
  assert.equal(written?.reviewModel, "review");
  assert.equal(saved.availableModels?.length, 2);
});

test("rejects a model outside the authorized subscription", async () => {
  const service = new ModelConfigService({
    readAuthorized: async () => config,
    writeRootConfig: async () => { throw new Error("must not write"); },
    isCredentialConfigured: async () => false
  });
  await assert.rejects(() => service.saveConfig({ ...config, model: "denied" }), /does not allow/);
});

test("persists Auto as a first-class model selection", async () => {
  let written: ModelConfig | undefined;
  const service = new ModelConfigService({
    readAuthorized: async () => config,
    writeRootConfig: async (next: ModelConfig) => {
      written = next;
      return { llm: next, preferences: {} } as never;
    },
    isCredentialConfigured: async () => true
  });
  const saved = await service.saveConfig({ ...config, model: "auto" });
  assert.equal(written?.model, "auto");
  assert.equal(saved.model, "auto");
});

test("never returns a configured credential to the renderer", async () => {
  const service = new ModelConfigService({
    readAuthorized: async () => ({ ...config, apiKey: "sk-never-return" }),
    writeRootConfig: async (next: ModelConfig) => ({ llm: next, preferences: {} }) as never,
    isCredentialConfigured: async () => true
  });
  const visible = await service.getConfig();
  assert.equal(visible.apiKey, "");
  assert.equal(visible.apiKeyConfigured, true);
});
