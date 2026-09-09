import assert from "node:assert/strict";
import test from "node:test";

const { fetchSpringAppAutoRoute } = await import(
  new URL("./spring-app-auto-route.ts", import.meta.url).href
);

test("fetchSpringAppAutoRoute posts to /v1/auto/route and maps chat decision with media tools", async () => {
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
        model: "deepseek-v4-flash",
        provider: "deepseek",
        channel: "text_chat",
        task_class: "general",
        optimize_for: "intelligence",
        degraded: false,
        reason_codes: ["hint_image_request", "media_via_tool_calls"],
        selected_reason: "text_chat",
        parent_role: "orchestrator",
        child_specialty: "",
        fallback_models: [],
        available_media_tools: ["image_generate", "video_generate"],
        tools: [
          { type: "function", function: { name: "image_generate" } },
          { type: "function", function: { name: "video_generate" } }
        ]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gateway.example/v1/auto/route");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.signal, undefined);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok");
  assert.equal(headers["X-NewBrain-Thread-Id"], "thread-a");
  assert.equal(headers["X-NewBrain-Request-Id"], "req-1");
  const body = JSON.parse(String(calls[0].init.body || "{}"));
  assert.equal(body.thread_id, "thread-a");
  assert.equal(body.request_id, "req-1");
  assert.equal(decision.model, "deepseek-v4-flash");
  assert.equal(decision.channel, "text_chat");
  assert.equal(decision.child_specialty, "");
  assert.equal(decision.optimize_for, "intelligence");
  assert.deepEqual(decision.available_media_tools, ["image_generate", "video_generate"]);
});

test("fetchSpringAppAutoRoute surfaces gateway Chinese error for missing image model", async () => {
  await assert.rejects(
    () => fetchSpringAppAutoRoute({
      gatewayBaseUrl: "http://127.0.0.1:9/v1",
      bearerToken: "tok",
      latestUserText: "出图",
      fetchImpl: async () => new Response(JSON.stringify({
        message: "当前套餐没有可用的文生图/出图模型（如 hy-image-v3），请在管理后台启用后再试。"
      }), { status: 400, headers: { "Content-Type": "application/json" } })
    }),
    /文生图|出图模型/
  );
});

test("fetchSpringAppAutoRoute reports correlation mismatches without failing", async () => {
  const mismatches: string[] = [];
  const decision = await fetchSpringAppAutoRoute({
    gatewayBaseUrl: "https://gateway.example",
    bearerToken: "tok",
    latestUserText: "你好",
    workspaceId: "ws-local",
    threadId: "th-local",
    requestId: "req-local",
    onCorrelationMismatch: (message) => {
      mismatches.push(message);
    },
    fetchImpl: async () => new Response(JSON.stringify({
      schema_version: 1,
      model: "flash",
      channel: "text_chat",
      task_class: "chat",
      optimize_for: "balanced",
      degraded: false,
      reason_codes: [],
      selected_reason: "ok",
      parent_role: "orchestrator",
      child_specialty: "",
      fallback_models: [],
      workspace_id: "ws-remote",
      thread_id: "th-remote",
      request_id: "req-remote"
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  assert.equal(decision.model, "flash");
  assert.ok(mismatches.length >= 1);
  assert.match(mismatches[0]!, /auto\/route/);
});
