import assert from "node:assert/strict";
import test from "node:test";
import type { ModelConfig } from "@codex-forge/protocol";
import {
  resolveTrustedPrivateModelCredential,
  separatePrivateModelCredential,
  toRendererSafeModelConfig
} from "./private-model-credential-policy.ts";

const baseConfig = {
  provider: "private",
  baseUrl: "https://models.example.invalid/v1",
  apiKey: "",
  wireApi: "responses",
  model: "private-model",
  reviewModel: "private-model",
  reasoningEffort: "medium",
  disableResponseStorage: true,
  systemPrompt: "",
  optimizeFor: "balanced"
} satisfies ModelConfig;

test("separates a private credential from configuration before persistence", () => {
  const separated = separatePrivateModelCredential({
    ...baseConfig,
    apiKey: "  sk-user-private  "
  });

  assert.equal(separated.credential, "sk-user-private");
  assert.equal(separated.config.apiKey, "");
  assert.equal(JSON.stringify(separated.config).includes("sk-user-private"), false);
});

test("never returns a private credential to the renderer", () => {
  const visible = toRendererSafeModelConfig({
    ...baseConfig,
    apiKey: "sk-never-return"
  }, true);

  assert.equal(visible.apiKey, "");
  assert.equal(visible.apiKeyConfigured, true);
  assert.equal(JSON.stringify(visible).includes("sk-never-return"), false);
});

test("preserves an existing vault credential when no replacement is supplied", () => {
  const separated = separatePrivateModelCredential({
    ...baseConfig,
    apiKey: "",
    apiKeyConfigured: true
  });

  assert.equal(separated.credential, "");
  assert.equal(separated.config.apiKeyConfigured, true);
});

test("resolves a vault credential only for the trusted request path", async () => {
  let vaultReads = 0;
  assert.equal(await resolveTrustedPrivateModelCredential(" sk-request ", async () => {
    vaultReads += 1;
    return "sk-vault";
  }), "sk-request");
  assert.equal(vaultReads, 0);

  assert.equal(await resolveTrustedPrivateModelCredential("", async () => {
    vaultReads += 1;
    return " sk-vault ";
  }), "sk-vault");
  assert.equal(vaultReads, 1);
});
