import assert from "node:assert/strict";
import test from "node:test";
import { AgentTurnControlPlaneService } from "./agent-turn-control-plane.ts";

test("startTurn returns offline degrade when disabled", async () => {
  const service = new AgentTurnControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://127.0.0.1:9", headers: {} }),
    isEnabled: () => false
  });
  const result = await service.startTurn({ sessionId: "sess", idempotencyKey: "k1" });
  assert.equal(result.offline, true);
  assert.equal(result.turnId, "");
});

test("cancelTurn posts cancel path and tolerates network failure", async () => {
  const calls: Array<{ url: string; body: string | undefined; signal?: AbortSignal | null }> = [];
  const service = new AgentTurnControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://spring.test",
      headers: { Authorization: "Bearer t" }
    }),
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined, signal: init?.signal });
      return new Response(JSON.stringify({ turnId: "trn_1", status: "cancelled" }), { status: 200 });
    }) as typeof fetch
  });
  const result = await service.cancelTurn({ sessionId: "thread-1", turnId: "trn_1", reason: "user_stop" });
  assert.equal(result.ok, true);
  assert.equal(result.status, "cancelled");
  assert.match(calls[0].url, /\/sessions\/thread-1\/turns\/trn_1\/cancel$/);
  assert.match(calls[0].body || "", /user_stop/);
  assert.equal(calls[0].signal, undefined);

  const offline = new AgentTurnControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://spring.test", headers: {} }),
    fetchImpl: (async () => {
      throw new Error("network");
    }) as typeof fetch
  });
  const degraded = await offline.cancelTurn({ sessionId: "s", turnId: "trn_x" });
  assert.equal(degraded.ok, false);
  assert.equal(degraded.offline, true);
});

test("resolveApproval deny never allows side effects even when offline", async () => {
  const online = new AgentTurnControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://spring.test", headers: {} }),
    fetchImpl: (async () => new Response(JSON.stringify({
      sideEffectAllowed: false,
      approval: { approvalId: "ap_1", status: "denied" }
    }), { status: 200 })) as typeof fetch
  });
  const denied = await online.resolveApproval({ approvalId: "ap_1", decision: "deny" });
  assert.equal(denied.sideEffectAllowed, false);
  assert.equal(denied.status, "denied");

  const offline = new AgentTurnControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://spring.test", headers: {} }),
    fetchImpl: (async () => {
      throw new Error("down");
    }) as typeof fetch
  });
  const offlineDeny = await offline.resolveApproval({ approvalId: "ap_2", decision: "deny" });
  assert.equal(offlineDeny.sideEffectAllowed, false);
  // Offline approve degrades to local user decision (Hybrid Mode A)
  const offlineApprove = await offline.resolveApproval({ approvalId: "ap_3", decision: "approve" });
  assert.equal(offlineApprove.sideEffectAllowed, true);
  assert.equal(offlineApprove.offline, true);
});

test("resolveApproval approve requires spring sideEffectAllowed=true", async () => {
  const service = new AgentTurnControlPlaneService({
    getConnection: async () => ({ gatewayOrigin: "http://spring.test", headers: {} }),
    fetchImpl: (async () => new Response(JSON.stringify({
      sideEffectAllowed: true,
      approval: { approvalId: "ap_ok", status: "approved" }
    }), { status: 200 })) as typeof fetch
  });
  const approved = await service.resolveApproval({ approvalId: "ap_ok", decision: "approve" });
  assert.equal(approved.sideEffectAllowed, true);
  assert.equal(approved.status, "approved");
});

test("startTurn attaches correlation ids and reports response mismatches diagnostically", async () => {
  const bodies: string[] = [];
  const diagnostics: string[] = [];
  const service = new AgentTurnControlPlaneService({
    getConnection: async () => ({
      gatewayOrigin: "http://spring.test",
      headers: { Authorization: "Bearer t" }
    }),
    onCorrelationMismatch: (message) => { diagnostics.push(message); },
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      bodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({
        turnId: "trn_1",
        sessionId: "thread-b",
        status: "running",
        request_id: "req-9"
      }), { status: 200 });
    }) as typeof fetch
  });
  const result = await service.startTurn({
    sessionId: "thread-a",
    idempotencyKey: "req-1",
    clientMessageId: "req-1",
    workspaceId: "ws-1",
    requestId: "req-1"
  });
  assert.equal(result.turnId, "trn_1");
  assert.equal(result.sessionId, "thread-b");
  assert.match(bodies[0] || "", /"thread_id":"thread-a"/);
  assert.match(bodies[0] || "", /"request_id":"req-1"/);
  assert.ok((result.correlationMismatches?.length || 0) >= 1);
  assert.match(diagnostics[0] || "", /agent-turn\/start/);
});
