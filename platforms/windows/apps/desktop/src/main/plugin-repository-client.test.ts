import assert from "node:assert/strict";
import test from "node:test";
const { PluginRepositoryClient } = await import(
  new URL("./plugin-repository-client.ts", import.meta.url).href
) as typeof import("./plugin-repository-client.js");

const item = {
  plugin_key: "game-studio", display_name: "Game Studio", description: "Build games",
  category: "Developer Tools", publisher: "OpenAI", scope: "public", icon_url: "",
  install_state: "not_installed", installed_version: "", latest_version: "1.0.0",
  actions: ["install"], skills: ["phaser"]
};

test("lists the Spring catalog with desktop authentication and normalized paging", async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  const client = new PluginRepositoryClient({
    gatewayOrigin: "http://127.0.0.1:8790/path",
    headers: { Authorization: "Bearer token", "X-Device-ID": "device-001" },
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ items: [item], page: 1, size: 20, total: 1 }), { status: 200 });
    }
  });
  const result = await client.list({ scope: "public", keyword: "game", page: 1, pageSize: 20 }, "device-001");
  assert.equal(result.items[0].plugin_key, "game-studio");
  assert.deepEqual(result.categories, ["Developer Tools"]);
  assert.match(captured.url ?? "", /^http:\/\/127\.0\.0\.1:8790\/api\/desktop\/v1\/plugins\?/);
  assert.match(captured.url ?? "", /device_id=device-001/);
  assert.equal((captured.init?.headers as Record<string, string>).Authorization, "Bearer token");
});

test("downloads only same-origin archives and preserves integrity headers", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const client = new PluginRepositoryClient({
    gatewayOrigin: "https://plugins.example", headers: {},
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://plugins.example/api/desktop/v1/plugins/game-studio/download?version=1.0.0");
      return new Response(bytes, { status: 200, headers: { "X-Content-SHA256": "abc", "X-Content-Signature": "ed25519:sig" } });
    }
  });
  const result = await client.download("game-studio", "1.0.0");
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(result.contentHash, "abc");
  await assert.rejects(() => client.downloadUrl("https://evil.example/plugin.zip"), /same origin/i);
});

test("rejects malformed catalog payloads and reports stable HTTP errors", async () => {
  const malformed = new PluginRepositoryClient({
    gatewayOrigin: "https://plugins.example", headers: {},
    fetchImpl: async () => new Response(JSON.stringify({ items: [{ plugin_key: 42 }] }), { status: 200 })
  });
  await assert.rejects(() => malformed.list({}, "device-001"), /invalid plugin catalog/i);
  const denied = new PluginRepositoryClient({
    gatewayOrigin: "https://plugins.example", headers: {},
    fetchImpl: async () => new Response(JSON.stringify({ code: "DENIED", message: "No access" }), { status: 403 })
  });
  await assert.rejects(() => denied.list({}, "device-001"), /DENIED: No access/);
});

test("reports an installed version with the server field names", async () => {
  let body = "";
  const client = new PluginRepositoryClient({
    gatewayOrigin: "https://plugins.example", headers: {},
    fetchImpl: async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ status: "installed", version: "1.0.0" }), { status: 200 });
    }
  });
  await client.report("device-001", "game-studio", {
    status: "installed", version: "1.0.0", content_hash: "abc",
    client_version: "0.1.55", reported_at: "2026-07-22T00:00:00Z"
  });
  assert.deepEqual(JSON.parse(body), {
    status: "installed", version: "1.0.0", content_hash: "abc",
    client_version: "0.1.55", reported_at: "2026-07-22T00:00:00Z"
  });
});
