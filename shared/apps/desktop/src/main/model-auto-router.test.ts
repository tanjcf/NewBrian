import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ModelRoutingProfile } from "@codex-forge/protocol";

const { GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED } = await import(
  new URL("../shared/product-flags.ts", import.meta.url).href
);

const {
  MODEL_AUTO_ID,
  AUTO_NO_CONSTRAINT_MATCH_MESSAGE,
  AUTO_NO_ROUTING_POOL_MESSAGE,
  PINNED_MODEL_MISSING_MESSAGE,
  advanceAutoModelFallback,
  classifyAutoTaskClass,
  filterAutoRoutingPool,
  isAbnormalModelStepError,
  isAutoModelFallbackBlocked,
  isAutoModelFallbackEnabled,
  isModelAutoSelection,
  isVisionCapableModel,
  isVideoCapableModel,
  isImageGenerationCapableModel,
  isMusicCapableModel,
  is3dCapableModel,
  isSpecializedNonChatModel,
  looksLikeImageGenerationRequest,
  looksLikeMediaCapabilityQuestion,
  looksLikeMusicGenerationRequest,
  messagesHaveImageAttachments,
  latestUserMessageHasImageAttachments,
  looksLikeInterruptedTurnContinuation,
  priorUserMessageHasImageAttachments,
  turnRequiresVisionRouting,
  resolveModelAutoDecision,
  routingTierForTaskClass
} = await import(new URL("./model-auto-router.ts", import.meta.url).href);

test("distinguishes a media capability question from a generation command", () => {
  assert.equal(looksLikeMediaCapabilityQuestion("你会生成图片吗"), true);
  assert.equal(looksLikeImageGenerationRequest("你会生成图片吗"), false);
  assert.equal(looksLikeImageGenerationRequest("帮我生成一张青石谷入口图片"), true);
});

const { parseAuthorizedModelPayload } = await import(
  new URL("./authorized-model-catalog.ts", import.meta.url).href
);

function routing(partial: Partial<ModelRoutingProfile> & Pick<ModelRoutingProfile, "tier" | "cost_weight" | "quality_weight">): ModelRoutingProfile {
  return {
    schema_version: 1,
    status: "active",
    roles: ["chat", "code"],
    capabilities: ["tools"],
    ...partial
  };
}

const availableModels = [
  {
    id: "1",
    model: "deepseek-v4-flash",
    label: "flash",
    provider: "DeepSeek",
    capabilities: ["tools"],
    routing: routing({
      tier: 1,
      cost_weight: 10,
      quality_weight: 55,
      quality_by_task: { chat: 70, code: 40, gov_write: 30, research: 35, general: 50 },
      roles: ["chat", "code"]
    })
  },
  {
    id: "1b",
    model: "deepseek-v4-flash-BD",
    label: "flash-bd",
    provider: "DeepSeek",
    capabilities: ["tools"],
    routing: routing({
      tier: 1,
      cost_weight: 12,
      quality_weight: 50,
      quality_by_task: { chat: 60, code: 35, general: 45 },
      roles: ["chat"]
    })
  },
  {
    id: "2",
    model: "deepseek-v4-pro",
    label: "pro",
    provider: "DeepSeek",
    capabilities: ["tools", "long_context"],
    routing: routing({
      tier: 2,
      cost_weight: 40,
      quality_weight: 80,
      quality_by_task: { chat: 60, code: 85, gov_write: 75, research: 78, general: 80 },
      roles: ["chat", "code", "gov", "research"],
      capabilities: ["tools", "long_context"]
    })
  },
  {
    id: "3",
    model: "frontier-strong",
    label: "strong",
    provider: "Gateway",
    capabilities: ["tools", "long_context"],
    routing: routing({
      tier: 3,
      cost_weight: 90,
      quality_weight: 95,
      quality_by_task: { chat: 70, code: 95, gov_write: 92, research: 94, general: 93 },
      roles: ["chat", "code", "gov", "research", "review"],
      capabilities: ["tools", "long_context"]
    })
  }
];

const availableWithVision = [
  ...availableModels,
  {
    id: "4",
    model: "qwen3-vl-plus",
    label: "qwen-vl",
    provider: "DashScope",
    capabilities: ["vision", "multimodal", "tools"],
    routing: routing({
      tier: 2,
      cost_weight: 45,
      quality_weight: 82,
      roles: ["chat", "code", "vision"],
      capabilities: ["vision", "multimodal", "tools"]
    })
  }
];

test("isModelAutoSelection recognizes auto case-insensitively", () => {
  assert.equal(isModelAutoSelection("Auto"), true);
  assert.equal(isModelAutoSelection("auto"), true);
  assert.equal(isModelAutoSelection("deepseek-v4-pro"), false);
});

test("classifyAutoTaskClass prefers government skills and keywords when product is enabled", () => {
  if (GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) {
    assert.equal(classifyAutoTaskClass({ selectedSkillNames: ["government-research-writing"] }), "gov_write");
    assert.equal(classifyAutoTaskClass({ text: "请写一份政务调研报告" }), "gov_write");
  } else {
    assert.equal(classifyAutoTaskClass({ selectedSkillNames: ["government-research-writing"] }), "chat");
    assert.equal(classifyAutoTaskClass({ text: "请写一份政务调研报告" }), "research");
  }
  assert.equal(classifyAutoTaskClass({ text: "修复 typescript 编译报错" }), "code");
  assert.equal(classifyAutoTaskClass({ text: "你好" }), "chat");
  assert.equal(routingTierForTaskClass("chat"), "light");
  assert.equal(routingTierForTaskClass("code"), "heavy");
});

test("C1 Auto greetings are handled by main-agent direct path", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels,
    latestUserText: "你好",
    selectedSkillNames: [],
    permissionMode: "agent",
    reasoningEffort: "medium",
    runId: "run-hello",
    threadId: "thread-1",
    defaultModel: "deepseek-v4-flash",
    optimizeFor: "balanced",
    nowIso: () => "2026-08-05T00:00:00.000Z"
  });

  assert.equal(decision.mode, "auto");
  assert.equal(decision.task_class, "chat");
  assert.equal(decision.model.selected, "deepseek-v4-flash");
  assert.equal(decision.allow_auto_delegate, false);
  assert.equal(decision.orchestrator?.handled_by, "main");
  assert.equal(decision.orchestrator?.can_handle_directly, true);
  assert.ok(decision.model.reason_codes.includes("greeting_direct"));
  assert.ok(decision.model.reason_codes.includes("main_agent_model"));
  assert.ok(decision.model.reason_codes.includes("subscription_authorized"));
  assert.equal(decision.degraded, false);
});

test("C1c Auto code tasks prefer light orchestrator model with delegate-first routing", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels,
    latestUserText: "修复整个项目的 TypeScript 编译错误并补测试",
    selectedSkillNames: [],
    permissionMode: "agent",
    reasoningEffort: "medium",
    runId: "run-code-delegate",
    threadId: "thread-1",
    optimizeFor: "balanced",
    nowIso: () => "2026-08-05T00:00:00.000Z"
  });

  assert.equal(decision.task_class, "code");
  assert.equal(decision.model.selected, "deepseek-v4-flash");
  assert.ok(decision.model.reason_codes.includes("auto_orchestrator_delegate_first"));
  assert.ok(decision.model.reason_codes.includes("prefer_flash_for_orchestrator"));
  assert.equal(decision.orchestrator?.handled_by, "router");
});

test("C1b Auto default agent outside subscription cannot use main-direct path", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: [
      {
        id: "1",
        model: "allowed-only",
        label: "allowed",
        provider: "g",
        routing: {
          schema_version: 1,
          status: "active",
          tier: 1,
          cost_weight: 10,
          quality_weight: 50,
          roles: ["chat", "code"],
          capabilities: ["tools"]
        }
      }
    ],
    latestUserText: "你好",
    runId: "run-unsub-default",
    threadId: "thread-1",
    defaultModel: "deepseek-v4-flash"
  });
  assert.equal(decision.model.selected, "allowed-only");
  assert.notEqual(decision.model.selected, "deepseek-v4-flash");
  assert.ok(decision.model.reason_codes.includes("default_agent_not_in_subscription"));
  assert.ok(decision.model.reason_codes.includes("skip_unsubscribed_default_agent"));
  assert.ok(decision.model.reason_codes.includes("subscription_authorized"));
  assert.notEqual(decision.orchestrator?.handled_by, "main");
});

test("C2 pinned model uses exact selection with empty fallback", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: "deepseek-v4-pro",
    availableModels,
    latestUserText: "随便聊聊",
    runId: "run-pin",
    threadId: "thread-1"
  });
  assert.equal(decision.mode, "manual");
  assert.equal(decision.model.requested, "deepseek-v4-pro");
  assert.equal(decision.model.selected, "deepseek-v4-pro");
  assert.deepEqual(decision.model.fallback_chain, []);
  assert.equal(isAutoModelFallbackEnabled(decision), false);
});

test("C5 pinned model warns when skill needs higher tier but keeps pin", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: "deepseek-v4-flash",
    availableModels,
    selectedSkillNames: ["government-research-writing"],
    latestUserText: "写调研",
    runId: "run-warn",
    threadId: "thread-1"
  });
  assert.equal(decision.model.selected, "deepseek-v4-flash");
  assert.ok((decision.warnings?.length ?? 0) > 0 || /不满足|tier/i.test(decision.notes || ""));
});

test("C6 pinned missing model is blocked", () => {
  assert.throws(
    () => resolveModelAutoDecision({
      requestedModel: "not-in-catalog",
      availableModels,
      runId: "run-missing",
      threadId: "thread-1"
    }),
    new RegExp(PINNED_MODEL_MISSING_MESSAGE)
  );
});

test("C7 greeting with no active routing pool still uses main-agent direct path", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: [
      { id: "x", model: "only-probing", label: "p", provider: "g", routing: routing({ status: "probing", tier: 1, cost_weight: 1, quality_weight: 1 }) }
    ],
    latestUserText: "你好",
    runId: "run-empty",
    threadId: "thread-1"
  });
  assert.equal(decision.model.selected, "only-probing");
  assert.equal(decision.degraded, false);
  assert.equal(decision.orchestrator?.handled_by, "main");
  assert.ok(decision.model.reason_codes.includes("greeting_direct"));
});

test("C7c non-chat Auto with no active routing pool degrades to an authorized model", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: [
      { id: "x", model: "only-probing", label: "p", provider: "g", routing: routing({ status: "probing", tier: 1, cost_weight: 1, quality_weight: 1 }) }
    ],
    latestUserText: "请详细分析一下当前市场趋势、竞争格局与用户需求变化，并给出至少五点可执行建议以及风险提示说明",
    runId: "run-empty-general",
    threadId: "thread-1"
  });
  assert.equal(decision.model.selected, "only-probing");
  assert.equal(decision.degraded, true);
  assert.ok(decision.model.reason_codes.includes("routing_pool_empty"));
  assert.ok(decision.model.reason_codes.includes("degraded_first_available"));
  assert.match(String(decision.notes || ""), new RegExp(AUTO_NO_ROUTING_POOL_MESSAGE));
});

test("C7b Auto with no authorized models remains blocked", () => {
  assert.throws(
    () => resolveModelAutoDecision({
      requestedModel: MODEL_AUTO_ID,
      availableModels: [],
      latestUserText: "你好",
      runId: "run-none",
      threadId: "thread-1"
    }),
    /no authorized models/i
  );
});

test("C8 Auto with unsatisfiable skill constraints is blocked", () => {
  assert.throws(
    () => resolveModelAutoDecision({
      requestedModel: MODEL_AUTO_ID,
      availableModels: [
        {
          id: "1",
          model: "chat-only",
          label: "c",
          provider: "g",
          routing: routing({
            tier: 1,
            cost_weight: 1,
            quality_weight: 50,
            roles: ["chat"],
            capabilities: ["tools"]
          })
        }
      ],
      selectedSkillNames: ["government-research-writing"],
      latestUserText: "政务写作",
      runId: "run-unsat",
      threadId: "thread-1"
    }),
    new RegExp(AUTO_NO_CONSTRAINT_MATCH_MESSAGE)
  );
});

test("C9 manual mode never enables fallback cascade", () => {
  assert.equal(isAutoModelFallbackEnabled({
    mode: "manual",
    model: { requested: "deepseek-v4-pro", fallback_chain: ["frontier-strong"] }
  }), false);
});

test("C10 Auto enables cascade when fallback chain exists", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels,
    latestUserText: "修复 typescript 编译报错并重构模块",
    optimizeFor: "intelligence",
    runId: "run-code",
    threadId: "thread-1"
  });
  assert.equal(decision.mode, "auto");
  assert.ok(decision.model.fallback_chain.length >= 1 || decision.model.selected === "frontier-strong");
  assert.equal(isAutoModelFallbackEnabled(decision), decision.model.fallback_chain.length > 0);
  assert.ok(isAbnormalModelStepError(new Error("HTTP 503")));
  assert.ok(isAutoModelFallbackBlocked(new Error("HTTP 401 unauthorized")));
});

test("Optimize cost prefers cheaper eligible model than intelligence", () => {
  const cost = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels,
    latestUserText: "帮我看一下这段代码的结构",
    optimizeFor: "cost",
    runId: "run-cost",
    threadId: "thread-1"
  });
  const intel = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels,
    latestUserText: "帮我看一下这段代码的结构",
    optimizeFor: "intelligence",
    runId: "run-intel",
    threadId: "thread-1"
  });
  assert.equal(cost.optimize_for, "cost");
  assert.equal(intel.optimize_for, "intelligence");
  const costModel = availableModels.find((item) => item.model === cost.model.selected)!;
  const intelModel = availableModels.find((item) => item.model === intel.model.selected)!;
  assert.ok((costModel.routing?.cost_weight ?? 0) <= (intelModel.routing?.cost_weight ?? 0)
    || cost.model.selected !== intel.model.selected);
});

test("Auto with images prefers vision-capable active model", () => {
  assert.equal(messagesHaveImageAttachments([
    { attachments: [{ name: "docker.png", path: "C:/tmp/docker.png", url: "data:image/png;base64,abc" }] }
  ]), true);
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: availableWithVision,
    latestUserText: "帮我用 Docker 启动这个项目",
    hasImageAttachments: true,
    runId: "run-image",
    threadId: "thread-1"
  });
  assert.ok(isVisionCapableModel(availableWithVision.find((item) => item.model === decision.model.selected)!));
  assert.ok(decision.model.reason_codes.includes("requires_vision"));
});

test("latestUserMessageHasImageAttachments ignores older turns", () => {
  assert.equal(latestUserMessageHasImageAttachments([
    {
      role: "user",
      attachments: [{ name: "old.png", path: "C:/tmp/old.png", url: "data:image/png;base64,abc" }]
    },
    { role: "assistant", content: "已看过图" },
    { role: "user", content: "继续写第二章" }
  ]), false);
  assert.equal(latestUserMessageHasImageAttachments([
    { role: "user", content: "先看图", attachments: [{ name: "a.png", path: "a.png" }] },
    { role: "assistant", content: "ok" },
    {
      role: "user",
      content: "这张呢",
      attachments: [{ name: "b.png", path: "C:/tmp/b.png", url: "data:image/png;base64,abc" }]
    }
  ]), true);
});

test("interrupt resume after an image turn still requires vision routing", () => {
  assert.equal(looksLikeInterruptedTurnContinuation("从上次异常中断的位置继续执行，不要重复已完成的内容。"), true);
  assert.equal(looksLikeInterruptedTurnContinuation("继续写第二章"), false);
  const interruptedImageThread = [
    {
      role: "user",
      content: "这几处树枝缺少了树叶",
      attachments: [{ name: "tree.png", path: "C:/tmp/tree.png", url: "data:image/png;base64,abc" }]
    },
    { role: "assistant", content: "本轮在完成前发生异常：This operation was aborted" },
    { role: "user", content: "从上次异常中断的位置继续执行，不要重复已完成的内容。" }
  ];
  assert.equal(priorUserMessageHasImageAttachments(interruptedImageThread), true);
  assert.equal(latestUserMessageHasImageAttachments(interruptedImageThread), false);
  assert.equal(turnRequiresVisionRouting(interruptedImageThread), true);
  assert.equal(turnRequiresVisionRouting([
    {
      role: "user",
      attachments: [{ name: "old.png", path: "C:/tmp/old.png", url: "data:image/png;base64,abc" }]
    },
    { role: "assistant", content: "已看过图" },
    { role: "user", content: "继续写第二章" }
  ]), false);
});

test("Auto with images keeps text model when no vision eligible (bridge)", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels,
    latestUserText: "看这张图",
    hasImageAttachments: true,
    runId: "run-no-vision",
    threadId: "thread-1"
  });
  assert.ok(decision.model.reason_codes.includes("vision_unavailable_use_bridge"));
  assert.ok(filterAutoRoutingPool(availableModels).some((item) => item.model === decision.model.selected));
});

test("kimi-k2.6 is treated as vision-capable by name", () => {
  assert.equal(isVisionCapableModel({
    model: "kimi-k2.6-BD",
    label: "kimi-k2.6-BD",
    provider: "百度智能云千帆"
  }), true);
  assert.equal(isVisionCapableModel({
    model: "deepseek-v4-flash-BD",
    label: "deepseek-v4-flash-BD",
    provider: "百度智能云千帆"
  }), false);
  assert.equal(isVisionCapableModel({
    model: "ernie-5.1",
    label: "ernie-5.1",
    provider: "百度智能云千帆"
  }), false);
});

test("degraded Auto with images prefers kimi over deepseek flash", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: [
      { model: "deepseek-v4-flash-BD", label: "deepseek-v4-flash-BD", provider: "百度" },
      { model: "kimi-k2.6-BD", label: "kimi-k2.6-BD", provider: "百度" },
      { model: "ernie-5.1", label: "ernie-5.1", provider: "百度" }
    ],
    latestUserText: "每章节就这么几句话?",
    hasImageAttachments: true,
    runId: "run-degraded-vision",
    threadId: "thread-1"
  });
  assert.equal(decision.model.selected, "kimi-k2.6-BD");
  assert.ok(decision.model.reason_codes.includes("requires_vision"));
  assert.ok(
    decision.model.reason_codes.includes("routing_pool_empty")
    || decision.model.reason_codes.includes("quality_first_cost_secondary")
    || decision.model.reason_codes.includes("vision_capable")
  );
});

test("video ask is not chat and does not pick kimi vision", () => {
  assert.equal(classifyAutoTaskClass({ text: "能帮做出视频吗" }), "general");
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: [
      { model: "deepseek-v4-flash-BD", label: "deepseek-v4-flash-BD", provider: "百度" },
      { model: "deepseek-v4-pro-BD", label: "deepseek-v4-pro-BD", provider: "百度" },
      { model: "kimi-k2.6-BD", label: "kimi-k2.6-BD", provider: "百度" }
    ],
    latestUserText: "能帮做出视频吗",
    hasImageAttachments: true,
    runId: "run-video-not-kimi",
    threadId: "thread-1"
  });
  assert.equal(decision.task_class, "general");
  assert.notEqual(decision.model.selected, "kimi-k2.6-BD");
  assert.equal(decision.model.selected, "deepseek-v4-pro-BD");
  assert.ok(
    decision.model.reason_codes.includes("video_model_unavailable_use_tools")
    || decision.model.reason_codes.includes("prefer_pro_for_heavy_task")
    || decision.model.reason_codes.includes("needs_video_gen_channel")
  );
  assert.ok(!decision.model.reason_codes.includes("requires_vision"));
});

test("video ask prefers seedance when present in subscription", () => {
  assert.equal(isVideoCapableModel({
    model: "doubao-seedance-1-0-pro",
    label: "seedance",
    provider: "火山",
    capabilities: ["video", "t2v"]
  }), true);
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: [
      { model: "deepseek-v4-pro-BD", label: "deepseek-v4-pro-BD", provider: "百度" },
      { model: "kimi-k2.6-BD", label: "kimi-k2.6-BD", provider: "百度" },
      {
        model: "doubao-seedance-1-0-pro",
        label: "seedance",
        provider: "火山",
        capabilities: ["video", "t2v"]
      }
    ],
    latestUserText: "帮我生成视频",
    runId: "run-video-seedance",
    threadId: "thread-1"
  });
  assert.equal(decision.model.selected, "doubao-seedance-1-0-pro");
  assert.ok(decision.model.reason_codes.includes("video_capable") || decision.model.reason_codes.includes("requires_video"));
});

test("Auto synthesizes economics and prefers pro for heavy delivery", () => {
  const pool = [
    { model: "deepseek-v4-flash", label: "flash", provider: "DeepSeek" },
    { model: "deepseek-v4-pro", label: "pro", provider: "DeepSeek" }
  ];
  const light = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: pool,
    latestUserText: "你好",
    runId: "run-light",
    threadId: "thread-1"
  });
  assert.equal(light.model.selected, "deepseek-v4-flash");
  const heavy = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: pool,
    latestUserText: "请完成并提交第二章的完整正文，输出 DOCX 文档",
    runId: "run-heavy",
    threadId: "thread-1"
  });
  assert.equal(heavy.model.selected, "deepseek-v4-pro");
  assert.ok(heavy.model.reason_codes.includes("prefer_pro_for_heavy_task"));
  assert.ok(heavy.model.reason_codes.includes("quality_first_cost_secondary"));
  assert.equal(classifyAutoTaskClass({ text: "请完成并提交第二章的完整正文，输出 DOCX 文档" }), "general");
});

test("government skill on Auto selects gov-capable higher tier", () => {
  if (!GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) return;

  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels,
    selectedSkillNames: ["government-research-writing"],
    latestUserText: "请写一份政务调研报告",
    optimizeFor: "balanced",
    runId: "run-gov",
    threadId: "thread-1"
  });
  assert.equal(decision.task_class, "gov_write");
  assert.notEqual(decision.model.selected, "deepseek-v4-flash");
  assert.ok(["deepseek-v4-pro", "frontier-strong"].includes(decision.model.selected));
});

test("advanceAutoModelFallback walks the chain", () => {
  const first = advanceAutoModelFallback({
    selected: "a",
    fallback_chain: ["b", "c"],
    fallback_index: 0
  });
  assert.deepEqual(first, { model: "b", fallback_index: 1 });
});

test("fixture models-with-routing parses active Auto pool", async () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(await readFile(join(dir, "fixtures/models-with-routing.json"), "utf8")) as unknown[];
  const parsed = parseAuthorizedModelPayload(raw);
  const autoPool = filterAutoRoutingPool(parsed);
  assert.ok(autoPool.length >= 3);
  assert.ok(autoPool.every((item) => item.routing?.status === "active"));
  assert.ok(parsed.some((item) => item.routing?.status === "probing"));
});

test("TokenHub specialty models are classified for Auto pools", () => {
  assert.equal(isVideoCapableModel({
    model: "pixverse-video-v6.0",
    provider: "TokenHub",
    capabilities: ["video", "pixverse"]
  }), true);
  assert.equal(isVideoCapableModel({
    model: "minimax-video-h3",
    provider: "TokenHub",
    label: "MiniMax H3"
  }), true);
  assert.equal(isVisionCapableModel({
    model: "youtu-vita",
    provider: "TokenHub",
    capabilities: ["vision", "multimodal"]
  }), true);
  assert.equal(isMusicCapableModel({
    model: "minimax-music-v2.6",
    provider: "TokenHub",
    capabilities: ["music"]
  }), true);
  assert.equal(is3dCapableModel({
    model: "hy-3d-3.1",
    provider: "TokenHub",
    capabilities: ["3d"]
  }), true);
  assert.equal(isVideoCapableModel({
    model: "hy-3d-3.1",
    provider: "TokenHub",
    capabilities: ["3d"]
  }), false);
  assert.equal(isVideoCapableModel({
    model: "kling-video-v3",
    provider: "TokenHub",
    capabilities: ["video", "text-to-video", "kling"]
  }), true);
  assert.equal(isImageGenerationCapableModel({
    model: "hy-image-v3",
    provider: "腾讯混元",
    capabilities: ["image", "image-generation", "text-to-image"]
  }), true);
  assert.equal(isImageGenerationCapableModel({
    model: "minimax-m3",
    provider: "TokenHub",
    capabilities: ["chat", "text", "vision", "video-understanding", "multimodal", "tools"]
  }), false);
  assert.equal(isVisionCapableModel({
    model: "hy-image-v3",
    provider: "腾讯混元",
    capabilities: ["image", "image-generation"]
  }), false);
  assert.equal(isSpecializedNonChatModel({
    model: "hy-image-v3",
    provider: "TokenHub",
    capabilities: ["image-generation"]
  }), true);
  assert.equal(looksLikeMusicGenerationRequest("帮我生成一首歌"), true);
});

test("Auto prefers hy-image-v3 for text-to-image asks", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: [
      {
        model: "deepseek-v4-flash",
        label: "flash",
        provider: "百度",
        routing: routing({ tier: 1, cost_weight: 1, quality_weight: 40 })
      },
      {
        model: "hy-image-v3",
        label: "混元生图",
        provider: "腾讯混元",
        capabilities: ["image", "image-generation", "text-to-image"],
        routing: routing({
          tier: 2,
          cost_weight: 40,
          quality_weight: 70,
          roles: ["image_gen"],
          capabilities: ["image-generation"]
        })
      }
    ],
    latestUserText: "画一只橙色小猫在窗台上看向镜头",
    runId: "run-image",
    threadId: "thread-image"
  });
  assert.equal(decision.model.selected, "hy-image-v3");
  assert.ok(decision.model.reason_codes.includes("requires_image"));
});

test("Auto prefers TokenHub video model for pixverse-style asks", () => {
  const decision = resolveModelAutoDecision({
    requestedModel: MODEL_AUTO_ID,
    availableModels: [
      {
        model: "deepseek-v4-pro",
        label: "pro",
        provider: "百度",
        routing: routing({ tier: 2, cost_weight: 4, quality_weight: 8 })
      },
      {
        model: "pixverse-video-v6.0",
        label: "PixVerse",
        provider: "TokenHub",
        capabilities: ["video", "text-to-video"],
        routing: routing({
          tier: 2,
          cost_weight: 6,
          quality_weight: 7,
          roles: ["video"],
          capabilities: ["video", "text-to-video"]
        })
      }
    ],
    latestUserText: "用 pixverse 生成一段城市夜景视频",
    runId: "run-pixverse",
    threadId: "thread-1"
  });
  assert.equal(decision.model.selected, "pixverse-video-v6.0");
  assert.ok(decision.model.reason_codes.includes("requires_video"));
});
