import assert from "node:assert/strict";
import test from "node:test";
import {
  GrowthControlPlaneService,
  readGrowthEnabledFromCapabilities
} from "./growth-control-plane-service.ts";

test("readGrowthEnabledFromCapabilities defaults true and respects fleet flag", () => {
  assert.equal(readGrowthEnabledFromCapabilities(null), true);
  assert.equal(readGrowthEnabledFromCapabilities({ fleet: { growth_enabled: true } }), true);
  assert.equal(readGrowthEnabledFromCapabilities({ fleet: { growth_enabled: false } }), false);
});

test("GrowthControlPlaneService runs two-auto-node demo against mock fetch", async () => {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(init?.signal, undefined);
    const url = String(input);
    const method = String(init?.method || "GET");
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, body });
    if (url.endsWith("/api/growth/v1/processes") && method === "POST") {
      return json({ id: "gpd_1", status: "draft", name: "demo" });
    }
    if (url.endsWith("/api/growth/v1/processes/gpd_1/publish")) {
      return json({ id: "gpd_1", status: "published" });
    }
    if (url.endsWith("/api/growth/v1/instances") && method === "POST") {
      return json({ id: "gpi_1", status: "running", cursor_node_id: "n1" });
    }
    if (url.endsWith("/api/growth/v1/instances/gpi_1/lease")) {
      return json({ ok: true, lease_owner: "newbrain-desktop-host" });
    }
    if (url.endsWith("/api/growth/v1/instances/gpi_1/advance")) {
      const step = calls.filter((c) => c.url.endsWith("/advance")).length;
      return json({
        id: "gpi_1",
        status: step >= 2 ? "completed" : "running",
        cursor_node_id: step >= 2 ? "n2" : "n2"
      });
    }
    return json({ error: "unexpected" }, 500);
  };

  const service = new GrowthControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://127.0.0.1:8790",
      headers: { Authorization: "Bearer test" }
    }),
    fetchImpl
  });

  const result = await service.runTwoAutoNodeDemo("demo");
  assert.equal(result.processId, "gpd_1");
  assert.equal(result.instanceId, "gpi_1");
  assert.equal(result.finalStatus, "completed");
  assert.ok(calls.some((c) => c.url.includes("/publish")));
  assert.equal(calls.filter((c) => c.url.endsWith("/advance")).length, 2);
});

test("GrowthControlPlaneService runs auto-then-human demo against mock fetch", async () => {
  let advanceCount = 0;
  let callbackCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET");
    if (url.endsWith("/api/growth/v1/processes") && method === "POST") {
      return json({ id: "gpd_2", status: "draft" });
    }
    if (url.endsWith("/api/growth/v1/processes/gpd_2/publish")) {
      return json({ id: "gpd_2", status: "published" });
    }
    if (url.endsWith("/api/growth/v1/instances") && method === "POST") {
      return json({ id: "gpi_2", status: "running", cursor_node_id: "n1" });
    }
    if (url.endsWith("/api/growth/v1/instances/gpi_2/lease")) {
      return json({ ok: true, lease_owner: "newbrain-desktop-host" });
    }
    if (url.endsWith("/api/growth/v1/instances/gpi_2/advance")) {
      advanceCount += 1;
      if (advanceCount === 1) {
        return json({
          id: "gpi_2",
          status: "waiting_human",
          cursor_node_id: "h1",
          pending_human_task: { id: "ght_1", token: "ght_tok", status: "pending" }
        });
      }
      return json({ id: "gpi_2", status: "completed", cursor_node_id: "n2" });
    }
    if (url.endsWith("/api/growth/v1/human-callbacks") && method === "POST") {
      callbackCount += 1;
      return json({
        id: "gpi_2",
        status: "running",
        cursor_node_id: "n2"
      });
    }
    return json({ error: "unexpected", url }, 500);
  };

  const service = new GrowthControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://127.0.0.1:8790",
      headers: { Authorization: "Bearer test" }
    }),
    fetchImpl
  });

  const result = await service.runAutoThenHumanDemo("demo-g2");
  assert.equal(result.processId, "gpd_2");
  assert.equal(result.instanceId, "gpi_2");
  assert.equal(result.humanTaskId, "ght_1");
  assert.equal(result.finalStatus, "completed");
  assert.equal(result.duplicateCallbackStatus, "running");
  assert.equal(callbackCount, 2);
  assert.equal(advanceCount, 2);
});

test("GrowthControlPlaneService runs company skill share demo against mock fetch", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET");
    if (url.endsWith("/api/growth/v1/memories") && method === "PUT") {
      return json({ id: "gmem_1", etag: "e1", scope: "company", kind: "glossary" });
    }
    if (url.endsWith("/api/growth/v1/skills") && method === "POST") {
      return json({ id: "gsp_1", skill_id: "gsk_demo", tier: "personal", status: "draft" });
    }
    if (url.endsWith("/api/growth/v1/skills/gsk_demo/publish")) {
      return json({ id: "gsp_2", skill_id: "gsk_demo", tier: "company", status: "published" });
    }
    if (url.includes("/api/growth/v1/skills?") && method === "GET") {
      return json({
        items: [{ id: "gsp_2", skill_id: "gsk_demo", tier: "company", status: "published" }]
      });
    }
    return json({ error: "unexpected", url, method }, 500);
  };
  const service = new GrowthControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://127.0.0.1:8790",
      headers: { Authorization: "Bearer test" }
    }),
    fetchImpl
  });
  const result = await service.runCompanySkillShareDemo("gsk_demo");
  assert.equal(result.skillId, "gsk_demo");
  assert.equal(result.publicationId, "gsp_2");
  assert.equal(result.memoryId, "gmem_1");
  assert.equal(result.companySkillCount, 1);
});

test("GrowthControlPlaneService runs HTTP connector solidify demo without leaking secret", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET");
    if (url.endsWith("/api/growth/v1/connectors") && method === "POST") {
      return json({
        id: "gcn_1",
        type: "http",
        secret_ref: "gsec:abc",
        secret_present: true,
        config: { base_url: "https://example.com/api" }
      });
    }
    if (url.endsWith("/api/growth/v1/connectors/gcn_1/solidify")) {
      return json({
        connector: { id: "gcn_1", skill_id: "gsk-conn-gcn_1", status: "active" },
        skill: { skill_id: "gsk-conn-gcn_1", tier: "personal" },
        company_skill: { skill_id: "gsk-conn-gcn_1", tier: "company" }
      });
    }
    if (url.endsWith("/api/growth/v1/connectors/gcn_1/probe")) {
      return json({ ok: true, secret_ref: "gsec:abc", secret_present: true });
    }
    return json({ error: "unexpected", url, method }, 500);
  };
  const service = new GrowthControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://127.0.0.1:8790",
      headers: { Authorization: "Bearer test" }
    }),
    fetchImpl
  });
  const result = await service.runHttpConnectorSolidifyDemo("never-appear-in-response");
  assert.equal(result.connectorId, "gcn_1");
  assert.equal(result.skillId, "gsk-conn-gcn_1");
  assert.equal(result.secretLeaked, false);
  assert.equal(result.probeOk, true);
});

test("GrowthControlPlaneService runs CASE async+human demo against mock fetch", async () => {
  let advanceCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method || "GET");
    if (url.includes("/templates/case01-influencer/import") && method === "POST") {
      return json({ id: "gpd_case", status: "draft" });
    }
    if (url.endsWith("/api/growth/v1/processes/gpd_case/publish") && method === "POST") {
      return json({ id: "gpd_case", status: "published" });
    }
    if (url.endsWith("/api/growth/v1/instances") && method === "POST") {
      return json({ id: "gpi_case", status: "running", cursor_node_id: "n1" });
    }
    if (url.includes("/lease")) {
      return json({ ok: true });
    }
    if (url.includes("/advance")) {
      advanceCount += 1;
      if (advanceCount === 1) {
        return json({
          id: "gpi_case",
          status: "waiting_async",
          pending_async_ticket: { connector_id: "async", token: "gat_plain" }
        });
      }
      if (advanceCount === 2) {
        return json({
          id: "gpi_case",
          status: "waiting_human",
          pending_human_task: { token: "ght_plain", id: "ght1" }
        });
      }
      return json({ id: "gpi_case", status: "completed", cursor_node_id: "n3" });
    }
    if (url.includes("/webhooks/async") && method === "POST") {
      return json({ id: "gpi_case", status: "running", cursor_node_id: "h1" });
    }
    if (url.endsWith("/api/growth/v1/human-callbacks") && method === "POST") {
      return json({ id: "gpi_case", status: "running", cursor_node_id: "n3" });
    }
    return json({ error: "unexpected", url, method }, 500);
  };
  const service = new GrowthControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://127.0.0.1:8790",
      headers: { Authorization: "Bearer test" }
    }),
    fetchImpl
  });
  const result = await service.runCaseAsyncHumanDemo("case01-influencer");
  assert.equal(result.finalStatus, "completed");
  assert.equal(result.sawAsync, true);
  assert.equal(result.sawHuman, true);
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
