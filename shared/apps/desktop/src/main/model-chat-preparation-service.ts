import type {
  ModelChatInput,
  ModelConfig,
  WorkspaceCatalogItem,
  WorkspaceThreadRecord
} from "@codex-forge/protocol";
import {
  isModelAutoSelection,
  isSpecializedNonChatModel,
  isVisionCapableModel,
  MODEL_AUTO_ID,
  normalizeOptimizeFor,
  resolveModelAutoDecision,
  turnRequiresVisionRouting,
  type AutoDecision,
  type AutoTaskClass,
  type AuthorizedModelOption
} from "./model-auto-router.ts";
import { resolveAutoParentDisplayName } from "./auto-parent-display-policy.ts";
import {
  buildSkillRoutingHints,
  type SkillRoutingHint,
  type SkillRoutingScope
} from "./skill-routing.ts";
import type { SpringAppAutoRouteDecision } from "./spring-app-auto-route.ts";
import {
  THREAD_ALREADY_RUNNING_ERROR_ZH
} from "./thread-model-task-gate.ts";
import { isCustomModelSelection, type CustomModelEndpointPublic } from "../shared/custom-model-endpoint.ts";

interface WorkspaceCatalog {
  workspaces: WorkspaceCatalogItem[];
}

export interface ModelChatPreparationDependencies {
  isRequestActive: (requestId: string) => boolean;
  isThreadActive: (workspaceId: string, threadId: string) => boolean;
  /**
   * Clear stale map entries, then interrupt-and-replace any live task on this thread
   * so a new user message is not blocked by a stuck prior turn.
   */
  releaseThreadTasks?: (workspaceId: string, threadId: string) => number | Promise<number>;
  readCatalog: () => Promise<WorkspaceCatalog>;
  readAuthorizedModelConfig: () => Promise<ModelConfig>;
  /**
   * Optional loader for skill routing.json / inferred hints with scopes.
   * When omitted, hints are inferred from selectedSkillNames only.
   */
  resolveSkillRoutingHints?: (input: {
    workspaceId: string;
    selectedSkillNames: string[];
  }) => Promise<SkillRoutingHint[]> | SkillRoutingHint[];
  /**
   * Server-authoritative Auto (spring-app `/v1/auto/route`).
   * Required for Auto selections — desktop must not pick specialty models locally.
   */
  resolveServerAutoRoute?: (input: {
    latestUserText: string;
    optimizeFor: string;
    selectedSkillNames: string[];
    hasImageAttachments: boolean;
    requestId: string;
    workspaceId: string;
    threadId: string;
  }) => Promise<SpringAppAutoRouteDecision>;
  /** User-owned OpenAI-compatible endpoint. Official catalog checks do not apply. */
  resolveCustomModelEndpoint?: (modelId: string) => Promise<CustomModelEndpointPublic | null>;
}

export interface PreparedModelChat {
  input: ModelChatInput;
  workspace: WorkspaceCatalogItem;
  thread: WorkspaceThreadRecord;
  autoDecision?: AutoDecision;
}

function mapServerTaskClass(value: string): AutoTaskClass {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "chat" || raw === "code" || raw === "gov_write" || raw === "research" || raw === "general") {
    return raw;
  }
  return "general";
}

function resolveVisionModelOption(
  modelName: string,
  availableModels: AuthorizedModelOption[]
): AuthorizedModelOption {
  const normalized = String(modelName || "").trim().toLowerCase();
  return availableModels.find((item) => item.model.trim().toLowerCase() === normalized)
    ?? { model: modelName, provider: "", label: modelName };
}

function filterVisionFallbackChain(
  chain: string[] | null | undefined,
  availableModels: AuthorizedModelOption[],
  selectedModel: string
): string[] {
  const selected = String(selectedModel || "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of chain ?? []) {
    const trimmed = String(name || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (key === selected || seen.has(key)) continue;
    if (!isVisionCapableModel(resolveVisionModelOption(trimmed, availableModels))) continue;
    if (isSpecializedNonChatModel(resolveVisionModelOption(trimmed, availableModels))) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Safety net when spring-app Auto returns a non-vision chat model for an image turn
 * (or interrupt-resume after an image turn). Keep specialty image/video channels alone.
 */
export function enforceVisionCapableAutoSelection(input: {
  decision: AutoDecision;
  availableModels: AuthorizedModelOption[];
  hasImageAttachments?: boolean;
}): AutoDecision {
  if (!input.hasImageAttachments) return input.decision;
  const channel = String(input.decision.orchestrator?.primary_channel || "").trim();
  if (channel === "image_gen" || channel === "video_gen") return input.decision;

  const selectedName = String(input.decision.model.selected || "").trim();
  const selected = resolveVisionModelOption(selectedName, input.availableModels);
  const visionPool = input.availableModels.filter(
    (item) => isVisionCapableModel(item) && !isSpecializedNonChatModel(item)
  );

  if (isVisionCapableModel(selected)) {
    const fallback_chain = filterVisionFallbackChain(
      input.decision.model.fallback_chain,
      input.availableModels,
      selected.model
    );
    const sameChain = fallback_chain.join("\0") === (input.decision.model.fallback_chain ?? []).join("\0");
    if (sameChain) return input.decision;
    return {
      ...input.decision,
      model: {
        ...input.decision.model,
        fallback_chain,
        reason_codes: [...new Set([
          ...input.decision.model.reason_codes,
          "requires_vision",
          "vision_capable",
          "vision_fallback_filtered"
        ])]
      }
    };
  }

  if (!visionPool.length) {
    return {
      ...input.decision,
      model: {
        ...input.decision.model,
        reason_codes: [...new Set([
          ...input.decision.model.reason_codes,
          "vision_unavailable_use_bridge"
        ])]
      }
    };
  }

  const fromServerChain = (input.decision.model.fallback_chain ?? [])
    .map((name) => visionPool.find((item) => item.model.toLowerCase() === String(name || "").trim().toLowerCase()))
    .find(Boolean);
  const next = fromServerChain ?? visionPool[0]!;
  const fallback_chain = filterVisionFallbackChain(
    [
      ...(input.decision.model.fallback_chain ?? []),
      ...visionPool.map((item) => item.model)
    ],
    input.availableModels,
    next.model
  );
  const reasonCodes = [
    ...input.decision.model.reason_codes,
    "requires_vision",
    "vision_capable",
    "local_vision_model_guard",
    "channel=vision_qa"
  ];
  return {
    ...input.decision,
    model: {
      ...input.decision.model,
      selected: next.model,
      fallback_chain,
      fallback_index: 0,
      reason_codes: [...new Set(reasonCodes.map((code) => String(code || "").trim()).filter(Boolean))]
    },
    notes: `local vision guard: ${selectedName || "unknown"} → ${next.model}`,
    orchestrator: {
      schema_version: 1,
      intent: "vision_qa",
      handled_by: "router",
      can_handle_directly: false,
      primary_channel: "vision_qa",
      reason_codes: [...new Set([
        ...(input.decision.orchestrator?.reason_codes ?? []),
        ...reasonCodes
      ].map((code) => String(code || "").trim()).filter(Boolean))]
    }
  };
}

function autoDecisionFromServer(input: {
  server: SpringAppAutoRouteDecision;
  runId: string;
  threadId: string;
  latestUserText: string;
  selectedSkillNames: string[];
  permissionMode?: "full" | "approval" | "agent";
}): AutoDecision {
  const channel = String(input.server.channel || "text_chat");
  const intent =
    channel === "image_gen" ? "image_gen"
      : channel === "video_gen" ? "video_gen"
        : channel === "vision_qa" ? "vision_qa"
          : channel === "ocr" ? "ocr"
            : channel === "coding" ? "code"
              : "general";
  const reasonCodes = [
    ...input.server.reason_codes,
    "server_authoritative_auto",
    `channel=${channel}`,
    "media_via_tool_calls"
  ];
  return {
    schema_version: 1,
    mode: "auto",
    decided_at: new Date().toISOString(),
    run_id: input.runId,
    thread_id: input.threadId,
    input_fingerprint: `server_${input.runId}`,
    model: {
      requested: MODEL_AUTO_ID,
      selected: input.server.model,
      reason_codes: reasonCodes,
      fallback_chain: input.server.fallback_models ?? [],
      fallback_index: 0
    },
    reasoning: {
      effort: "auto",
      summary: "auto",
      resolved_effort: "medium"
    },
    skills: {
      explicit: [...input.selectedSkillNames],
      automatic: [],
      government_enabled: input.selectedSkillNames.some((name) =>
        String(name || "").toLowerCase().includes("government")
      )
    },
    permission_profile: input.permissionMode === "full"
      ? "full"
      : input.permissionMode === "approval"
        ? "approval"
        : "auto_review",
    allow_auto_delegate: true,
    policy_etag: "spring-app-auto",
    degraded: Boolean(input.server.degraded),
    notes: input.server.notes
      || `spring-app Auto → ${input.server.model} · ${channel}（媒体由模型 tool_calls；勿 curl TokenHub）`,
    task_class: mapServerTaskClass(input.server.task_class),
    routing_tier: mapServerTaskClass(input.server.task_class) === "chat" ? "light" : "general",
    optimize_for: normalizeOptimizeFor(input.server.optimize_for),
    orchestrator: {
      schema_version: 1,
      intent: intent as never,
      handled_by: "router",
      can_handle_directly: false,
      primary_channel: channel as never,
      reason_codes: reasonCodes
    }
  };
}

/** Resolves and authorizes the immutable identity of a model-chat turn. */
export class ModelChatPreparationService {
  private readonly dependencies: ModelChatPreparationDependencies;

  constructor(dependencies: ModelChatPreparationDependencies) {
    this.dependencies = dependencies;
  }

  async prepare(input: ModelChatInput): Promise<PreparedModelChat> {
    if (this.dependencies.isRequestActive(input.requestId)) throw new Error("The request is already running.");
    const workspaceId = input.workspaceId?.trim();
    const threadId = input.threadId?.trim();
    if (!workspaceId || !threadId) throw new Error("chat-with-model requires workspaceId and threadId.");

    const catalog = await this.dependencies.readCatalog();
    const workspace = catalog.workspaces.find((item) => item.id === workspaceId);
    const thread = workspace?.threads.find((item) => item.id === threadId);
    if (!workspace || !thread) throw new Error("Workspace thread was not found.");
    if (this.dependencies.isThreadActive(workspace.id, thread.id)) {
      await this.dependencies.releaseThreadTasks?.(workspace.id, thread.id);
    }
    if (this.dependencies.isThreadActive(workspace.id, thread.id)) {
      throw new Error(THREAD_ALREADY_RUNNING_ERROR_ZH);
    }

    if (isCustomModelSelection(input.model)) {
      const endpoint = await this.dependencies.resolveCustomModelEndpoint?.(input.model) ?? null;
      if (!endpoint) throw new Error("自备模型不存在或已被删除。请在模型菜单里重新添加。");
      return {
        workspace,
        thread,
        input: {
          ...input,
          provider: endpoint.label,
          baseUrl: endpoint.baseUrl,
          apiKey: "",
          wireApi: endpoint.wireApi,
          model: endpoint.id
        }
      };
    }

    const authorized = await this.dependencies.readAuthorizedModelConfig();
    const availableModels = authorized.availableModels ?? [];
    const latestUserText = [...(input.messages ?? [])]
      .reverse()
      .find((message) => message.role === "user")
      ?.content ?? "";
    // Latest-turn images, or interrupt-resume after a prior image turn.
    // Ordinary later text after an older image must not forever force vision_qa.
    const hasImages = turnRequiresVisionRouting(input.messages);
    const configuredDefault = String(authorized.model || "").trim();
    const selectedSkillNames = input.selectedSkillNames ?? [];
    const explicitHints = this.dependencies.resolveSkillRoutingHints
      ? await this.dependencies.resolveSkillRoutingHints({
          workspaceId: workspace.id,
          selectedSkillNames
        })
      : [];
    const skillRoutingHints = buildSkillRoutingHints({
      selectedSkillNames,
      explicitHints
    });
    const skillScopes = Object.fromEntries(
      skillRoutingHints.map((hint) => [hint.skillName, hint.scope as SkillRoutingScope])
    );
    const optimizeFor = normalizeOptimizeFor(input.optimizeFor ?? authorized.optimizeFor);

    let autoDecision: AutoDecision;
    if (isModelAutoSelection(input.model)) {
      if (!this.dependencies.resolveServerAutoRoute) {
        throw new Error("Auto 路由必须由 spring-app 决策，但桌面未配置 resolveServerAutoRoute。");
      }
      const server = await this.dependencies.resolveServerAutoRoute({
        latestUserText,
        optimizeFor,
        selectedSkillNames,
        hasImageAttachments: hasImages,
        requestId: input.requestId,
        workspaceId: workspace.id,
        threadId: thread.id
      });
      if (!String(server.model || "").trim()) {
        throw new Error("spring-app Auto 未返回可用模型。");
      }
      autoDecision = enforceVisionCapableAutoSelection({
        decision: autoDecisionFromServer({
          server,
          runId: input.requestId,
          threadId: thread.id,
          latestUserText,
          selectedSkillNames,
          permissionMode: input.permissionMode
        }),
        availableModels: (availableModels as AuthorizedModelOption[]) ?? [],
        hasImageAttachments: hasImages
      });
    } else {
      // Pinned / manual only — local Auto brain is not the authority.
      autoDecision = resolveModelAutoDecision({
        requestedModel: input.model,
        availableModels,
        latestUserText,
        selectedSkillNames,
        skillRoutingHints,
        skillScopes,
        permissionMode: input.permissionMode,
        reasoningEffort: input.reasoningEffort,
        runId: input.requestId,
        threadId: thread.id,
        hasImageAttachments: hasImages,
        optimizeFor,
        defaultModel: isModelAutoSelection(configuredDefault) ? undefined : configuredDefault
      });
    }

    let selected = availableModels.find(
      (item) => item.model.toLowerCase() === autoDecision.model.selected.toLowerCase()
    );
    if (!selected && isModelAutoSelection(input.model)) {
      // Server may return a specialty model; keep provider from catalog match or gateway default.
      selected = {
        model: autoDecision.model.selected,
        provider: String(authorized.provider || "gateway"),
        label: autoDecision.model.selected
      };
    }
    if (!selected) {
      throw new Error(
        isModelAutoSelection(input.model)
          ? "Auto could not select an authorized model."
          : "The current subscription does not allow the selected model."
      );
    }
    const reviewModel = availableModels.find(
      (item) => item.model.toLowerCase() === input.reviewModel.trim().toLowerCase()
    )?.model ?? selected.model;
    const outboundIsAuto = isModelAutoSelection(input.model);
    // Image / interrupt-resume vision turns pin the vision-capable parent model so
    // /v1/responses(model=auto) cannot re-pick a text-only flash after spring routing.
    // Specialty 出图/视频 still stay on model=auto + child tools.
    const pinVisionParent = outboundIsAuto
      && hasImages
      && isVisionCapableModel(selected)
      && String(autoDecision.orchestrator?.primary_channel || "") !== "image_gen"
      && String(autoDecision.orchestrator?.primary_channel || "") !== "video_gen";

    return {
      workspace,
      thread,
      autoDecision,
      autoParentDisplayName: resolveAutoParentDisplayName(authorized.autoParentDisplayName),
      input: {
        ...input,
        provider: selected.provider,
        wireApi: "responses",
        // Auto mode: outbound stays model=auto except vision-required turns above.
        // Never pin specialty 出图/视频 models on the desktop — child tools execute.
        model: pinVisionParent ? selected.model : (outboundIsAuto ? MODEL_AUTO_ID : selected.model),
        reviewModel,
        optimizeFor: autoDecision.optimize_for ?? optimizeFor,
        // Advisory only: callModelApi uses this so Auto+image turns send native
        // multimodal parts instead of mis-detecting capability on the literal "auto".
        ...(outboundIsAuto
          ? { parentSelectedModel: autoDecision.model.selected }
          : {})
      } as ModelChatInput & { parentSelectedModel?: string }
    };
  }
}
