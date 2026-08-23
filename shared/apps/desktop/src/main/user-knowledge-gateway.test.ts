import assert from "node:assert/strict";
import test from "node:test";
import { fetchKnowledgeSpace, pullKnowledgeDocuments, pushKnowledgeDocuments } from "./user-knowledge-gateway.ts";

test("knowledge synchronization has no timer-generated abort signal", async () => {
  const calls: RequestInit[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls.push(init ?? {});
    const method = init?.method;
    if (method === "POST") return new Response(JSON.stringify({ ok: true, space: { generation: 2, content_hash: "hash", document_count: 1, updated_at: "2026-08-22T00:00:00Z" } }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, space: { generation: 2, content_hash: "hash", document_count: 1, updated_at: "2026-08-22T00:00:00Z" }, documents: [] }), { status: 200 });
  };
  const auth = { gatewayBaseUrl: "https://gateway.example/v1", bearerToken: "session", fetchImpl };
  await fetchKnowledgeSpace(auth);
  await pullKnowledgeDocuments(auth);
  await pushKnowledgeDocuments({ ...auth, baseGeneration: 2, documents: [] });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((init) => init.signal === undefined));
});

test("knowledge synchronization forwards explicit user or application cancellation", async () => {
  const controller = new AbortController();
  const fetchImpl: typeof fetch = async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    return new Response(JSON.stringify({ space: { generation: 0, content_hash: "", document_count: 0, updated_at: "" } }), { status: 200 });
  };
  await fetchKnowledgeSpace({ gatewayBaseUrl: "https://gateway.example", bearerToken: "session", fetchImpl, signal: controller.signal });
});
