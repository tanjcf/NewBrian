import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ModelConfig } from "@codex-forge/protocol";
import { createReadAuthorizedDesktopModelConfig } from "./read-authorized-desktop-model-config.ts";

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

test("uses the OS vault credential only inside the trusted model request", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-model-catalog-"));
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.signal, undefined);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({
      data: [{ id: "private-model", model: "private-model", provider: "private", label: "Private" }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const readConfig = createReadAuthorizedDesktopModelConfig({
      readRootConfig: async () => ({ llm: baseConfig }),
      readBundledRootConfig: async () => null,
      readDesktopAuthState: async () => null,
      readPrivateModelCredential: async () => "sk-from-os-vault",
      readGatewayOrigin: async () => "https://models.example.invalid",
      createDesktopAuthHeaders: () => ({}),
      collectDesktopDeviceFingerprint: () => ({}),
      appendDesktopDebugLog: async () => undefined,
      ensureDirectory: async () => undefined,
      parseJsonText: JSON.parse,
      normalizeModelConfig: (input) => ({ ...baseConfig, ...input }),
      authorizedModelsCachePath: join(root, "authorized-models.json"),
      desktopControlPlaneStatePath: join(root, "control-plane.json"),
      configuredGatewayBaseUrlEnv: "",
      productionGatewayBaseUrl: "https://models.example.invalid/v1",
      defaultGatewayBaseUrl: "https://models.example.invalid/v1",
      isPackaged: false,
      setCachedAuthorizedModels: () => undefined
    });

    const result = await readConfig();
    assert.equal(authorization, "Bearer sk-from-os-vault");
    assert.equal(result.apiKey, "");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});
