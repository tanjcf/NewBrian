import assert from "node:assert/strict";
import test from "node:test";

const { executeDelegatedModelStep } = await import(
  new URL("./delegated-model-step.ts", import.meta.url).href
);
const { isRetryableModelGatewayError } = await import(
  new URL("./desktop-auth-policy.ts", import.meta.url).href
);

const gatewayReset = "无法连接模型网关；endpoint=https://api.sinnauze.cn/v1/responses；code=ECONNRESET；请检查模型 Base URL、网络连接和本地防火墙设置。";

test("child model step enters the shared step service with the child abort signal", async () => {
  const abortController = new AbortController();
  const seen: Array<Record<string, unknown>> = [];
  const stepService = {
    async execute(input: Record<string, unknown>) {
      seen.push(input);
      return { content: "child-ok", toolCalls: [], webSearchCalls: [], citations: [] };
    }
  };
  const result = await executeDelegatedModelStep(stepService as never, {
    modelInput: {
      requestId: "child-1",
      provider: "gateway",
      baseUrl: "https://api.sinnauze.cn/v1",
      apiKey: "",
      wireApi: "responses",
      model: "auto",
      reviewModel: "auto",
      reasoningEffort: "medium",
      disableResponseStorage: true,
      systemPrompt: "child",
      messages: []
    },
    messages: [{ role: "user", content: "调研" }],
    tools: [{ name: "workspace.read" }],
    systemPrompt: "child system",
    abortSignal: abortController.signal,
    requestId: "child-1",
    onReasoningDelta: () => undefined,
    onRetry: () => undefined
  });
  assert.equal(result.content, "child-ok");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].abortSignal, abortController.signal);
  assert.equal(seen[0].requestId, "child-1");
  assert.equal(seen[0].systemPrompt, "child system");
  assert.equal(seen[0].suppressVisibleContent, true);
  assert.deepEqual(seen[0].messages, [{ role: "user", content: "调研" }]);
  assert.equal(typeof seen[0].publishRetry, "function");
});

test("the shared gateway policy treats the child ECONNRESET text as retryable", () => {
  assert.equal(isRetryableModelGatewayError(new Error(gatewayReset)), true);
});
