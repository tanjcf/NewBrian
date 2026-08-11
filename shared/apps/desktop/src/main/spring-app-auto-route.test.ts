import assert from "node:assert/strict";
import test from "node:test";

const { fetchSpringAppAutoRoute } = await import(
  new URL("./spring-app-auto-route.ts", import.meta.url).href
);

test("fetchSpringAppAutoRoute posts to /v1/auto/route and maps image_gen decision", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const decision = await fetchSpringAppAutoRoute({
    gatewayBaseUrl: "https://gateway.example/v1",
    bearerToken: "tok",
    latestUserText: "做一张卡通桌面壁纸",
    optimizeFor: "balanced",
    workspaceId: "ws-1",
    threadId: "thread-a",
    requestId: "req-1",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        schema_version: 1,
        model: "hy-image-v3",
        provider: "tokenhub",
        channel: "image_gen",
        task_class: "general",
        optimize_for: "intelligence",
        degraded: false,
        reason_codes: ["requires_image", "needs_image_gen_channel"],
        selected_reason: "image_gen",
        parent_role: "orchestrator",
        child_specialty: "image_gen",
        fallback_models: [],
        tool_name: "image_generate",
        media_kind: "image",
        media_execution: "server"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gateway.example/v1/auto/route");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok");
  assert.equal(headers["X-CodeCN-Thread-Id"], "thread-a");
  assert.equal(headers["X-CodeCN-Request-Id"], "req-1");
  const body = JSON.parse(String(calls[0].init.body || "{}"));
  assert.equal(body.thread_id, "thread-a");
  assert.equal(body.request_id, "req-1");
  assert.equal(decision.model, "hy-image-v3");
  assert.equal(decision.channel, "image_gen");
  assert.equal(decision.child_specialty, "image_gen");
  assert.equal(decision.optimize_for, "intelligence");
  assert.equal(decision.tool_name, "image_generate");
  assert.equal(decision.media_execution, "server");
});

test("fetchSpringAppAutoRoute surfaces Chinese no-image-model errors", async () => {
  await assert.rejects(
    () => fetchSpringAppAutoRoute({
      gatewayBaseUrl: "https://gateway.example",
      bearerToken: "tok",
      latestUserText: "出图",
      fetchImpl: async () => new Response(JSON.stringify({
        message: "当前套餐没有可用的文生图/出图模型（如 hy-image-v3）"
      }), { status: 400 })
    }),
    /文生图|hy-image/
  );
});

test("fetchSpringAppAutoRoute logs correlation mismatches without failing the route", async () => {
  const diagnostics: string[] = [];
  const decision = await fetchSpringAppAutoRoute({
    gatewayBaseUrl: "https://gateway.example/v1",
    bearerToken: "tok",
    latestUserText: "hello",
    threadId: "thread-a",
    requestId: "req-1",
    onCorrelationMismatch: (message) => { diagnostics.push(message); },
    fetchImpl: async () => new Response(JSON.stringify({
      model: "gpt-test",
      channel: "text_chat",
      thread_id: "thread-b",
      request_id: "req-9"
    }), { status: 200 })
  });
  assert.equal(decision.model, "gpt-test");
  assert.equal(decision.correlationMismatches?.length, 2);
  assert.match(diagnostics[0] || "", /local TurnScope remains authoritative/);
});
