import assert from "node:assert/strict";
import test from "node:test";
import type { ModelChatInput, ModelRoutingProfile } from "@codex-forge/protocol";

const { ModelChatPreparationService } = await import(
  new URL("./model-chat-preparation-service.ts", import.meta.url).href
);
const {
  PINNED_MODEL_MISSING_MESSAGE,
  isAutoModelFallbackEnabled
} = await import(new URL("./model-auto-router.ts", import.meta.url).href);

function routing(
  partial: Partial<ModelRoutingProfile> & Pick<ModelRoutingProfile, "tier" | "cost_weight" | "quality_weight">
): ModelRoutingProfile {
  return {
    schema_version: 1,
    status: "active",
    roles: ["chat", "code", "gov", "research"],
    capabilities: ["tools"],
    ...partial
  };
}

const catalogModels = [
  {
    id: "1",
    provider: "gateway",
    model: "allowed",
    label: "allowed",
    routing: routing({
      tier: 1,
      cost_weight: 10,
      quality_weight: 60,
      quality_by_task: { chat: 70, code: 50, gov_write: 40, research: 45, general: 55 },
      roles: ["chat", "code", "gov", "research"]
    })
  },
  {
    id: "2",
    provider: "gateway",
    model: "review",
    label: "review",
    routing: routing({
      tier: 2,
      cost_weight: 40,
      quality_weight: 40,
      quality_by_task: { chat: 30, code: 40, gov_write: 20, research: 20, general: 30 },
      roles: ["review"],
      capabilities: ["tools"]
    })
  },
  {
    id: "3",
    provider: "gateway",
    model: "pro-model",
    label: "pro",
    routing: routing({
      tier: 2,
      cost_weight: 45,
      quality_weight: 85,
      quality_by_task: { chat: 60, code: 88, gov_write: 80, research: 82, general: 80 },
      roles: ["chat", "code", "gov", "research"],
      capabilities: ["tools", "long_context"]
    })
  }
];

const input = {
  requestId: "request-1",
  workspaceId: " workspace-1 ",
  threadId: " thread-1 ",
  provider: "untrusted",
  wireApi: "chat",
  model: "ALLOWED",
  reviewModel: "REVIEW"
} as unknown as ModelChatInput;

function createService(overrides: Record<string, unknown> = {}) {
  const base = {
    isRequestActive: () => false,
    isThreadActive: () => false,
    readCatalog: async () => ({
      workspaces: [{ id: "workspace-1", threads: [{ id: "thread-1" }] }]
    }),
    readAuthorizedModelConfig: async () => ({
      availableModels: catalogModels,
      optimizeFor: "balanced"
    }),
    resolveServerAutoRoute: async (input: {
      latestUserText: string;
      optimizeFor: string;
      hasImageAttachments: boolean;
    }) => {
      const authorized = await (overrides.readAuthorizedModelConfig as undefined | (() => Promise<{
        availableModels?: typeof catalogModels;
        optimizeFor?: string;
      }>) ?? base.readAuthorizedModelConfig)();
      const models = authorized.availableModels ?? catalogModels;
      const text = String(input.latestUserText || "");
      const vision = models.find((item) =>
        (item.capabilities ?? []).some((tag) => /vision|multimodal/i.test(tag))
        || /vision|vl/i.test(item.model)
      );
      if (/壁纸|出图|生成图片|桌面壁纸|wallpaper/i.test(text)) {
        const chat = models.find((item) =>
          !/hy-image|image-gen|seedance|ocr/i.test(item.model)
          && !(item.capabilities ?? []).some((tag) => /image-generation|text-to-image|video|ocr/i.test(tag))
        ) ?? models[0];
        return {
          schema_version: 1 as const,
          model: chat.model,
          channel: "text_chat",
          task_class: "general",
          optimize_for: "intelligence",
          degraded: false,
          reason_codes: ["hint_image_request", "media_via_tool_calls", "server_authoritative_auto"],
          selected_reason: "text_chat",
          parent_role: "orchestrator",
          child_specialty: "",
          fallback_models: [],
          available_media_tools: ["image_generate", "video_generate"]
        };
      }
      if (input.hasImageAttachments && vision) {
        return {
          schema_version: 1 as const,
          model: vision.model,
          channel: "vision_qa",
          task_class: "general",
          optimize_for: input.optimizeFor || "balanced",
          degraded: false,
          reason_codes: ["requires_vision", "vision_capable", "server_authoritative_auto"],
          selected_reason: "vision",
          parent_role: "orchestrator",
          child_specialty: "",
          fallback_models: []
        };
      }
      if (input.hasImageAttachments && !vision) {
        const flash = models[0];
        return {
          schema_version: 1 as const,
          model: flash.model,
          channel: "text_chat",
          task_class: "chat",
          optimize_for: input.optimizeFor || "balanced",
          degraded: true,
          reason_codes: ["vision_unavailable_use_bridge", "server_authoritative_auto"],
          selected_reason: "bridge",
          parent_role: "orchestrator",
          child_specialty: "",
          fallback_models: []
        };
      }
      if (/政务|调研报告/.test(text)) {
        const pro = models.find((item) => /pro/i.test(item.model)) ?? models[0];
        return {
          schema_version: 1 as const,
          model: pro.model,
          channel: "tools",
          task_class: "gov_write",
          optimize_for: authorized.optimizeFor || input.optimizeFor || "balanced",
          degraded: false,
          reason_codes: ["task_class=gov_write", "server_authoritative_auto"],
          selected_reason: "gov",
          parent_role: "orchestrator",
          child_specialty: "",
          fallback_models: []
        };
      }
      if (/typescript|报错|修复/.test(text)) {
        const pro = models.find((item) => /pro/i.test(item.model)) ?? models[0];
        return {
          schema_version: 1 as const,
          model: pro.model,
          channel: "coding",
          task_class: "code",
          optimize_for: input.optimizeFor || "balanced",
          degraded: false,
          reason_codes: ["task_class=code", "server_authoritative_auto"],
          selected_reason: "code",
          parent_role: "orchestrator",
          child_specialty: "",
          fallback_models: []
        };
      }
      const pick = models.find((item) => /flash|allowed/i.test(item.model)) ?? models[0];
      return {
        schema_version: 1 as const,
        model: pick.model,
        channel: "text_chat",
        task_class: "chat",
        optimize_for: authorized.optimizeFor || input.optimizeFor || "balanced",
        degraded: false,
        reason_codes: ["greeting_direct", "server_authoritative_auto"],
        selected_reason: "chat",
        parent_role: "orchestrator",
        child_specialty: "",
        fallback_models: []
      };
    }
  };
  return new ModelChatPreparationService({
    ...base,
    ...overrides
  } as never);
}

test("binds a request to an existing thread and canonical authorized models", async () => {
  const prepared = await createService().prepare(input);
  assert.equal(prepared.workspace.id, "workspace-1");
  assert.equal(prepared.thread.id, "thread-1");
  assert.equal(prepared.input.provider, "gateway");
  assert.equal(prepared.input.wireApi, "responses");
  assert.equal(prepared.input.model, "allowed");
  assert.equal(prepared.input.reviewModel, "review");
  assert.equal(prepared.autoDecision?.mode, "manual");
  assert.deepEqual(prepared.autoDecision?.model.fallback_chain, []);
  assert.equal(isAutoModelFallbackEnabled(prepared.autoDecision), false);
});

test("C1 keeps Auto outbound as auto for server billing while recording local decision", async () => {
  const prepared = await createService().prepare({
    ...input,
    model: "auto",
    messages: [{ role: "user", content: "请写一份政务调研报告" }]
  } as never);
  assert.equal(prepared.input.model, "auto");
  assert.ok(["allowed", "pro-model"].includes(prepared.autoDecision?.model.selected || ""));
  assert.equal(prepared.autoDecision?.mode, "auto");
  assert.equal(prepared.autoDecision?.model.requested, "auto");
  assert.equal(prepared.autoDecision?.task_class, "gov_write");
  assert.equal(prepared.autoDecision?.optimize_for, "balanced");
});

test("C11 composer Auto ignores settings default pin for routing mode", async () => {
  const prepared = await createService({
    readAuthorizedModelConfig: async () => ({
      model: "allowed",
      availableModels: catalogModels,
      optimizeFor: "intelligence"
    })
  }).prepare({
    ...input,
    model: "auto",
    messages: [{ role: "user", content: "你好" }]
  } as never);
  assert.equal(prepared.autoDecision?.mode, "auto");
  assert.equal(prepared.input.model, "auto");
  assert.equal(prepared.input.optimizeFor, "intelligence");
});

test("C12 reviewModel stays independent from Auto selected model", async () => {
  const prepared = await createService().prepare({
    ...input,
    model: "auto",
    reviewModel: "review",
    messages: [{ role: "user", content: "修复 typescript 报错" }]
  } as never);
  assert.equal(prepared.input.reviewModel, "review");
  assert.equal(prepared.input.model, "auto");
});

test("Auto with image attachments prefers a vision-capable authorized model", async () => {
  const prepared = await createService({
    readAuthorizedModelConfig: async () => ({
      availableModels: [
        {
          id: "1",
          provider: "DeepSeek",
          model: "deepseek-v4-flash",
          label: "flash",
          routing: routing({
            tier: 1,
            cost_weight: 10,
            quality_weight: 50,
            roles: ["chat", "code"],
            capabilities: ["tools"]
          })
        },
        {
          id: "2",
          provider: "DashScope",
          model: "qwen3-vl-plus",
          label: "qwen-vl",
          capabilities: ["vision", "multimodal"],
          routing: routing({
            tier: 2,
            cost_weight: 40,
            quality_weight: 80,
            roles: ["chat", "vision"],
            capabilities: ["vision", "multimodal", "tools"]
          })
        }
      ]
    })
  }).prepare({
    ...input,
    model: "auto",
    messages: [{
      role: "user",
      content: "帮我用 Docker 启动这个项目",
      attachments: [{ name: "shot.png", path: "C:/tmp/shot.png", url: "data:image/png;base64,xx" }]
    }]
  } as never);
  // Vision-required Auto pins the vision parent so responses cannot re-pick text flash.
  assert.equal(prepared.input.model, "qwen3-vl-plus");
  assert.equal(prepared.autoDecision?.model.selected, "qwen3-vl-plus");
  assert.equal((prepared.input as { parentSelectedModel?: string }).parentSelectedModel, "qwen3-vl-plus");
  assert.equal(prepared.input.provider, "DashScope");
  assert.ok(prepared.autoDecision?.model.reason_codes.includes("requires_vision"));
});

test("Auto with images keeps a text model when no vision model is configured (bridge later)", async () => {
  const prepared = await createService({
    readAuthorizedModelConfig: async () => ({
      availableModels: [
        {
          id: "1",
          provider: "DeepSeek",
          model: "deepseek-v4-flash",
          label: "flash",
          routing: routing({
            tier: 1,
            cost_weight: 10,
            quality_weight: 55,
            roles: ["chat"],
            capabilities: ["tools"]
          })
        }
      ]
    })
  }).prepare({
    ...input,
    model: "auto",
    messages: [{
      role: "user",
      content: "看看这张图",
      attachments: [{ name: "a.png", path: "C:/a.png", url: "data:image/png;base64,a" }]
    }]
  } as never);
  assert.equal(prepared.input.model, "auto");
  assert.equal(prepared.autoDecision?.model.selected, "deepseek-v4-flash");
  assert.ok(prepared.autoDecision?.model.reason_codes.includes("vision_unavailable_use_bridge"));
});

test("C6/C7 reject missing pin and empty Auto routing pool", async () => {
  await assert.rejects(() => createService({ isRequestActive: () => true }).prepare(input), /already running/);
  await assert.rejects(() => createService({ isThreadActive: () => true }).prepare(input), /未结束的任务|running task/);
  let released = 0;
  const releasedPrep = await createService({
    isThreadActive: () => released === 0,
    releaseThreadTasks: () => {
      released += 1;
      return 1;
    }
  }).prepare(input);
  assert.equal(released, 1);
  assert.equal(releasedPrep.workspace.id, "workspace-1");
  await assert.rejects(() => createService({
    readAuthorizedModelConfig: async () => ({ availableModels: [] })
  }).prepare(input), /no authorized models|does not allow|授权/);
  await assert.rejects(() => createService().prepare({
    ...input,
    model: "ghost-model"
  } as never), new RegExp(PINNED_MODEL_MISSING_MESSAGE));
  const greeting = await createService({
    readAuthorizedModelConfig: async () => ({
      availableModels: [{
        id: "1",
        provider: "g",
        model: "probing-only",
        label: "p",
        routing: routing({ status: "probing", tier: 1, cost_weight: 1, quality_weight: 1 })
      }]
    })
  }).prepare({
    ...input,
    model: "auto",
    messages: [{ role: "user", content: "你好" }]
  } as never);
  assert.equal(greeting.input.model, "auto");
  assert.equal(greeting.autoDecision?.model.selected, "probing-only");
  assert.equal(greeting.autoDecision?.orchestrator?.handled_by, "router");
  assert.ok(greeting.autoDecision?.model.reason_codes.includes("server_authoritative_auto"));

  await assert.rejects(() => createService({
    readAuthorizedModelConfig: async () => ({
      availableModels: catalogModels
    }),
    resolveServerAutoRoute: async () => {
      throw new Error("当前套餐没有可用的文生图/出图模型（如 hy-image-v3）");
    }
  }).prepare({
    ...input,
    model: "auto",
    messages: [{ role: "user", content: "做一张卡通桌面壁纸" }]
  } as never), /文生图|hy-image/);
});

test("vision guard rewrites non-vision Auto selection and filters fallback chain", async () => {
  const { enforceVisionCapableAutoSelection } = await import(
    new URL("./model-chat-preparation-service.ts", import.meta.url).href
  );
  const guarded = enforceVisionCapableAutoSelection({
    hasImageAttachments: true,
    availableModels: [
      { model: "deepseek-v4-flash", provider: "deepseek", capabilities: ["text"] },
      { model: "deepseek-v4-flash-0731", provider: "deepseek", capabilities: ["text"] },
      { model: "kimi-k2.6", provider: "百度", capabilities: ["vision", "multimodal"] }
    ],
    decision: {
      schema_version: 1,
      mode: "auto",
      decided_at: new Date().toISOString(),
      run_id: "r-vision-guard",
      thread_id: "t1",
      input_fingerprint: "fp",
      model: {
        requested: "auto",
        selected: "deepseek-v4-flash",
        reason_codes: ["server_authoritative_auto", "channel=text_chat"],
        fallback_chain: ["deepseek-v4-flash-0731", "kimi-k2.6"],
        fallback_index: 0
      },
      reasoning: { effort: "auto", summary: "auto", resolved_effort: "medium" },
      skills: { explicit: [], automatic: [], government_enabled: false },
      permission_profile: "auto_review",
      allow_auto_delegate: true,
      policy_etag: "spring-app-auto",
      degraded: false,
      task_class: "chat",
      routing_tier: "general",
      orchestrator: {
        schema_version: 1,
        intent: "chat",
        handled_by: "router",
        can_handle_directly: true,
        primary_channel: "text_chat",
        reason_codes: ["server_authoritative_auto"]
      }
    }
  });
  assert.equal(guarded.model.selected, "kimi-k2.6");
  assert.deepEqual(guarded.model.fallback_chain, []);
  assert.ok(guarded.model.reason_codes.includes("local_vision_model_guard"));
  assert.equal(guarded.orchestrator?.primary_channel, "vision_qa");
});

test("interrupt-resume after image turn asks spring Auto with hasImageAttachments", async () => {
  let sawImageFlag = false;
  const service = createService({
    readAuthorizedModelConfig: async () => ({
      availableModels: [
        { model: "deepseek-v4-flash", provider: "deepseek", capabilities: ["text"] },
        { model: "kimi-k2.6", provider: "百度", capabilities: ["vision", "multimodal"] }
      ],
      optimizeFor: "balanced"
    }),
    resolveServerAutoRoute: async (input: {
      latestUserText: string;
      optimizeFor: string;
      hasImageAttachments: boolean;
    }) => {
      sawImageFlag = input.hasImageAttachments;
      return {
        schema_version: 1 as const,
        model: "deepseek-v4-flash",
        channel: "text_chat",
        task_class: "chat",
        optimize_for: "balanced",
        degraded: false,
        reason_codes: ["server_authoritative_auto"],
        selected_reason: "wrong_text",
        parent_role: "orchestrator",
        child_specialty: "",
        fallback_models: ["deepseek-v4-flash-0731"]
      };
    }
  });
  const prepared = await service.prepare({
    ...input,
    model: "auto",
    messages: [
      {
        role: "user",
        content: "这几处树枝缺少了树叶",
        attachments: [{ name: "tree.png", path: "C:/tmp/tree.png", url: "data:image/png;base64,abc" }]
      },
      { role: "assistant", content: "中断" },
      { role: "user", content: "从上次异常中断的位置继续执行，不要重复已完成的内容。" }
    ]
  } as never);
  assert.equal(sawImageFlag, true);
  assert.equal(prepared.autoDecision?.model.selected, "kimi-k2.6");
  assert.equal(prepared.input.model, "kimi-k2.6");
  assert.equal((prepared.input as { parentSelectedModel?: string }).parentSelectedModel, "kimi-k2.6");
});

test("local media override is removed; vision attachments stay vision_qa via server", async () => {
  const prepared = await createService({
    readAuthorizedModelConfig: async () => ({
      availableModels: [
        ...catalogModels,
        {
          id: "kimi",
          provider: "百度",
          model: "kimi-k2.6",
          label: "Kimi",
          capabilities: ["vision", "multimodal"],
          routing: routing({
            tier: 2,
            cost_weight: 40,
            quality_weight: 70,
            roles: ["chat", "vision"],
            capabilities: ["vision", "multimodal", "tools"]
          })
        }
      ]
    })
  }).prepare({
    ...input,
    model: "auto",
    messages: [{
      role: "user",
      content: "脸长后脑勺上？",
      attachments: [{ url: "data:image/png;base64,abc" }]
    }]
  } as never);
  assert.equal(prepared.autoDecision?.orchestrator?.primary_channel, "vision_qa");
  assert.equal(prepared.autoDecision?.media_tool, undefined);
});

test("Auto wallpaper keeps chat channel without media_tool short-circuit", async () => {
  const prepared = await createService({
    readAuthorizedModelConfig: async () => ({
      availableModels: [
        ...catalogModels,
        {
          id: "img",
          provider: "腾讯混元",
          model: "hy-image-v3",
          label: "混元生图",
          capabilities: ["image-generation", "text-to-image"],
          routing: routing({
            tier: 2,
            cost_weight: 40,
            quality_weight: 70,
            roles: ["chat"],
            capabilities: ["image-generation"]
          })
        }
      ]
    })
  }).prepare({
    ...input,
    model: "auto",
    messages: [{ role: "user", content: "我希望是一张桌面壁纸卡通的两个人相遇的场景" }]
  } as never);
  assert.equal(prepared.input.model, "auto");
  assert.notEqual(prepared.autoDecision?.model.selected, "hy-image-v3");
  assert.equal(prepared.autoDecision?.orchestrator?.primary_channel, "text_chat");
  assert.ok(prepared.autoDecision?.model.reason_codes.includes("media_via_tool_calls"));
  assert.equal(prepared.autoDecision?.media_tool, undefined);
});

test("skill routing still works for pinned models; Auto defers specialty to spring-app", async () => {
  const prepared = await createService({
    resolveSkillRoutingHints: async () => [{
      skillName: "project-gov",
      scope: "project",
      roles: ["gov", "research"],
      min_tier: 2,
      capabilities: ["tools", "long_context"],
      task_class: "gov_write"
    }]
  }).prepare({
    ...input,
    model: "auto",
    selectedSkillNames: ["project-gov"],
    messages: [{ role: "user", content: "请写一份政务调研报告" }]
  } as never);
  assert.equal(prepared.input.model, "auto");
  assert.equal(prepared.autoDecision?.model.selected, "pro-model");
  assert.equal(prepared.autoDecision?.task_class, "gov_write");
  assert.ok(prepared.autoDecision?.model.reason_codes.includes("server_authoritative_auto"));
});
