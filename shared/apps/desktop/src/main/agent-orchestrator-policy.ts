import {
  classifyAutoTaskClass,
  looksLike3dGenerationRequest,
  looksLikeImageGenerationRequest,
  looksLikeMusicGenerationRequest,
  looksLikeOcrRequest,
  looksLikeVideoGenerationRequest,
  type AuthorizedModelOption,
  type AutoTaskClass
} from "./model-auto-router.ts";

/** High-level user intent used by the main-agent orchestrator. */
export type OrchestratorIntent =
  | "chat"
  | "code"
  | "research"
  | "gov_write"
  | "vision_qa"
  | "image_gen"
  | "video_gen"
  | "music_gen"
  | "three_d_gen"
  | "ocr"
  | "mixed"
  | "general";

export type OrchestratorChannel =
  | "text_chat"
  | "coding"
  | "vision_qa"
  | "image_gen"
  | "video_gen"
  | "music_gen"
  | "three_d_gen"
  | "ocr"
  | "tools";

/** Compact audit trail attached to AutoDecision for P0+. */
export type OrchestratorDecisionTrace = {
  schema_version: 1;
  intent: OrchestratorIntent;
  handled_by: "main" | "router" | "subagent";
  can_handle_directly: boolean;
  primary_channel: OrchestratorChannel;
  reason_codes: string[];
};

const GREETING_RE =
  /^(?:你好|您好|嗨|哈喽|早|早上好|晚安|hello|hi|hey)[\s\p{P}\p{S}]*$/iu;

const LIGHT_MODEL_RE = /flash|lite|mini|small|haiku|seed|turbo|fast/i;
const HEAVY_MODEL_RE = /(?:^|[^a-z0-9])(?:pro|max|opus|ultra|reasoner|\br1\b|sonnet|o3|o4-mini)(?:[^a-z0-9]|$)/i;

function hasNonEmptySkills(selectedSkillNames?: string[]): boolean {
  return (selectedSkillNames ?? []).some((name) => String(name || "").trim());
}

export function isGreetingText(text: string | undefined | null): boolean {
  return GREETING_RE.test(String(text || "").trim());
}

export { looksLikeImageGenerationRequest, looksLikeVideoGenerationRequest };

export function isLightNamedModel(option: Pick<AuthorizedModelOption, "model" | "label">): boolean {
  return LIGHT_MODEL_RE.test(option.model) || LIGHT_MODEL_RE.test(option.label || "");
}

export function isHeavyNamedModel(option: Pick<AuthorizedModelOption, "model" | "label">): boolean {
  return HEAVY_MODEL_RE.test(option.model) || HEAVY_MODEL_RE.test(option.label || "");
}

export function detectOrchestratorIntent(input: {
  latestUserText?: string;
  selectedSkillNames?: string[];
  hasImageAttachments?: boolean;
}): OrchestratorIntent {
  const wantsVideo = looksLikeVideoGenerationRequest(input.latestUserText);
  const wantsMusic = looksLikeMusicGenerationRequest(input.latestUserText);
  const wants3d = looksLike3dGenerationRequest(input.latestUserText);
  const wantsOcr = looksLikeOcrRequest(input.latestUserText) && Boolean(input.hasImageAttachments);
  const wantsImage = looksLikeImageGenerationRequest(input.latestUserText);
  // Video generation beats vision-QA even when a reference image is attached (i2v).
  if (wantsVideo) return "video_gen";
  if (wantsMusic) return "music_gen";
  if (wants3d) return "three_d_gen";
  if (wantsOcr) return "ocr";
  if (input.hasImageAttachments) {
    if (wantsImage) return "mixed";
    return "vision_qa";
  }
  if (wantsImage) return "image_gen";
  const taskClass: AutoTaskClass = classifyAutoTaskClass({
    text: input.latestUserText,
    selectedSkillNames: input.selectedSkillNames
  });
  if (taskClass === "chat") return "chat";
  if (taskClass === "code") return "code";
  if (taskClass === "research") return "research";
  if (taskClass === "gov_write") return "gov_write";
  return "general";
}

export function channelForIntent(intent: OrchestratorIntent): OrchestratorChannel {
  if (intent === "vision_qa") return "vision_qa";
  if (intent === "image_gen") return "image_gen";
  if (intent === "video_gen") return "video_gen";
  if (intent === "music_gen") return "music_gen";
  if (intent === "three_d_gen") return "three_d_gen";
  if (intent === "ocr") return "ocr";
  if (intent === "code") return "coding";
  if (intent === "gov_write" || intent === "research") return "tools";
  return "text_chat";
}

/**
 * P0 strong rule: simple chat/greetings are handled by the main agent path
 * (no sub-agent, no vision, no hard dependency on active routing profiles).
 */
export function shouldMainAgentHandleDirectly(input: {
  latestUserText?: string;
  selectedSkillNames?: string[];
  hasImageAttachments?: boolean;
}): { direct: boolean; intent: OrchestratorIntent; reasonCodes: string[] } {
  const intent = detectOrchestratorIntent(input);
  const reasonCodes: string[] = [`intent=${intent}`];

  if (intent === "video_gen") {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "needs_video_gen_channel"] };
  }
  if (intent === "music_gen") {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "needs_music_gen_channel"] };
  }
  if (intent === "three_d_gen") {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "needs_3d_gen_channel"] };
  }
  if (intent === "ocr") {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "needs_ocr_channel"] };
  }
  if (input.hasImageAttachments) {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "has_image_attachments"] };
  }
  if (intent === "image_gen") {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "needs_image_gen_channel"] };
  }
  if (intent === "vision_qa") {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "needs_vision_channel"] };
  }
  if (hasNonEmptySkills(input.selectedSkillNames)) {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "has_explicit_skills"] };
  }
  if (intent === "code" || intent === "research" || intent === "gov_write") {
    return { direct: false, intent, reasonCodes: [...reasonCodes, "needs_specialized_worker"] };
  }

  const trimmed = String(input.latestUserText || "").trim();
  if (isGreetingText(trimmed)) {
    return {
      direct: true,
      intent: "chat",
      reasonCodes: [...reasonCodes, "greeting_direct", "handled_by_main", "no_delegation"]
    };
  }
  if (intent === "chat" && trimmed.length > 0 && trimmed.length <= 40) {
    return {
      direct: true,
      intent: "chat",
      reasonCodes: [...reasonCodes, "short_chat_direct", "handled_by_main", "no_delegation"]
    };
  }
  return { direct: false, intent, reasonCodes: [...reasonCodes, "escalate_for_routing"] };
}

/** Prefer configured default only when it is in the authorized subscription pool,
 * then a light/flash model from that pool, else the first authorized model.
 * Never returns a model outside {@code availableModels}. */
export function pickMainAgentModel(
  availableModels: AuthorizedModelOption[],
  defaultModel?: string
): AuthorizedModelOption | undefined {
  const available = availableModels.filter((item) => String(item.model || "").trim());
  if (!available.length) return undefined;
  const defaultId = String(defaultModel || "").trim().toLowerCase();
  if (defaultId) {
    const matched = available.find((item) => item.model.toLowerCase() === defaultId);
    // Out-of-subscription defaults are ignored — do not invent/bypass billing.
    if (matched) return matched;
  }
  const light = available.find((item) => isLightNamedModel(item));
  if (light) return light;
  return available[0];
}

/**
 * Parent-agent model pick for Auto when routing profiles are missing or incomplete.
 * Flash for short chat / cost; Pro (or other heavy names) for code / research / writing / general delivery.
 * Callers should pass {@code preferLight} from prefersLightAutoModel to avoid circular imports.
 */
export function pickParentAgentModelForTask(input: {
  availableModels: AuthorizedModelOption[];
  taskClass: AutoTaskClass;
  optimizeFor?: "balanced" | "cost" | "intelligence";
  latestUserText?: string;
  defaultModel?: string;
  preferLight: boolean;
}): AuthorizedModelOption | undefined {
  const available = input.availableModels.filter((item) => String(item.model || "").trim());
  if (!available.length) return undefined;
  if (input.preferLight) {
    return pickMainAgentModel(available, input.defaultModel);
  }
  const defaultId = String(input.defaultModel || "").trim().toLowerCase();
  if (defaultId) {
    const matched = available.find((item) => item.model.toLowerCase() === defaultId);
    if (matched && isHeavyNamedModel(matched)) return matched;
  }
  const heavy = available.find((item) => isHeavyNamedModel(item));
  if (heavy) return heavy;
  // No explicit pro/max: avoid flash when a non-light model exists.
  const nonLight = available.find((item) => !isLightNamedModel(item));
  if (nonLight) return nonLight;
  return pickMainAgentModel(available, input.defaultModel);
}

export function buildOrchestratorTrace(input: {
  intent: OrchestratorIntent;
  handledBy: OrchestratorDecisionTrace["handled_by"];
  canHandleDirectly: boolean;
  reasonCodes: string[];
}): OrchestratorDecisionTrace {
  return {
    schema_version: 1,
    intent: input.intent,
    handled_by: input.handledBy,
    can_handle_directly: input.canHandleDirectly,
    primary_channel: channelForIntent(input.intent),
    reason_codes: [...input.reasonCodes]
  };
}
