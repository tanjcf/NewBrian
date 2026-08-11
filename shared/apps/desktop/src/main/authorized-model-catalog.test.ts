import assert from "node:assert/strict";
import test from "node:test";
import type { ModelConfig } from "@codex-forge/protocol";
const { loadAuthorizedModelCatalog, parseAuthorizedModelPayload } = await import(
  new URL("./authorized-model-catalog.ts", import.meta.url).href
);

type AuthorizedModel = NonNullable<ModelConfig["availableModels"]>[number];

const cached: AuthorizedModel[] = [
  { id: "old", model: "old-model", label: "Old model", provider: "gateway" }
];
const remote: AuthorizedModel[] = [
  { id: "new", model: "new-model", label: "New model", provider: "gateway" }
];

test("refreshes the authorized model catalog even when a cache exists", async () => {
  let fetchCount = 0;
  let written: AuthorizedModel[] = [];

  const result = await loadAuthorizedModelCatalog({
    fetchRemote: async () => {
      fetchCount += 1;
      return remote;
    },
    readCache: async () => cached,
    writeCache: async (models: AuthorizedModel[]) => { written = models; }
  });

  assert.equal(fetchCount, 1);
  assert.deepEqual(result, remote);
  assert.deepEqual(written, remote);
});

test("treats a successful empty server catalog as authoritative", async () => {
  const result = await loadAuthorizedModelCatalog({
    fetchRemote: async () => [],
    readCache: async () => cached,
    writeCache: async () => { throw new Error("must not write"); }
  });

  assert.deepEqual(result, []);
});

test("uses the last successful cache when the server request fails", async () => {
  const result = await loadAuthorizedModelCatalog({
    fetchRemote: async () => null,
    readCache: async () => cached,
    writeCache: async () => { throw new Error("must not write"); }
  });

  assert.deepEqual(result, cached);
});

test("keeps only the last server entry for a callable model name", async () => {
  const replacement: AuthorizedModel = {
    id: "replacement",
    model: "old-model",
    label: "Old model BD",
    provider: "gateway-bd"
  };
  const result = await loadAuthorizedModelCatalog({
    fetchRemote: async () => [...cached, replacement],
    readCache: async () => [],
    writeCache: async () => undefined
  });

  assert.deepEqual(result, [replacement]);
});

test("uses server names as distinct callable aliases for versions of one provider model", () => {
  const result = parseAuthorizedModelPayload([
    { id: "deepseek-v4-pro", name: "deepseek-v4-pro", owned_by: "DeepSeek", config_id: "1" },
    { id: "deepseek-v4-pro", name: "deepseek-v4-pro-BD", owned_by: "DeepSeek", config_id: "11" }
  ]);

  assert.deepEqual(result, [
    { id: "1", model: "deepseek-v4-pro", label: "deepseek-v4-pro", provider: "DeepSeek" },
    { id: "11", model: "deepseek-v4-pro-BD", label: "deepseek-v4-pro-BD", provider: "DeepSeek" }
  ]);
});

test("preserves vision capability tags from the gateway model list", () => {
  const result = parseAuthorizedModelPayload([
    {
      id: "qwen3-vl-plus",
      name: "qwen3-vl-plus",
      owned_by: "DashScope",
      config_id: "9",
      capabilities: ["vision", "multimodal"]
    }
  ]);
  assert.deepEqual(result, [{
    id: "9",
    model: "qwen3-vl-plus",
    label: "qwen3-vl-plus",
    provider: "DashScope",
    capabilities: ["vision", "multimodal"]
  }]);
});

test("parses gateway routing profiles and merges capabilities", () => {
  const result = parseAuthorizedModelPayload([
    {
      id: "deepseek-v4-pro",
      name: "deepseek-v4-pro",
      owned_by: "DeepSeek",
      config_id: "2",
      capabilities: ["tools"],
      routing: {
        schema_version: 1,
        status: "active",
        tier: 2,
        cost_weight: 40,
        quality_weight: 80,
        roles: ["chat", "code"],
        capabilities: ["long_context"],
        probe_version: "v1"
      }
    },
    {
      id: "broken",
      name: "broken",
      owned_by: "Gateway",
      config_id: "9",
      routing: { schema_version: 2, status: "active" }
    }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.routing?.status, "active");
  assert.ok(result[0]?.capabilities?.includes("tools"));
  assert.ok(result[0]?.capabilities?.includes("long_context"));
  assert.equal(result[1]?.routing, undefined);
});
