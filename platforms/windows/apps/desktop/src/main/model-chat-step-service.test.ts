import assert from "node:assert/strict";
import test from "node:test";

const { ModelChatStepService } = await import(
  new URL("./model-chat-step-service.ts", import.meta.url).href
);

function baseExecution(overrides: Record<string, unknown> = {}) {
  const stream: Array<{ requestId: string; delta: string; reset?: boolean }> = [];
  const reasoning: string[] = [];
  const retries: string[] = [];
  const searches: unknown[] = [];
  const tokens: number[] = [];
  return {
    stream,
    reasoning,
    retries,
    searches,
    tokens,
    input: {
      modelInput: { requestId: "request-1" },
      messages: [],
      tools: [],
      systemPrompt: "system",
      abortSignal: new AbortController().signal,
      suppressVisibleContent: false,
      requestId: "request-1",
      emitReasoningSummary: (delta: string) => { reasoning.push(delta); },
      emitStream: (payload: { requestId: string; delta: string; reset?: boolean }) => { stream.push(payload); },
      publishRetry: (requestId: string) => { retries.push(requestId); },
      publishWebSearch: (action: unknown) => { searches.push(action); },
      recordWebSearch: (search: unknown) => { searches.push(search); },
      recordTokens: (value: number) => { tokens.push(value); },
      ...overrides
    } as never
  };
}

test("retries one transient failure and records usage plus web search", async () => {
  let calls = 0;
  const service = new ModelChatStepService({
    callModel: async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return {
        content: "done",
        toolCalls: [],
        usage: { output_tokens: 4 },
        webSearchCalls: [{ id: "search-1", status: "completed", action: { query: "q" } }],
        citations: [{ url: "https://example.com", title: "Example" }]
      };
    },
    isRetryableError: () => true,
    readUsageTokens: () => 4,
    containsPrivatePlanning: () => false
  });
  const execution = baseExecution();
  const result = await service.execute(execution.input);
  assert.equal(result.content, "done");
  assert.equal(calls, 2);
  assert.deepEqual(execution.retries, ["request-1"]);
  assert.deepEqual(execution.tokens, [4]);
  assert.equal(execution.searches.length, 2);
});

test("resets tool-planning output and routes private planning into the thinking panel", async () => {
  const response = { content: "private", toolCalls: [{}], webSearchCalls: [], citations: [] };
  const service = new ModelChatStepService({
    callModel: async () => response,
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => true
  });
  const execution = baseExecution();
  await service.execute(execution.input);
  assert.deepEqual(execution.stream, []);
  assert.deepEqual(execution.reasoning, ["private"]);
});

test("rejects private planning without tool calls instead of persisting an empty answer", async () => {
  const planning = "The user asks my name. I should answer directly in Chinese.";
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.(planning);
      return { content: planning, toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => true
  });
  const execution = baseExecution();

  await assert.rejects(
    service.execute(execution.input),
    /did not include assistant content or tool calls/
  );
  assert.equal(execution.stream.length, 0);
  assert.equal(execution.reasoning.join(""), planning);
});

test("retries empty assistant responses when the gateway error is marked retryable", async () => {
  let calls = 0;
  const service = new ModelChatStepService({
    callModel: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          content: "The user asks my name. I should answer directly in Chinese.",
          toolCalls: [],
          webSearchCalls: [],
          citations: []
        };
      }
      return { content: "你好，我是 NewBrain。", toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: (error) => error instanceof Error
      && /did not include assistant content or tool calls/i.test(error.message),
    readUsageTokens: () => 0,
    containsPrivatePlanning: (text) => /I should answer/i.test(text),
    delay: async () => undefined
  });
  const execution = baseExecution();
  const result = await service.execute(execution.input);
  assert.equal(calls, 2);
  assert.equal(result.content, "你好，我是 NewBrain。");
  assert.deepEqual(execution.retries, ["request-1"]);
});

test("retries five transient stream failures with bounded exponential backoff", async () => {
  let calls = 0;
  const retryAttempts: number[] = [];
  const delays: number[] = [];
  const service = new ModelChatStepService({
    callModel: async () => {
      calls += 1;
      if (calls <= 5) throw new Error("Model response stream inactive for 20000ms.");
      return { content: "recovered", toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => true,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false,
    delay: async (milliseconds: number) => { delays.push(milliseconds); }
  });
  const execution = baseExecution({
    resilientGoalMode: true,
    publishRetry: (_requestId: string, attempt: number) => { retryAttempts.push(attempt); }
  });

  const result = await service.execute(execution.input);

  assert.equal(result.content, "recovered");
  assert.equal(calls, 6);
  assert.deepEqual(retryAttempts, [1, 2, 3, 4, 5]);
  assert.deepEqual(delays, [500, 1_000, 2_000, 4_000, 8_000]);
});

test("retries a response-headers timeout only once", async () => {
  let calls = 0;
  const service = new ModelChatStepService({
    callModel: async () => {
      calls += 1;
      throw new Error("Model response headers timed out after 60000ms.");
    },
    isRetryableError: () => true,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false,
    delay: async () => undefined,
  });
  const execution = baseExecution();

  await assert.rejects(service.execute(execution.input), /response headers timed out/i);
  assert.equal(calls, 2);
  assert.deepEqual(execution.retries, ["request-1"]);
});

test("user cancellation is never retried in goal mode", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  let calls = 0;
  const service = new ModelChatStepService({
    callModel: async () => { calls += 1; throw new Error("aborted"); },
    isRetryableError: () => true,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false
  });
  const execution = baseExecution({ abortSignal: controller.signal, resilientGoalMode: true });

  await assert.rejects(service.execute(execution.input), /cancelled|aborted/);
  assert.equal(calls, 1);
  assert.deepEqual(execution.retries, []);
});

test("keeps an active streaming model step attached to the user cancellation signal", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const service = new ModelChatStepService({
    callModel: async (input: { signal: AbortSignal }) => {
      receivedSignal = input.signal;
      await new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener("abort", () => {
          reject(input.signal.reason instanceof Error ? input.signal.reason : new Error("aborted"));
        }, { once: true });
        queueMicrotask(() => controller.abort(new Error("cancelled")));
      });
      return { content: "done", toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false
  });
  const execution = baseExecution({ abortSignal: controller.signal, visibleContentIdleTimeoutMs: 0 });

  await assert.rejects(service.execute(execution.input), /cancelled/);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal!.aborted, true);
});

test("does not abort a model step because visible answer text is delayed", async () => {
  const service = new ModelChatStepService({
    callModel: async (input: { onReasoningDelta: (delta: string) => void; onTextDelta?: (delta: string) => void }) => {
      input.onReasoningDelta("Let me use shell.exec to write the file...");
      await new Promise((resolve) => setTimeout(resolve, 35));
      input.onTextDelta?.("最终答案");
      return { content: "最终答案", toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => true,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false
  });
  const execution = baseExecution({ visibleContentIdleTimeoutMs: 20 });

  const result = await service.execute(execution.input);
  assert.equal(result.content, "最终答案");
  assert.match(execution.reasoning.join(""), /shell\.exec/);
});

test("continuous reasoning deltas renew the idle budget like OpenClaw progress", async () => {
  const service = new ModelChatStepService({
    callModel: async (input: { onReasoningDelta: (delta: string) => void; onTextDelta?: (delta: string) => void }) => {
      input.onReasoningDelta("step-1 ");
      await new Promise((resolve) => setTimeout(resolve, 35));
      input.onReasoningDelta("step-2 ");
      await new Promise((resolve) => setTimeout(resolve, 35));
      input.onTextDelta?.("最终答案");
      return { content: "最终答案", toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false
  });
  const execution = baseExecution({ visibleContentIdleTimeoutMs: 50 });
  const result = await service.execute(execution.input);
  assert.equal(result.content, "最终答案");
  assert.match(execution.reasoning.join(""), /step-1/);
  assert.match(execution.reasoning.join(""), /step-2/);
});

test("visible answer text renews the idle budget so long drafts can finish", async () => {
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.("一、");
      await new Promise((resolve) => setTimeout(resolve, 30));
      input.onTextDelta?.("背景");
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { content: "一、背景", toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false
  });
  const execution = baseExecution({ visibleContentIdleTimeoutMs: 50 });
  const result = await service.execute(execution.input);
  assert.equal(result.content, "一、背景");
  assert.deepEqual(execution.stream.map((item) => item.delta), ["一、", "背景"]);
});

test("forwards real SSE text deltas immediately without replaying the final response", async () => {
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.("长篇");
      input.onTextDelta?.("写作");
      return { content: "长篇写作", toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false
  });
  const execution = baseExecution({ resilientGoalMode: true, suppressVisibleContent: true });

  await service.execute(execution.input);

  assert.deepEqual(execution.stream, [
    { requestId: "request-1", delta: "长篇" },
    { requestId: "request-1", delta: "写作" }
  ]);
});

test("never projects private decision-card planning into the assistant stream", async () => {
  const content = "The user input request has been created. Now I need to wait for the user to choose one of the three options. Let me present the decision card to the user and stop here.";
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.(content.slice(0, 90));
      input.onTextDelta?.(content.slice(90));
      return { content, toolCalls: [{ name: "goal.request_user_input" }], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => true
  });
  const execution = baseExecution();

  await service.execute(execution.input);

  assert.deepEqual(execution.stream, []);
  assert.equal(execution.reasoning.join(""), content);
});

test("routes Chinese tool-introspection chain-of-thought into the thinking panel", async () => {
  const content = "用户已经确认了大纲。当前可用工具没有 web.search_official，先检查一下当前工具列表再决定下一步。";
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.(content);
      return { content, toolCalls: [{ name: "goal_get" }], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: (text: string) => /用户已经确认了大纲|当前可用工具/.test(text)
  });
  const execution = baseExecution();

  await service.execute(execution.input);

  assert.deepEqual(execution.stream, []);
  assert.match(execution.reasoning.join(""), /当前可用工具/);
});

test("keeps already streamed chat text when later deltas look like private planning", async () => {
  const progress = "已完成材料评估，开始整理官方证据。";
  const planning = "用户已经确认了大纲。当前可用工具没有 web.search_official，先检查一下当前工具列表。";
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.(progress);
      input.onTextDelta?.(planning);
      return {
        content: progress + planning,
        toolCalls: [{ name: "goal.get" }],
        webSearchCalls: [],
        citations: []
      };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: (text: string) => /用户已经确认了大纲|当前可用工具/.test(text)
  });
  const execution = baseExecution();

  await service.execute(execution.input);

  assert.deepEqual(execution.stream, [{ requestId: "request-1", delta: progress }]);
  assert.match(execution.reasoning.join(""), /当前可用工具/);
});

test("diverts late English apply_patch narration into thinking after Chinese progress", async () => {
  const progress = "第一批：核心框架文件。";
  const planning = "The patch format requires three asterisks *** before the hunk header. LetGood, 4 files created. Now I need";
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.(progress);
      input.onTextDelta?.(planning);
      return {
        content: progress + planning,
        toolCalls: [{ name: "workspace.apply_patch" }],
        webSearchCalls: [],
        citations: []
      };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: (text: string) => /the patch format|letgood|now i need/i.test(text),
    sanitizeVisibleContent: (content: string) => content.replace(/The patch format[\s\S]*/i, "").trim(),
    extractPlanningNarration: (content: string) => {
      const matched = content.match(/The patch format[\s\S]*/i);
      return matched?.[0] ?? "";
    }
  });
  const execution = baseExecution();
  await service.execute(execution.input);
  assert.deepEqual(execution.stream, [{ requestId: "request-1", delta: progress }]);
  assert.match(execution.reasoning.join(""), /patch format/i);
});

test("keeps accepted Chinese progress when the response also calls a tool", async () => {
  const progress = "已完成材料评估，正在等待您选择处理方式。";
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.(progress);
      return { content: progress, toolCalls: [{ name: "goal.request_user_input" }], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false
  });
  const execution = baseExecution();

  await service.execute(execution.input);

  assert.deepEqual(execution.stream, [{ requestId: "request-1", delta: progress }]);
});

test("recovers a Chinese greeting when flash-BD mixes English self-talk into the payload", async () => {
  const mixed = "Let me just respond very briefly and wait for actual instructions.\n\n你好！有什么需要帮忙的？";
  const service = new ModelChatStepService({
    callModel: async (input: { onTextDelta?: (delta: string) => void }) => {
      input.onTextDelta?.(mixed);
      return { content: mixed, toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: (text: string) => /let me|respond very briefly|i should/i.test(text),
    sanitizeVisibleContent: (content: string) => {
      const match = content.match(/你好[^\n]*/);
      return match?.[0] ?? "";
    },
    extractPlanningNarration: (content: string) => content.split(/\n{2,}/)[0] ?? ""
  });
  const execution = baseExecution();
  const result = await service.execute(execution.input);

  assert.equal(result.content, "你好！有什么需要帮忙的？");
  assert.ok(execution.stream.some((item) => item.delta.includes("你好")));
  assert.equal(execution.retries.length, 0);
});

test("caps empty-visible retries at one attempt instead of burning five backoffs", async () => {
  let calls = 0;
  const retryAttempts: number[] = [];
  const service = new ModelChatStepService({
    callModel: async () => {
      calls += 1;
      return {
        content: "I should respond very simply and wait for actual instructions.",
        toolCalls: [],
        webSearchCalls: [],
        citations: []
      };
    },
    isRetryableError: (error) => error instanceof Error
      && /did not include assistant content or tool calls/i.test(error.message),
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => true,
    sanitizeVisibleContent: () => "",
    extractPlanningNarration: (content: string) => content,
    delay: async () => undefined
  });
  const execution = baseExecution({
    publishRetry: (_requestId: string, attempt: number) => { retryAttempts.push(attempt); }
  });

  await assert.rejects(service.execute(execution.input), /did not include assistant content/);
  assert.equal(calls, 2);
  assert.deepEqual(retryAttempts, [1]);
});

test("switches to Auto fallback model after an abnormal empty step", async () => {
  const models: string[] = [];
  const fallbacks: Array<{ from: string; to: string; fallbackIndex: number }> = [];
  const service = new ModelChatStepService({
    callModel: async (input: { model?: string }) => {
      models.push(String(input.model || ""));
      if (input.model === "primary-model") {
        return {
          content: "I should answer briefly in Chinese.",
          toolCalls: [],
          webSearchCalls: [],
          citations: []
        };
      }
      return { content: "你好，已切换备用模型。", toolCalls: [], webSearchCalls: [], citations: [] };
    },
    isRetryableError: (error) => error instanceof Error
      && /did not include assistant content or tool calls/i.test(error.message),
    readUsageTokens: () => 0,
    containsPrivatePlanning: (text) => /I should answer/i.test(text),
    delay: async () => undefined
  });
  const modelInput = { requestId: "request-1", model: "primary-model" };
  const modelFallback = {
    enabled: true,
    selected: "primary-model",
    fallback_chain: ["backup-model"],
    fallback_index: 0,
    onFallback: (info: { from: string; to: string; fallbackIndex: number }) => {
      fallbacks.push(info);
    }
  };
  const execution = baseExecution({
    modelInput,
    modelFallback
  });
  const result = await service.execute(execution.input);

  assert.equal(result.content, "你好，已切换备用模型。");
  assert.deepEqual(models, ["primary-model", "primary-model", "backup-model"]);
  assert.equal(modelInput.model, "backup-model");
  assert.equal(modelFallback.fallback_index, 1);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0]?.from, "primary-model");
  assert.equal(fallbacks[0]?.to, "backup-model");
  assert.equal(fallbacks[0]?.fallbackIndex, 1);
  assert.ok(execution.reasoning.some((line) => /切换到备用模型 backup-model/.test(line)));
});

test("does not switch models on auth failures even when a fallback chain exists", async () => {
  let calls = 0;
  const service = new ModelChatStepService({
    callModel: async () => {
      calls += 1;
      throw new Error("HTTP 401 unauthorized");
    },
    isRetryableError: () => false,
    readUsageTokens: () => 0,
    containsPrivatePlanning: () => false,
    delay: async () => undefined
  });
  const execution = baseExecution({
    modelInput: { requestId: "request-1", model: "primary-model" },
    modelFallback: {
      enabled: true,
      selected: "primary-model",
      fallback_chain: ["backup-model"],
      fallback_index: 0
    }
  });

  await assert.rejects(service.execute(execution.input), /HTTP 401/);
  assert.equal(calls, 1);
});
