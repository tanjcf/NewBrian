import assert from "node:assert/strict";
import test from "node:test";

const serviceModule = import(new URL("./holon-control-plane-service.ts", import.meta.url).href) as Promise<
  typeof import("./holon-control-plane-service.js")
>;

const claimedItem = {
  id: "wi_1", source: "desktop", objective: "Run tests", status: "DISPATCHED",
  target_device_id: "device_1", knowledge_snapshot_id: "ks_1",
  execution_policy_version: "execution-v1", learning_policy_version: "learning-v1",
  version_no: 1, dispatch_attempt_count: 1, lease_until: "2026-07-22T00:02:00.000Z",
  cancel_requested: false, created_at: "2026-07-22T00:00:00.000Z",
  updated_at: "2026-07-22T00:00:00.000Z"
};

test("expert preferences use authenticated Spring endpoints and propagate save failures", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const service = new HolonControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://203.0.113.10:8790", deviceId: "test", headers: { Authorization: "Bearer fixture" } }),
    fetchImpl: async (url, init) => {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture");
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      return init?.method === "POST" ? new Response(JSON.stringify({ message: "cannot save" }), { status: 400 })
        : new Response(JSON.stringify({ items: [{ scope: "global", scene: "software", expertId: "review", mode: "ask" }] }));
    }
  });
  assert.equal((await service.expertPreferences("global"))[0].mode, "ask");
  await assert.rejects(service.saveExpertPreference({ scope: "global", scene: "software", expertId: "review", mode: "auto" }), /HOLON_HTTP_400/);
  assert.match(calls[0].url, /\/experts\/preferences\?scope=global$/);
  assert.equal(JSON.parse(String(calls[1].body)).expertId, "review");
});

test("claims the authenticated device WorkItem without exposing credentials", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  const requests: Array<{ url: string; headers: Headers }> = [];
  const service = new HolonControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://203.0.113.10:8790",
      deviceId: "device_1",
      headers: { Authorization: "Bearer secret", "X-Desktop-Device-Id": "device_1" }
    }),
    now: () => Date.parse("2026-07-22T00:01:00.000Z"),
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ ok: true, item: claimedItem }), { status: 200 });
    }
  });

  const item = await service.claimNextWorkItem();

  assert.equal(item?.id, "wi_1");
  assert.equal(requests[0]?.url, "http://203.0.113.10:8790/api/desktop/v1/holon/work-items/next?device_id=device_1");
  assert.equal(requests[0]?.headers.get("Authorization"), "Bearer secret");
  assert.equal(JSON.stringify(item).includes("secret"), false);
});

test("returns null when Spring has no queued WorkItem", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  const service = new HolonControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://server", deviceId: "device_1", headers: {} }),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, item: {} }), { status: 200 })
  });

  assert.equal(await service.claimNextWorkItem(), null);
});

test("uploads runtime events using the Spring snake-case batch contract", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  let requestBody: any = null;
  const service = new HolonControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://server", deviceId: "device_1", headers: {} }),
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, accepted: 1, duplicate: 0, total: 1 }), { status: 200 });
    }
  });
  const result = await service.sendEvents([{
    schemaVersion: 1,
    eventId: "evt_1",
    workItemId: "wi_1",
    threadId: "thread_1",
    turnId: "turn_1",
    sequenceNo: 0,
    eventType: "work_item.started",
    occurredAt: "2026-07-22T00:00:00.000Z",
    payload: {}
  }]);

  assert.equal(result.accepted, 1);
  assert.deepEqual(requestBody, {
    schema_version: 1,
    device_id: "device_1",
    events: [{
      event_id: "evt_1",
      work_item_id: "wi_1",
      thread_id: "thread_1",
      turn_id: "turn_1",
      sequence_no: 0,
      event_type: "work_item.started",
      occurred_at: "2026-07-22T00:00:00.000Z",
      payload: {}
    }]
  });
});

test("parses an immutable owned knowledge snapshot", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  const service = new HolonControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://server", deviceId: "device_1", headers: {} }),
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      snapshot: {
        id: "ks_1", generation: 1, status: "READY", item_count: 1, content_hash: "abc",
        created_at: "2026-07-22T00:00:00.000Z",
        items: [{ skill_key: "qa.skill", version_id: "hsv_1", ordinal_no: 0,
          content_json: "{}", content_hash: "def" }]
      }
    }), { status: 200 })
  });

  const snapshot = await service.getKnowledgeSnapshot("ks_1");
  assert.equal(snapshot.items[0]?.versionId, "hsv_1");
});

test("maps ownership-safe HTTP errors to stable codes", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  const service = new HolonControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://server", deviceId: "device_1", headers: {} }),
    fetchImpl: async () => new Response(JSON.stringify({ message: "HOLON_WORK_NOT_FOUND" }), { status: 404 })
  });

  await assert.rejects(() => service.claimNextWorkItem(), /HOLON_HTTP_404:HOLON_WORK_NOT_FOUND/);
});

test("rejects WorkItems assigned to another device or with an expired lease", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  const responseFor = (item: Record<string, unknown>) => new HolonControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://server", deviceId: "device_1", headers: {} }),
    now: () => Date.parse("2026-07-22T00:01:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, item }), { status: 200 })
  });

  await assert.rejects(() => responseFor({ ...claimedItem, target_device_id: "device_2" }).claimNextWorkItem(),
    /HOLON_TARGET_DEVICE_MISMATCH/);
  await assert.rejects(() => responseFor({ ...claimedItem, lease_until: "2026-07-22T00:00:59.000Z" }).claimNextWorkItem(),
    /HOLON_LEASE_EXPIRED/);
});

test("refreshes authentication once after a 401 without exposing credentials", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  const authorizations: Array<string | null> = [];
  let refreshes = 0;
  const service = new HolonControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://server", deviceId: "device_1", headers: { Authorization: "Bearer expired" }
    }),
    refreshConnection: async () => {
      refreshes += 1;
      return { gatewayOrigin: "http://server", deviceId: "device_1", headers: { Authorization: "Bearer fresh" } };
    },
    now: () => Date.parse("2026-07-22T00:01:00.000Z"),
    fetchImpl: async (_input, init) => {
      const authorization = new Headers(init?.headers).get("Authorization");
      authorizations.push(authorization);
      return authorization === "Bearer fresh"
        ? new Response(JSON.stringify({ ok: true, item: claimedItem }), { status: 200 })
        : new Response(JSON.stringify({ message: "TOKEN_EXPIRED" }), { status: 401 });
    }
  });

  assert.equal((await service.claimNextWorkItem())?.id, "wi_1");
  assert.equal(refreshes, 1);
  assert.deepEqual(authorizations, ["Bearer expired", "Bearer fresh"]);
});

test("returns typed owner-free candidates and knowledge results", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  let path = "";
  const service = new HolonControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://server", deviceId: "device_1", headers: {} }),
    fetchImpl: async (input) => {
      path = new URL(String(input)).pathname;
      return path.endsWith("/candidates")
        ? new Response(JSON.stringify({ items: [{
            id: "hsv_1", skill_key: "qa.skill", parent_version_id: null, status: "REVIEW_REQUIRED",
            content_json: "{}", content_hash: "abc", source_work_item_id: null,
            evaluation_run_id: null, index_status: "PENDING", created_at: "2026-07-22T00:00:00Z",
            activated_at: null
          }] }), { status: 200 })
        : new Response(JSON.stringify({ items: [{
            skill_key: "qa.skill", version_id: "hsv_1", content: "run tests", content_hash: "abc",
            created_at: "2026-07-22T00:00:00Z", score: 0.8
          }] }), { status: 200 });
    }
  });

  assert.equal((await service.listCandidates())[0]?.versionId, "hsv_1");
  assert.equal((await service.searchKnowledge("tests"))[0]?.skillKey, "qa.skill");
});

test("retries one transient 429 or 5xx response", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  for (const transientStatus of [429, 503]) {
    let attempts = 0;
    const service = new HolonControlPlaneService({
      getConnection: async () => ({ gatewayOrigin: "http://server", deviceId: "device_1", headers: {} }),
      now: () => Date.parse("2026-07-22T00:01:00.000Z"),
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? new Response(JSON.stringify({ message: "TRANSIENT" }), { status: transientStatus })
          : new Response(JSON.stringify({ ok: true, item: claimedItem }), { status: 200 });
      }
    });

    assert.equal((await service.claimNextWorkItem())?.id, "wi_1");
    assert.equal(attempts, 2);
  }
});

test("does not attach a timer-generated abort signal", async () => {
  const { HolonControlPlaneService } = await serviceModule;
  let signal: AbortSignal | null | undefined;
  const service = new HolonControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://server", deviceId: "device_1", headers: { Authorization: "Bearer secret" }
    }),
    now: () => Date.parse("2026-07-22T00:01:00.000Z"),
    fetchImpl: async (_url, init) => {
      signal = init?.signal;
      return new Response(JSON.stringify({ ok: true, item: claimedItem }), { status: 200 });
    }
  });
  assert.equal((await service.claimNextWorkItem())?.id, "wi_1");
  assert.equal(signal, undefined);
});
