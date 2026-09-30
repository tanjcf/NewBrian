import type {
  ModelOptimizeFor,
  ModelRoutingProfile,
  ModelRoutingRole
} from "@codex-forge/protocol";
import {
  buildOrchestratorTrace,
  pickMainAgentModel,
  pickParentAgentModelForTask,
  shouldMainAgentHandleDirectly,
  type OrchestratorDecisionTrace
} from "./agent-orchestrator-policy.ts";
import { shouldAutoDelegateHeavyWork } from "./auto-orchestrator-policy.ts";
import { GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED } from "../shared/product-flags.js";
import {
  compareModelsByEffectivenessThenCost,
  ensureRoutingProfile,
  taskQualityScore,
  unitTokenPricePerMillion
} from "./model-economics.ts";
import {
  buildSkillRoutingHints,
  mergeSkillRoutingHints,
  type RoutingConstraint,
  type SkillRoutingHint,
  type SkillRoutingScope
} from "./skill-routing.ts";

export const MODEL_AUTO_ID = "auto";
export const MODEL_AUTO_LABEL = "Auto";

/**
 * Legacy Auto-only message when no vision model exists in the catalog.
 * Image turns now prefer vision when available, otherwise keep the text model and
 * use the OpenClaw-style describe-bridge (see turn-image-resolution.ts).
 */
export const NO_VISION_MODEL_MESSAGE = "当前没有可用的识图模型，请在设置中配置支持视觉的模型";

export const AUTO_NO_ROUTING_POOL_MESSAGE =
  "当前没有完成画像的可用模型，请稍后再试或手动选择模型";

export const AUTO_NO_CONSTRAINT_MATCH_MESSAGE =
  "当前没有满足技能/任务约束的可用模型，请调整技能要求、Optimize 档位或手动选择模型";

export const AUTO_NO_IMAGE_MODEL_MESSAGE =
  "当前套餐没有可用的文生图/出图模型（如 hy-image-v3）。请升级订阅或手动选择图像生成模型；Auto 不会用纯文本模型冒充出图。";

export const PINNED_MODEL_MISSING_MESSAGE =
  "所选模型不在当前套餐授权列表中，请重新选择";

export type AutoMode = "manual" | "auto" | "auto_strict" | "full";
export type AutoTaskClass = "chat" | "code" | "gov_write" | "research" | "general";
export type AutoRoutingTier = "light" | "heavy" | "general";
export type OptimizeFor = ModelOptimizeFor;

export type AuthorizedModelOption = {
  id?: string;
  model: string;
  label?: string;
  provider: string;
  /** Capability tags from the gateway (vision / multimodal / image, etc.). */
  capabilities?: string[];
  /** Gateway billing: input USD-equivalent (or local currency) per 1M tokens. */
  input_token_price_per_million?: number;
  /** Gateway billing: output price per 1M tokens. */
  output_token_price_per_million?: number;
  /** Chinese capability introduction from gateway table / research. */
  capability_intro?: string;
  best_for?: string;
  strengths?: string;
  routing?: ModelRoutingProfile;
};

export type AutoDecision = {
  schema_version: 1;
  mode: AutoMode;
  decided_at: string;
  run_id: string;
  thread_id: string;
  input_fingerprint: string;
  model: {
    requested: string | typeof MODEL_AUTO_ID;
    selected: string;
    reason_codes: string[];
    fallback_chain: string[];
    fallback_index: number;
  };
  reasoning: {
    effort: string;
    summary: "auto" | "concise" | "detailed" | "none";
    resolved_effort: string;
  };
  skills: {
    explicit: string[];
    automatic: string[];
    government_enabled: boolean;
  };
  permission_profile: "approval" | "auto_review" | "full";
  allow_auto_delegate: boolean;
  policy_etag: string;
  degraded: boolean;
  notes?: string;
  warnings?: string[];
  task_class: AutoTaskClass;
  routing_tier: AutoRoutingTier;
  optimize_for?: OptimizeFor;
  constraint_summary?: string;
  skill_scopes_applied?: SkillRoutingScope[];
  /** P0+ main-agent orchestrator audit trail. */
  orchestrator?: OrchestratorDecisionTrace;
  /**
   * spring-app Auto media tool ownership.
   * When execution=server, desktop calls /v1/auto/tools/invoke (not vendor URLs).
   */
  media_tool?: {
    execution: "server" | "client";
    tool_name: string;
    media_kind?: string;
  };
};

export function isModelAutoSelection(model: string | undefined | null) {
  return String(model || "").trim().toLowerCase() === MODEL_AUTO_ID;
}

export function normalizeOptimizeFor(value: unknown): OptimizeFor {
  const raw = String(value || "").trim().toLowerCase();
  // quality / 效果优先 → intelligence (strongest quality bias)
  if (raw === "quality" || raw === "效果优先") return "intelligence";
  if (raw === "cost" || raw === "intelligence") return raw;
  return "balanced";
}

export function routingTierForTaskClass(taskClass: AutoTaskClass): AutoRoutingTier {
  if (taskClass === "chat") return "light";
  if (taskClass === "gov_write" || taskClass === "research" || taskClass === "code") return "heavy";
  return "general";
}

const VIDEO_GEN_RE =
  /(?:文生视频|图生视频|生成视频|制作视频|做[个一]?视频|做出视频|出[个一]?视频|帮我做视频|视频生成|拍[个一]?短视频|做动画|生成动画|seedance|t2v|i2v|kling|runway|pixverse|vidu|minimax|musesteamer|蒸汽机|优图视频|人像驱动|humanactor)/i;

export function looksLikeVideoGenerationRequest(text: string | undefined | null): boolean {
  return VIDEO_GEN_RE.test(String(text || "").trim());
}

const IMAGE_GEN_REQUEST_RE =
  /(?:文生图|画一[张幅只个]|生成一?[张幅].*(?:图|图片|海报|插画|壁纸|场景)|帮我画|画张|做张图|做[一]?[张幅].*(?:图|图片|海报|插画|壁纸|场景)|做出[一]?[张幅].*(?:图|图片|壁纸)|出[一]?[张幅]?图|出图|生成图片|生成海报|生成壁纸|做壁纸|画壁纸|桌面(?:图片|壁纸|背景)|壁纸|wallpaper|卡通.*(?:图|壁纸|场景)|3d?\s*动画|动画电影|电影风|两个人.*相遇|生成.*场景|做成.*壁纸|一张.*(?:图|壁纸|场景)|hy-image|tokenhub.*(?:image|图)|混元生图)/i;

const MEDIA_CAPABILITY_QUESTION_RE =
  /^(?:你|brain|newbrain|ai|系统)?\s*(?:会|能|可以|是否可以|支持)\s*(?:直接)?\s*(?:生成|制作|画)\s*(?:图片|图像|图|视频|动画)\s*(?:吗|么|嘛|不|\?|？)?$/i;

export function looksLikeMediaCapabilityQuestion(text: string | undefined | null): boolean {
  return MEDIA_CAPABILITY_QUESTION_RE.test(String(text || "").trim());
}

export function looksLikeImageGenerationRequest(text: string | undefined | null): boolean {
  const trimmed = String(text || "").trim();
  if (looksLikeMediaCapabilityQuestion(trimmed)) return false;
  if (looksLikeVideoGenerationRequest(trimmed)) return false;
  return IMAGE_GEN_REQUEST_RE.test(trimmed);
}

const MUSIC_GEN_RE =
  /(?:生成音乐|做[一首]?歌|写[一首]?歌|作曲|编曲|纯音乐|生成歌曲|生成一[首支].*歌|帮我生成一[首支]歌|音乐生成|minimax.?music|作一首|一[首支].*(?:歌|曲))/i;

export function looksLikeMusicGenerationRequest(text: string | undefined | null): boolean {
  const trimmed = String(text || "").trim();
  if (looksLikeVideoGenerationRequest(trimmed)) return false;
  return MUSIC_GEN_RE.test(trimmed);
}

const THREE_D_GEN_RE =
  /(?:生成\s*3d|文生\s*3d|做[个一]?三维|三维模型|3d\s*模型|mesh|hy-?3d|seed3d|meshy|tripo)/i;

export function looksLike3dGenerationRequest(text: string | undefined | null): boolean {
  return THREE_D_GEN_RE.test(String(text || "").trim());
}

const OCR_REQUEST_RE =
  /(?:OCR|ocr|文字识别|文档识别|识别文字|识别这[张幅页]|提取文字|转成文字|转文本|图像转文本|发票识别|合同识别|截图识别|版面分析|表格识别)/i;

export function looksLikeOcrRequest(text: string | undefined | null): boolean {
  return OCR_REQUEST_RE.test(String(text || "").trim());
}

export function classifyAutoTaskClass(input: {
  text?: string;
  selectedSkillNames?: string[];
}): AutoTaskClass {
  const skills = (input.selectedSkillNames ?? []).map((name) => String(name || "").toLowerCase());
  if (
    GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED
    && skills.some((name) => name.includes("government") || name.includes("research-writing"))
  ) {
    return "gov_write";
  }
  const text = String(input.text || "");
  const trimmed = text.trim();
  if (/^(?:你好|您好|嗨|哈喽|早|早上好|晚安|hello|hi|hey)[\s\p{P}\p{S}]*$/iu.test(trimmed)) {
    return "chat";
  }
  // Video generation needs tools / specialized models — never treat as light chat.
  if (looksLikeVideoGenerationRequest(trimmed)) return "general";
  if (
    GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED
    && /政务|公文|政策|白皮书|调研报告|政府网|育儿补贴|通知公告/.test(text)
  ) {
    return "gov_write";
  }
  if (/调研|检索|资料汇总|文献|研究/.test(text)) return "research";
  if (
    /代码|重构|bug|报错|编译|测试|pull request|\bpr\b|typescript|javascript|java|python|实现|修复|调试|排查|单元测试|集成测试|接口|api\b|sql\b|前端|后端|仓库|commit|分支/i
      .test(text)
  ) {
    return "code";
  }
  // Multi-step delivery / long-form writing needs a stronger parent model (pro), not flash.
  if (
    /完整正文|整章|章节|docx|pdf|pptx|\bppt\b|方案设计|架构设计|制作动画|分镜|交付|里程碑|子\s*agent|多步骤|端到端|从零|完整稿|长文|白皮书提纲|简报|导出/i
      .test(text)
    || (trimmed.length >= 80 && /写|生成|实现|完成|继续|请帮|帮我/.test(text))
  ) {
    return "general";
  }
  if (trimmed.length <= 40) return "chat";
  if (/写一[句首段小]|帮我润色|翻译成|总结一下|这是什么意思|怎么读/.test(text) && trimmed.length <= 120) {
    return "chat";
  }
  return "general";
}

/** Whether the parent Auto path should prefer flash-class models for this turn. */
export function prefersLightAutoModel(input: {
  taskClass: AutoTaskClass;
  optimizeFor?: OptimizeFor;
  latestUserText?: string;
}): boolean {
  const optimizeFor = normalizeOptimizeFor(input.optimizeFor);
  if (optimizeFor === "intelligence") return false;
  if (optimizeFor === "cost") return input.taskClass === "chat" || input.taskClass === "general";
  if (input.taskClass === "chat") return true;
  if (input.taskClass === "code" || input.taskClass === "research" || input.taskClass === "gov_write") {
    return false;
  }
  // general: short confirmations stay light; delivery / long asks prefer pro
  const trimmed = String(input.latestUserText || "").trim();
  if (trimmed.length > 0 && trimmed.length <= 24 && /^(?:好的|可以|继续|确认|是的|嗯|ok|yes)[\s\p{P}\p{S}]*$/iu.test(trimmed)) {
    return true;
  }
  return false;
}

function fingerprint(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16)}`;
}

const VISION_CAPABILITY_RE =
  /^(?:vision|multimodal|image|vl|image[_-]?input|image[_-]?understanding|video[_-]?understanding)$/i;
const VISION_MODEL_NAME_RE =
  /(?:^|[^a-z0-9])(?:[\w.-]*[-_.]?vl(?:[-_.][\w.-]*)?|vision|multimodal|gpt-4o|gpt-4\.1|gemini|glm-4v|glm-4\.5v|hunyuan-vision|hy-vision|youtu-vita|hunyuan-t1-vision|hunyuan-turbos-vision|kimi-k2(?:[.-]\d+)?|kimi-k3|moonshot-v1-.*vision)(?:[^a-z0-9]|$)/i;
const VIDEO_CAPABILITY_RE =
  /^(?:video|t2v|i2v|text[_-]?to[_-]?video|image[_-]?to[_-]?video|video[_-]?gen(?:eration)?|musesteamer|pixverse|vidu|minimax-video|yt-video|kling|hy-video)$/i;
const VIDEO_MODEL_NAME_RE =
  /(?:^|[^a-z0-9])(?:seedance|kling|runway|luma|pika|wanx|wan2\.|hy-?video|hunyuan[-_]?video|doubao-seedance|musesteamer|muse[-_]?steamer|pixverse|vidu|minimax-video|yt-video|humanactor|t2v|i2v|video[-_]?gen)(?:[^a-z0-9]|$)/i;
const MUSIC_CAPABILITY_RE = /^(?:music|audio|music[_-]?generation)$/i;
const MUSIC_MODEL_NAME_RE =
  /(?:^|[^a-z0-9])(?:minimax-music|music-2\.6|music[_-]?gen)(?:[^a-z0-9]|$)/i;
const THREE_D_CAPABILITY_RE = /^(?:3d|text[_-]?to[_-]?3d|image[_-]?to[_-]?3d)$/i;
const THREE_D_MODEL_NAME_RE =
  /(?:^|[^a-z0-9])(?:hy-3d|seed3d|meshy|tripo|text-to-3d)(?:[^a-z0-9]|$)/i;
const OCR_CAPABILITY_RE = /^(?:ocr|document|image[_-]?to[_-]?text|paddleocr|structurev3)$/i;
const OCR_MODEL_NAME_RE =
  /(?:^|[^a-z0-9])(?:deepseek-ocr|paddleocr|pp-structurev3|structurev3)(?:[^a-z0-9]|$)/i;

export function attachmentLooksLikeImage(attachment: {
  name?: string;
  path?: string;
  url?: string;
} | null | undefined): boolean {
  if (!attachment) return false;
  const pathOrName = `${attachment.path || ""} ${attachment.name || ""}`.trim();
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(pathOrName)) return true;
  const url = String(attachment.url || "");
  return /^data:image\//i.test(url);
}

export function hasImageAttachments(
  attachments: Array<{ name?: string; path?: string; url?: string }> | null | undefined
): boolean {
  return (attachments ?? []).some((item) => attachmentLooksLikeImage(item));
}

export function messagesHaveImageAttachments(
  messages: Array<{ attachments?: Array<{ name?: string; path?: string; url?: string }> }> | null | undefined
): boolean {
  return (messages ?? []).some((message) => hasImageAttachments(message.attachments));
}

/** Auto vision routing should key off this turn's user message, not older attachments. */
export function latestUserMessageHasImageAttachments(
  messages: Array<{
    role?: string;
    attachments?: Array<{ name?: string; path?: string; url?: string }>;
  }> | null | undefined
): boolean {
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages![index];
    if (message?.role !== "user") continue;
    return hasImageAttachments(message.attachments);
  }
  return false;
}

/**
 * User is resuming an interrupted turn (断点 / 异常中断继续).
 * Text-only continue after an image turn must keep vision routing.
 */
export function looksLikeInterruptedTurnContinuation(text: string | null | undefined): boolean {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  return /(?:从上次|上次|上轮|刚才).{0,16}(?:异常|中断|失败|超时|断开)|(?:断点|中断).{0,12}(?:恢复|继续|续跑)|继续(?:执行|完成|处理|刚才)|不要重复已完成|从中断(?:处|位置)|接着(?:做|改|画|修|执行)|resume (?:from|the) (?:last |previous )?(?:interrupt|failure|error)/i
    .test(trimmed);
}

/** Image attachments on the user turn immediately before the latest user message. */
export function priorUserMessageHasImageAttachments(
  messages: Array<{
    role?: string;
    attachments?: Array<{ name?: string; path?: string; url?: string }>;
  }> | null | undefined
): boolean {
  let skippedLatestUser = false;
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages![index];
    if (message?.role !== "user") continue;
    if (!skippedLatestUser) {
      skippedLatestUser = true;
      continue;
    }
    return hasImageAttachments(message.attachments);
  }
  return false;
}

/**
 * Whether this Auto turn needs vision routing.
 * - Latest user message carries images, or
 * - Interrupt/resume continuation after a prior user image turn (history still encodes those images).
 * Ordinary later text chat after an old image turn stays on text models.
 */
export function turnRequiresVisionRouting(
  messages: Array<{
    role?: string;
    content?: string;
    attachments?: Array<{ name?: string; path?: string; url?: string }>;
  }> | null | undefined
): boolean {
  if (latestUserMessageHasImageAttachments(messages)) return true;
  if (!priorUserMessageHasImageAttachments(messages)) return false;
  const latestText = [...(messages ?? [])]
    .reverse()
    .find((message) => message?.role === "user")
    ?.content ?? "";
  return looksLikeInterruptedTurnContinuation(latestText);
}

function modelCapabilityTags(
  option: Pick<AuthorizedModelOption, "capabilities" | "routing">
): string[] {
  return [
    ...(option.capabilities ?? []),
    ...(option.routing?.capabilities ?? [])
  ].map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean);
}

export function isVisionCapableModel(option: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">): boolean {
  const model = String(option.model || "").trim();
  const provider = String(option.provider || "").trim();
  const label = String(option.label || "").trim();
  const haystack = `${provider} ${model} ${label}`;
  if (/deepseek/i.test(haystack)) return false;
  // 文生图模型（hy-image-v3 等）不能当识图模型；capability 常带裸 image 标签。
  if (isImageGenerationCapableModel(option)) return false;

  const caps = modelCapabilityTags(option);
  if (caps.some((tag) => VISION_CAPABILITY_RE.test(tag) || tag.includes("vision") || tag.includes("multimodal"))) {
    return true;
  }
  if (caps.some((tag) => tag === "image" || (tag.includes("image") && !/image[-_]?generat|text[-_]?to[-_]?image/i.test(tag)))) {
    return true;
  }
  if (option.routing?.roles?.includes("vision")) return true;
  return VISION_MODEL_NAME_RE.test(haystack);
}

const IMAGE_GEN_CAPABILITY_RE =
  /^(?:image[_-]?generation|text[_-]?to[_-]?image|image[_-]?gen|txt2img)$/i;
const IMAGE_GEN_MODEL_NAME_RE =
  /(?:^|[^a-z0-9])(?:hy-image|hunyuan-image|gpt-image|dall-?e|imagen|flux|seedream|image-gen)(?:[^a-z0-9]|$)/i;

export function isImageGenerationCapableModel(
  option: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">
): boolean {
  const haystack = [
    String(option.model || ""),
    String(option.label || ""),
    String(option.provider || ""),
    ...modelCapabilityTags(option)
  ].join(" ");
  const caps = modelCapabilityTags(option);
  if (caps.some((tag) => IMAGE_GEN_CAPABILITY_RE.test(tag))) return true;
  if (option.routing?.roles?.some((role) => /image[_-]?gen/i.test(String(role || "")))) return true;
  return IMAGE_GEN_MODEL_NAME_RE.test(haystack);
}

export function isVideoCapableModel(option: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">): boolean {
  const haystack = [
    String(option.model || ""),
    String(option.label || ""),
    String(option.provider || ""),
    ...modelCapabilityTags(option)
  ].join(" ");
  const caps = modelCapabilityTags(option);
  // hy-3d / seed3d are 3D, not video (avoid legacy "hy3" false positive)
  if (THREE_D_MODEL_NAME_RE.test(haystack) || caps.some((tag) => THREE_D_CAPABILITY_RE.test(tag))) {
    return false;
  }
  if (caps.some((tag) => VIDEO_CAPABILITY_RE.test(tag) || tag.includes("video"))) return true;
  if (option.routing?.roles?.some((role) => /video/i.test(String(role || "")))) return true;
  return VIDEO_MODEL_NAME_RE.test(haystack);
}

export function isMusicCapableModel(
  option: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">
): boolean {
  const haystack = [
    String(option.model || ""),
    String(option.label || ""),
    String(option.provider || ""),
    ...modelCapabilityTags(option)
  ].join(" ");
  const caps = modelCapabilityTags(option);
  if (caps.some((tag) => MUSIC_CAPABILITY_RE.test(tag) || tag.includes("music"))) return true;
  return MUSIC_MODEL_NAME_RE.test(haystack);
}

export function is3dCapableModel(
  option: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">
): boolean {
  const haystack = [
    String(option.model || ""),
    String(option.label || ""),
    String(option.provider || ""),
    ...modelCapabilityTags(option)
  ].join(" ");
  const caps = modelCapabilityTags(option);
  if (caps.some((tag) => THREE_D_CAPABILITY_RE.test(tag) || tag === "3d")) return true;
  return THREE_D_MODEL_NAME_RE.test(haystack);
}

export function isOcrCapableModel(
  option: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">
): boolean {
  const haystack = [
    String(option.model || ""),
    String(option.label || ""),
    String(option.provider || ""),
    ...modelCapabilityTags(option)
  ].join(" ");
  const caps = modelCapabilityTags(option);
  if (caps.some((tag) => OCR_CAPABILITY_RE.test(tag) || tag.includes("ocr"))) return true;
  return OCR_MODEL_NAME_RE.test(haystack);
}

/** OCR / embedding / TTS / character / video-gen / music / 3D models reject normal chat+tools payloads. */
export function isSpecializedNonChatModel(
  option: Pick<AuthorizedModelOption, "model" | "provider" | "capabilities" | "label" | "routing">
): boolean {
  if (isImageGenerationCapableModel(option)) return true;
  if (isVideoCapableModel(option)) return true;
  if (isMusicCapableModel(option)) return true;
  if (is3dCapableModel(option)) return true;
  if (isOcrCapableModel(option)) return true;
  const haystack = [
    String(option.model || ""),
    String(option.label || ""),
    String(option.provider || ""),
    ...modelCapabilityTags(option)
  ].join(" ");
  return /(?:^|[^a-z0-9])(?:ocr|embedding|embed|rerank|tts|asr|whisper|speech|realtime-audio|image-gen|imagen|dall-?e|flux|character|seed-character)(?:[^a-z0-9]|$)/i
    .test(haystack);
}

/** Models eligible for Auto constraint solving (active routing profile required). */
export function isAutoRoutingEligible(option: AuthorizedModelOption): boolean {
  return option.routing?.schema_version === 1 && option.routing.status === "active";
}

export function filterAutoRoutingPool(available: AuthorizedModelOption[]): AuthorizedModelOption[] {
  return available
    .filter((item) => String(item.model || "").trim())
    .map((item) => ensureRoutingProfile(item))
    .filter((item) => isAutoRoutingEligible(item));
}

function permissionProfileForMode(mode: AutoMode, permissionMode?: string): AutoDecision["permission_profile"] {
  if (mode === "full" || permissionMode === "full") return "full";
  if (mode === "auto_strict" || permissionMode === "approval") return "approval";
  if (mode === "auto" || permissionMode === "agent") return "auto_review";
  return "approval";
}

function optimizeWeights(optimizeFor: OptimizeFor): { quality: number; cost: number; maxCascadeTiers: number } {
  // Effectiveness first: cost is secondary unless Optimize=cost.
  // balanced = 均衡 (效果优先、成本次之); intelligence = 效果优先 (stronger quality bias).
  if (optimizeFor === "cost") return { quality: 0.45, cost: 1.1, maxCascadeTiers: 1 };
  if (optimizeFor === "intelligence") return { quality: 1.75, cost: 0.08, maxCascadeTiers: 3 };
  return { quality: 1.45, cost: 0.18, maxCascadeTiers: 2 };
}

function modelHasRoles(option: AuthorizedModelOption, required: ModelRoutingRole[]): boolean {
  if (!required.length) return true;
  const roles = new Set(option.routing?.roles ?? []);
  return required.every((role) => roles.has(role));
}

function modelHasCapabilities(option: AuthorizedModelOption, required: string[]): boolean {
  if (!required.length) return true;
  const caps = new Set(modelCapabilityTags(option));
  return required.every((cap) => caps.has(cap.toLowerCase()));
}

function scoreRoutingModel(input: {
  option: AuthorizedModelOption;
  taskClass: AutoTaskClass;
  optimizeFor: OptimizeFor;
  defaultModel?: string;
  preferLight?: boolean;
}): number {
  const weights = optimizeWeights(input.optimizeFor);
  let score =
    taskQualityScore(input.option, input.taskClass) * weights.quality
    - unitTokenPricePerMillion(input.option) * weights.cost;
  const defaultId = String(input.defaultModel || "").trim().toLowerCase();
  const tier = input.option.routing?.tier ?? 1;
  if (
    defaultId
    && input.option.model.toLowerCase() === defaultId
    && (input.optimizeFor === "cost" || input.optimizeFor === "balanced")
    && tier === 1
  ) {
    score += 25;
  }
  const name = `${input.option.model} ${input.option.label || ""}`;
  const lightName = /flash|lite|mini|small|haiku|seed|turbo|fast/i.test(name);
  const heavyName = /(?:^|[^a-z0-9])(?:pro|max|opus|ultra|reasoner|\br1\b|sonnet)(?:[^a-z0-9]|$)/i.test(name);
  if (input.preferLight === true) {
    if (lightName) score += 18;
    if (heavyName) score -= 10;
  } else if (input.preferLight === false) {
    if (heavyName) score += 22;
    if (lightName) score -= 14;
  }
  return score;
}

function applyConstraintFilters(
  pool: AuthorizedModelOption[],
  constraint: RoutingConstraint
): AuthorizedModelOption[] {
  let next = pool.filter((item) => (item.routing?.tier ?? 1) >= constraint.min_tier);
  next = next.filter((item) => modelHasRoles(item, constraint.roles));
  next = next.filter((item) => modelHasCapabilities(item, constraint.capabilities));
  return next;
}

function buildFallbackChain(input: {
  selected: AuthorizedModelOption;
  pool: AuthorizedModelOption[];
  taskClass: AutoTaskClass;
  optimizeFor: OptimizeFor;
  defaultModel?: string;
  maxFallback: number;
}): string[] {
  const selectedTier = input.selected.routing?.tier ?? 1;
  const maxCascade = optimizeWeights(input.optimizeFor).maxCascadeTiers;
  const maxTier = Math.min(3, selectedTier + maxCascade);
  return [...input.pool]
    .filter((item) => item.model.toLowerCase() !== input.selected.model.toLowerCase())
    .filter((item) => {
      const tier = item.routing?.tier ?? 1;
      return tier >= selectedTier && tier <= maxTier;
    })
    .sort((left, right) => {
      const tierDelta = (left.routing?.tier ?? 1) - (right.routing?.tier ?? 1);
      if (tierDelta !== 0) return tierDelta;
      return (
        scoreRoutingModel({
          option: right,
          taskClass: input.taskClass,
          optimizeFor: input.optimizeFor,
          defaultModel: input.defaultModel
        })
        - scoreRoutingModel({
          option: left,
          taskClass: input.taskClass,
          optimizeFor: input.optimizeFor,
          defaultModel: input.defaultModel
        })
      );
    })
    .map((item) => item.model)
    .slice(0, Math.max(0, input.maxFallback));
}

function evaluatePinnedAgainstConstraint(
  selected: AuthorizedModelOption,
  constraint: RoutingConstraint,
  hasImages: boolean
): string[] {
  const warnings: string[] = [];
  const tier = selected.routing?.tier;
  if (constraint.min_tier > 1) {
    if (tier == null || tier < constraint.min_tier) {
      warnings.push(
        `当前固定模型可能不满足技能要求（需要 tier>=${constraint.min_tier}），建议改用 Auto 或更换模型`
      );
    }
  }
  if (constraint.roles.length && selected.routing) {
    if (!modelHasRoles(selected, constraint.roles)) {
      warnings.push(
        `当前固定模型角色可能不满足技能要求（需要 ${constraint.roles.join(",")}）`
      );
    }
  } else if (constraint.roles.length && !selected.routing) {
    warnings.push("当前固定模型缺少路由画像，可能无法确认是否满足技能角色要求");
  }
  const missingCaps = constraint.capabilities.filter(
    (cap) => !modelCapabilityTags(selected).includes(cap.toLowerCase())
  );
  if (missingCaps.length) {
    warnings.push(`当前固定模型可能缺少能力：${missingCaps.join(", ")}`);
  }
  if (hasImages && !isVisionCapableModel(selected)) {
    warnings.push("当前固定模型不支持识图，将尝试描述桥接或可能无法理解图片");
  }
  return warnings;
}

function baseDecisionFields(input: {
  mode: AutoMode;
  runId: string;
  threadId: string;
  latestUserText?: string;
  nowIso?: () => string;
  permissionMode?: "full" | "approval" | "agent";
  policyEtag?: string;
  degraded?: boolean;
  reasoningEffort?: string;
  selectedSkillNames?: string[];
  automaticSkillNames?: string[];
  taskClass: AutoTaskClass;
  optimizeFor?: OptimizeFor;
  constraint?: RoutingConstraint;
}): Pick<
  AutoDecision,
  | "schema_version"
  | "mode"
  | "decided_at"
  | "run_id"
  | "thread_id"
  | "input_fingerprint"
  | "reasoning"
  | "skills"
  | "permission_profile"
  | "allow_auto_delegate"
  | "policy_etag"
  | "degraded"
  | "task_class"
  | "routing_tier"
  | "optimize_for"
  | "constraint_summary"
  | "skill_scopes_applied"
> {
  const effort = String(input.reasoningEffort || "medium");
  const governmentEnabled = (input.selectedSkillNames ?? []).some((name) =>
    String(name || "").toLowerCase().includes("government")
  );
  return {
    schema_version: 1,
    mode: input.mode,
    decided_at: (input.nowIso ?? (() => new Date().toISOString()))(),
    run_id: input.runId,
    thread_id: input.threadId,
    input_fingerprint: fingerprint(String(input.latestUserText || "").slice(0, 4000)),
    reasoning: {
      effort: input.mode === "manual" ? effort : "auto",
      summary: "auto",
      resolved_effort: effort
    },
    skills: {
      explicit: [...(input.selectedSkillNames ?? [])],
      automatic: [...(input.automaticSkillNames ?? [])],
      government_enabled: governmentEnabled
    },
    permission_profile: permissionProfileForMode(input.mode, input.permissionMode),
    allow_auto_delegate: input.mode === "auto" || input.mode === "full",
    policy_etag: input.policyEtag || "local-default",
    degraded: Boolean(input.degraded),
    task_class: input.taskClass,
    routing_tier: routingTierForTaskClass(input.taskClass),
    ...(input.optimizeFor ? { optimize_for: input.optimizeFor } : {}),
    ...(input.constraint
      ? {
          constraint_summary: input.constraint.summary,
          skill_scopes_applied: input.constraint.skill_scopes_applied
        }
      : {})
  };
}

export function resolvePinnedModelDecision(input: {
  requestedModel: string;
  availableModels: AuthorizedModelOption[];
  latestUserText?: string;
  selectedSkillNames?: string[];
  skillRoutingHints?: SkillRoutingHint[];
  skillScopes?: Partial<Record<string, SkillRoutingScope>>;
  permissionMode?: "full" | "approval" | "agent";
  reasoningEffort?: string;
  runId: string;
  threadId: string;
  nowIso?: () => string;
  policyEtag?: string;
  degraded?: boolean;
  hasImageAttachments?: boolean;
}): AutoDecision {
  const available = input.availableModels.filter((item) => String(item.model || "").trim());
  if (!available.length) {
    throw new Error("Auto could not select a model because no authorized models are available.");
  }
  const requested = String(input.requestedModel || "").trim();
  const selectedModel = available.find(
    (item) => item.model.toLowerCase() === requested.toLowerCase()
  );
  if (!selectedModel) {
    throw new Error(PINNED_MODEL_MISSING_MESSAGE);
  }

  const hints = buildSkillRoutingHints({
    selectedSkillNames: input.selectedSkillNames,
    skillScopes: input.skillScopes,
    explicitHints: input.skillRoutingHints
  });
  const constraint = mergeSkillRoutingHints(hints);
  const taskClass = constraint.task_class
    ?? classifyAutoTaskClass({
      text: input.latestUserText,
      selectedSkillNames: input.selectedSkillNames
    });
  const warnings = evaluatePinnedAgainstConstraint(
    selectedModel,
    constraint,
    Boolean(input.hasImageAttachments)
  );

  return {
    ...baseDecisionFields({
      mode: "manual",
      runId: input.runId,
      threadId: input.threadId,
      latestUserText: input.latestUserText,
      nowIso: input.nowIso,
      permissionMode: input.permissionMode,
      policyEtag: input.policyEtag,
      degraded: input.degraded,
      reasoningEffort: input.reasoningEffort,
      selectedSkillNames: input.selectedSkillNames,
      taskClass,
      constraint
    }),
    model: {
      requested,
      selected: selectedModel.model,
      reason_codes: ["user_model_pinned"],
      fallback_chain: [],
      fallback_index: 0
    },
    notes: warnings.length ? warnings.join("；") : `Pinned model ${selectedModel.model}`,
    ...(warnings.length ? { warnings } : {})
  };
}

export function resolveAutoConstraintDecision(input: {
  availableModels: AuthorizedModelOption[];
  latestUserText?: string;
  selectedSkillNames?: string[];
  skillRoutingHints?: SkillRoutingHint[];
  skillScopes?: Partial<Record<string, SkillRoutingScope>>;
  permissionMode?: "full" | "approval" | "agent";
  reasoningEffort?: string;
  runId: string;
  threadId: string;
  mode?: AutoMode;
  nowIso?: () => string;
  policyEtag?: string;
  degraded?: boolean;
  maxFallback?: number;
  defaultModel?: string;
  hasImageAttachments?: boolean;
  optimizeFor?: OptimizeFor;
}): AutoDecision {
  const available = input.availableModels.filter((item) => String(item.model || "").trim());
  if (!available.length) {
    throw new Error("Auto could not select a model because no authorized models are available.");
  }

  const optimizeFor = normalizeOptimizeFor(input.optimizeFor);
  const mode: AutoMode = input.mode ?? "auto";
  const direct = shouldMainAgentHandleDirectly({
    latestUserText: input.latestUserText,
    selectedSkillNames: input.selectedSkillNames,
    hasImageAttachments: input.hasImageAttachments
  });
  let subscriptionSafeDefault = String(input.defaultModel || "").trim();
  const blockedDefaultAgentCodes: string[] = [];
  if (direct.direct) {
    const defaultId = subscriptionSafeDefault;
    const defaultInSubscription = !defaultId
      ? true
      : available.some((item) => item.model.toLowerCase() === defaultId.toLowerCase());
    // Auto default agent model must be in the user's plan before the main-agent
    // "direct" preference applies. Out-of-plan defaults must not short-circuit
    // (would risk answering without an authorized, billable model).
    if (defaultId && !defaultInSubscription) {
      // Fall through to constraint / degraded routing among authorized models only.
      // Drop the out-of-plan default so later picks cannot prefer it.
      blockedDefaultAgentCodes.push(
        "default_agent_not_in_subscription",
        "skip_unsubscribed_default_agent"
      );
      subscriptionSafeDefault = "";
    } else {
      const mainModel = pickMainAgentModel(available, subscriptionSafeDefault || undefined);
      if (!mainModel) {
        throw new Error(AUTO_NO_ROUTING_POOL_MESSAGE);
      }
      const fallbackChain = available
        .map((item) => item.model)
        .filter((model) => model.toLowerCase() !== mainModel.model.toLowerCase())
        .slice(0, Math.max(0, input.maxFallback ?? 3));
      const orchestrator = buildOrchestratorTrace({
        intent: direct.intent,
        handledBy: "main",
        canHandleDirectly: true,
        reasonCodes: [
          ...direct.reasonCodes,
          ...(defaultId ? ["default_agent_in_subscription"] : ["default_agent_unset_use_pool"])
        ]
      });
      return {
        ...baseDecisionFields({
          mode,
          runId: input.runId,
          threadId: input.threadId,
          latestUserText: input.latestUserText,
          nowIso: input.nowIso,
          permissionMode: input.permissionMode,
          policyEtag: input.policyEtag,
          degraded: false,
          reasoningEffort: input.reasoningEffort,
          selectedSkillNames: input.selectedSkillNames,
          taskClass: "chat",
          optimizeFor
        }),
        allow_auto_delegate: false,
        model: {
          requested: MODEL_AUTO_ID,
          selected: mainModel.model,
          reason_codes: [...direct.reasonCodes, "main_agent_model", "subscription_authorized"],
          fallback_chain: fallbackChain,
          fallback_index: 0
        },
        notes: `Main agent handles simple chat with subscription model ${mainModel.model}`,
        orchestrator
      };
    }
  }

  const eligible = filterAutoRoutingPool(available);
  if (!eligible.length) {
    // Authorized models exist, but none have completed routing profiles yet.
    // Prefer a temporary manual-like pick over hard-failing simple chats.
    // Video asks prefer video models (or tool-capable pro), never vision-only chat.
    // Image turns still prefer a vision-capable authorized model when available.
    const preferVideo = looksLikeVideoGenerationRequest(input.latestUserText);
    const preferMusic = looksLikeMusicGenerationRequest(input.latestUserText);
    const prefer3d = looksLike3dGenerationRequest(input.latestUserText);
    const preferOcr = looksLikeOcrRequest(input.latestUserText) && Boolean(input.hasImageAttachments);
    const preferVision = Boolean(input.hasImageAttachments) && !preferVideo && !preferOcr;
    const taskClass = classifyAutoTaskClass({
      text: input.latestUserText,
      selectedSkillNames: input.selectedSkillNames
    });
    const autoDelegateHeavy = shouldAutoDelegateHeavyWork({
      taskClass,
      latestUserText: input.latestUserText
    });
    const preferLight = preferVideo || preferMusic || prefer3d || preferOcr
      ? false
      : autoDelegateHeavy
        ? true
        : prefersLightAutoModel({
            taskClass,
            optimizeFor,
            latestUserText: input.latestUserText
          });
    const chatPool = available.filter((item) => !isSpecializedNonChatModel(item));
    const videoFallbackPool = preferVideo
      ? available.filter((item) => isVideoCapableModel(item))
      : [];
    const musicFallbackPool = preferMusic
      ? available.filter((item) => isMusicCapableModel(item))
      : [];
    const threeDFallbackPool = prefer3d
      ? available.filter((item) => is3dCapableModel(item))
      : [];
    const ocrFallbackPool = preferOcr
      ? available.filter((item) => isOcrCapableModel(item))
      : [];
    const visionFallbackPool = preferVision
      ? available.filter((item) => isVisionCapableModel(item) && !isSpecializedNonChatModel(item))
      : [];
    const selectionPool = videoFallbackPool.length
      ? videoFallbackPool
      : musicFallbackPool.length
        ? musicFallbackPool
        : threeDFallbackPool.length
          ? threeDFallbackPool
          : ocrFallbackPool.length
            ? ocrFallbackPool
            : visionFallbackPool.length
              ? visionFallbackPool
              : (chatPool.length ? chatPool : available);
    const fallback = pickParentAgentModelForTask({
      availableModels: selectionPool,
      taskClass,
      optimizeFor,
      latestUserText: input.latestUserText,
      defaultModel: subscriptionSafeDefault || undefined,
      preferLight: preferVision ? false : preferLight
    }) ?? pickMainAgentModel(selectionPool, subscriptionSafeDefault || undefined);
    if (!fallback) {
      throw new Error(AUTO_NO_ROUTING_POOL_MESSAGE);
    }
    const fallbackChain = selectionPool
      .map((item) => item.model)
      .filter((model) => model.toLowerCase() !== fallback.model.toLowerCase())
      .slice(0, Math.max(0, input.maxFallback ?? 3));
    const strengthCode = preferVideo
      ? (videoFallbackPool.length ? "video_capable" : "video_model_unavailable_use_tools")
      : preferVision
        ? "vision_capable"
        : autoDelegateHeavy
          ? "prefer_flash_for_orchestrator"
          : preferLight
            ? "prefer_flash_for_light_task"
            : "prefer_pro_for_heavy_task";
    const modeNote = videoFallbackPool.length
      ? "（视频）"
      : visionFallbackPool.length
        ? "（识图）"
        : preferVideo
          ? "（高质量·视频任务）"
          : preferLight
            ? "（轻量）"
            : "（高质量）";
    const orchestrator = buildOrchestratorTrace({
      intent: direct.intent,
      handledBy: autoDelegateHeavy ? "router" : "main",
      canHandleDirectly: false,
      reasonCodes: [
        ...direct.reasonCodes,
        ...blockedDefaultAgentCodes,
        "routing_pool_empty",
        "degraded_first_available",
        strengthCode,
        ...(autoDelegateHeavy ? ["auto_orchestrator_delegate_first"] : []),
        ...(videoFallbackPool.length
          ? ["requires_video", "video_capable"]
          : preferVideo
            ? ["needs_video_gen_channel", "video_model_unavailable_use_tools"]
            : musicFallbackPool.length
              ? ["requires_music", "music_capable"]
              : threeDFallbackPool.length
                ? ["requires_3d", "three_d_capable"]
                : ocrFallbackPool.length
                  ? ["requires_ocr", "ocr_capable"]
                  : visionFallbackPool.length
                    ? ["requires_vision", "vision_capable"]
                    : preferVision
                      ? ["vision_unavailable_use_bridge"]
                      : [])
      ]
    });
    return {
      ...baseDecisionFields({
        mode,
        runId: input.runId,
        threadId: input.threadId,
        latestUserText: input.latestUserText,
        nowIso: input.nowIso,
        permissionMode: input.permissionMode,
        policyEtag: input.policyEtag,
        degraded: true,
        reasoningEffort: input.reasoningEffort,
        selectedSkillNames: input.selectedSkillNames,
        taskClass,
        optimizeFor
      }),
      model: {
        requested: MODEL_AUTO_ID,
        selected: fallback.model,
        reason_codes: [
          ...blockedDefaultAgentCodes,
          "routing_pool_empty",
          "degraded_first_available",
          "subscription_authorized",
          strengthCode,
          `task_class=${taskClass}`,
          ...(videoFallbackPool.length
            ? ["requires_video", "video_capable"]
            : preferVideo
              ? ["needs_video_gen_channel", "video_model_unavailable_use_tools"]
              : musicFallbackPool.length
                ? ["requires_music", "music_capable"]
                : threeDFallbackPool.length
                  ? ["requires_3d", "three_d_capable"]
                  : ocrFallbackPool.length
                    ? ["requires_ocr", "ocr_capable"]
                    : visionFallbackPool.length
                      ? ["requires_vision", "vision_capable"]
                      : preferVision
                        ? ["vision_unavailable_use_bridge"]
                        : [])
        ],
        fallback_chain: fallbackChain,
        fallback_index: 0
      },
      notes: `${AUTO_NO_ROUTING_POOL_MESSAGE}；已临时使用套餐内模型 ${fallback.model}${modeNote}`,
      warnings: [AUTO_NO_ROUTING_POOL_MESSAGE, `已临时使用套餐内模型 ${fallback.model}`],
      orchestrator
    };
  }

  const hints = buildSkillRoutingHints({
    selectedSkillNames: input.selectedSkillNames,
    skillScopes: input.skillScopes,
    explicitHints: input.skillRoutingHints
  });
  const constraint = mergeSkillRoutingHints(hints);
  const taskClass = constraint.task_class
    ?? classifyAutoTaskClass({
      text: input.latestUserText,
      selectedSkillNames: input.selectedSkillNames
    });

  const preferVideo = looksLikeVideoGenerationRequest(input.latestUserText);
  const preferImage = looksLikeImageGenerationRequest(input.latestUserText) && !preferVideo;
  const preferMusic = looksLikeMusicGenerationRequest(input.latestUserText);
  const prefer3d = looksLike3dGenerationRequest(input.latestUserText);
  const preferOcr = looksLikeOcrRequest(input.latestUserText) && Boolean(input.hasImageAttachments);
  const preferVision = Boolean(input.hasImageAttachments) && !preferVideo && !preferImage && !preferOcr;
  const autoDelegateHeavy = shouldAutoDelegateHeavyWork({
    taskClass,
    latestUserText: input.latestUserText
  });
  const videoEligible = eligible.filter((item) => isVideoCapableModel(item));
  const imageEligible = eligible.filter((item) => isImageGenerationCapableModel(item));
  const musicEligible = eligible.filter((item) => isMusicCapableModel(item));
  const threeDEligible = eligible.filter((item) => is3dCapableModel(item));
  const ocrEligible = eligible.filter((item) => isOcrCapableModel(item));
  const visionEligible = eligible.filter((item) => isVisionCapableModel(item) && !isSpecializedNonChatModel(item));
  const requireVideo = preferVideo && videoEligible.length > 0;
  const requireImage = preferImage && imageEligible.length > 0;
  const requireMusic = preferMusic && musicEligible.length > 0;
  const require3d = prefer3d && threeDEligible.length > 0;
  const requireOcr = preferOcr && ocrEligible.length > 0;
  const requireVision = preferVision && visionEligible.length > 0;
  // Vision preference is applied by pool pre-filter (isVisionCapableModel), not by
  // requiring a literal "vision" capability tag (tags vary across providers).
  const basePool = requireVideo
    ? videoEligible
    : requireImage
      ? imageEligible
      : requireMusic
        ? musicEligible
        : require3d
          ? threeDEligible
          : requireOcr
            ? ocrEligible
            : requireVision
              ? visionEligible
              : eligible;
  // Specialty pools keep specialized targets; otherwise exclude OCR/TTS/video-gen from chat.
  const chatPool = requireVideo || requireImage || requireMusic || require3d || requireOcr || requireVision
    ? basePool
    : basePool.filter((item) => !isSpecializedNonChatModel(item));
  const constrained = applyConstraintFilters(chatPool.length ? chatPool : basePool, constraint);

  if (!constrained.length) {
    throw new Error(
      `${AUTO_NO_CONSTRAINT_MATCH_MESSAGE}（${constraint.summary || "constraints"}）`
    );
  }

  const preferLight = preferVideo || preferImage || preferMusic || prefer3d || preferOcr
    ? false
    : autoDelegateHeavy
      ? true
      : prefersLightAutoModel({
          taskClass,
          optimizeFor,
          latestUserText: input.latestUserText
        });
  const ranked = [...constrained].sort((left, right) => {
    // Heavy/general delivery: effectiveness first, cost only as a near-tie breaker.
    if (!preferVision && preferLight === false) {
      const byEffect = compareModelsByEffectivenessThenCost({
        left,
        right,
        taskClass,
        optimizeFor
      });
      if (byEffect !== 0) return byEffect;
    }
    const scoreDelta =
      scoreRoutingModel({
        option: right,
        taskClass,
        optimizeFor,
        defaultModel: subscriptionSafeDefault || undefined,
        preferLight: preferVision || preferVideo || preferImage || preferMusic || prefer3d || preferOcr ? false : preferLight
      })
      - scoreRoutingModel({
        option: left,
        taskClass,
        optimizeFor,
        defaultModel: subscriptionSafeDefault || undefined,
        preferLight: preferVision || preferVideo || preferImage || preferMusic || prefer3d || preferOcr ? false : preferLight
      });
    if (scoreDelta !== 0) return scoreDelta;
    return compareModelsByEffectivenessThenCost({
      left,
      right,
      taskClass,
      optimizeFor
    }) || left.model.localeCompare(right.model);
  });
  const selectedModel = autoDelegateHeavy
    ? (pickParentAgentModelForTask({
        availableModels: constrained,
        taskClass,
        optimizeFor,
        latestUserText: input.latestUserText,
        defaultModel: subscriptionSafeDefault || undefined,
        preferLight: true
      }) ?? ranked[0])
    : ranked[0];
  const reasonCodes = [
    ...blockedDefaultAgentCodes,
    `task_class=${taskClass}`,
    `routing_tier=${routingTierForTaskClass(taskClass)}`,
    `optimize_for=${optimizeFor}`,
    "constraint_solver",
    "subscription_authorized",
    "quality_first_cost_secondary",
    preferVideo
      ? (requireVideo ? "video_capable" : "video_model_unavailable_use_tools")
      : preferImage
        ? (requireImage ? "image_capable" : "image_model_unavailable")
        : preferMusic
          ? (requireMusic ? "music_capable" : "music_model_unavailable")
          : prefer3d
            ? (require3d ? "three_d_capable" : "three_d_model_unavailable")
            : preferOcr
              ? (requireOcr ? "ocr_capable" : "ocr_model_unavailable_use_vision")
              : preferVision
                ? "vision_capable"
                : autoDelegateHeavy
                  ? "prefer_flash_for_orchestrator"
                  : preferLight
                    ? "prefer_flash_for_light_task"
                    : "prefer_pro_for_heavy_task"
  ];
  if (autoDelegateHeavy) reasonCodes.push("auto_orchestrator_delegate_first");
  if (requireVideo) reasonCodes.push("requires_video", "video_capable");
  else if (preferVideo) reasonCodes.push("needs_video_gen_channel", "prefer_pro_for_video_task");
  if (requireImage) reasonCodes.push("requires_image", "image_capable");
  else if (preferImage) reasonCodes.push("needs_image_gen_channel");
  if (requireMusic) reasonCodes.push("requires_music", "music_capable");
  if (require3d) reasonCodes.push("requires_3d", "three_d_capable");
  if (requireOcr) reasonCodes.push("requires_ocr", "ocr_capable");
  if (requireVision) reasonCodes.push("requires_vision", "vision_capable");
  else if (preferVision) reasonCodes.push("vision_unavailable_use_bridge");
  if (constraint.summary && constraint.summary !== "none") {
    reasonCodes.push(`constraint=${constraint.summary}`);
  }

  const maxFallback = Math.max(0, input.maxFallback ?? 3);
  const fallbackChain = buildFallbackChain({
    selected: selectedModel,
    pool: constrained,
    taskClass,
    optimizeFor,
    defaultModel: subscriptionSafeDefault || undefined,
    maxFallback
  });

  const orchestrator = buildOrchestratorTrace({
    intent: direct.intent,
    handledBy: "router",
    canHandleDirectly: false,
    reasonCodes: [
      ...direct.reasonCodes,
      ...blockedDefaultAgentCodes,
      ...reasonCodes,
      ...(autoDelegateHeavy ? ["handled_by_orchestrator"] : [])
    ]
  });
  return {
    ...baseDecisionFields({
      mode,
      runId: input.runId,
      threadId: input.threadId,
      latestUserText: input.latestUserText,
      nowIso: input.nowIso,
      permissionMode: input.permissionMode,
      policyEtag: input.policyEtag,
      degraded: input.degraded,
      reasoningEffort: input.reasoningEffort,
      selectedSkillNames: input.selectedSkillNames,
      taskClass,
      optimizeFor,
      constraint
    }),
    model: {
      requested: MODEL_AUTO_ID,
      selected: selectedModel.model,
      reason_codes: reasonCodes,
      fallback_chain: fallbackChain,
      fallback_index: 0
    },
    notes: `Model Auto selected subscription model ${selectedModel.model} for ${taskClass} (${optimizeFor})${requireVideo ? " with video" : requireVision ? " with vision" : preferVideo ? " for video task" : ""}`,
    orchestrator
  };
}

export function resolveModelAutoDecision(input: {
  requestedModel: string;
  availableModels: AuthorizedModelOption[];
  latestUserText?: string;
  selectedSkillNames?: string[];
  skillRoutingHints?: SkillRoutingHint[];
  skillScopes?: Partial<Record<string, SkillRoutingScope>>;
  permissionMode?: "full" | "approval" | "agent";
  reasoningEffort?: string;
  runId: string;
  threadId: string;
  mode?: AutoMode;
  nowIso?: () => string;
  policyEtag?: string;
  degraded?: boolean;
  maxFallback?: number;
  /** Preferred first-answer model when Auto picks a light/cost path (non-auto config). */
  defaultModel?: string;
  /** When true, Auto prefers vision-capable models when available. */
  hasImageAttachments?: boolean;
  optimizeFor?: OptimizeFor;
}): AutoDecision {
  const requested = String(input.requestedModel || "").trim() || MODEL_AUTO_ID;
  if (!isModelAutoSelection(requested)) {
    return resolvePinnedModelDecision({
      ...input,
      requestedModel: requested
    });
  }
  return resolveAutoConstraintDecision({
    ...input,
    mode: input.mode ?? "auto"
  });
}

/** Auth / policy failures must not be papered over by switching models. */
export function isAutoModelFallbackBlocked(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /HTTP\s+(?:401|403)\b|unauthorized|forbidden|内容策略|content.?policy|login session|重新登录|Model request aborted|当前任务已停止/i.test(
    message
  );
}

/**
 * Abnormal model-step failures that Auto may recover from by advancing
 * `fallback_chain` (empty/idle/timeout/gateway/transient).
 */
export function isAbnormalModelStepError(error: unknown): boolean {
  if (isAutoModelFallbackBlocked(error)) return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /HTTP\s+(?:429|500|502|503|504)\b|可重试|retry|timeout|timed out|aborted due to timeout|fetch failed|failed to fetch|econnreset|econnrefused|enotfound|eai_again|und_err_connect_timeout|und_err_headers_timeout|und_err_body_timeout|无法连接模型网关|连接模型网关超时|stream inactive|did not include assistant content or tool calls|stream ended before a terminal event|stream timed out before producing output|Model step did not return a response/i.test(
    message
  );
}

/**
 * Advance AutoDecision.fallback_index (0 = primary `selected`) onto the next
 * entry of `fallback_chain`. Returns null when the chain is exhausted.
 */
export function advanceAutoModelFallback(input: {
  selected: string;
  fallback_chain: string[];
  fallback_index: number;
}): { model: string; fallback_index: number } | null {
  const chain = (input.fallback_chain ?? [])
    .map((model) => String(model || "").trim())
    .filter(Boolean);
  const nextIndex = Math.max(0, Number(input.fallback_index) || 0) + 1;
  if (nextIndex > chain.length) return null;
  const model = chain[nextIndex - 1];
  if (!model || model.toLowerCase() === String(input.selected || "").trim().toLowerCase()) {
    if (nextIndex >= chain.length) return null;
    const skipped = chain[nextIndex];
    if (!skipped) return null;
    return { model: skipped, fallback_index: nextIndex + 1 };
  }
  return { model, fallback_index: nextIndex };
}

export function isAutoModelFallbackEnabled(decision: {
  mode?: string;
  model?: { requested?: string; fallback_chain?: string[] };
} | null | undefined): boolean {
  if (!decision) return false;
  const requested = String(decision.model?.requested || "").trim().toLowerCase();
  const mode = String(decision.mode || "").trim().toLowerCase();
  const hasChain = (decision.model?.fallback_chain ?? []).some((item) => String(item || "").trim());
  // Pinned / manual must never cascade to another model.
  if (mode === "manual" || (requested && requested !== MODEL_AUTO_ID && mode !== "auto" && mode !== "auto_strict" && mode !== "full")) {
    return false;
  }
  return hasChain && (mode === "auto" || mode === "auto_strict" || mode === "full" || requested === MODEL_AUTO_ID);
}
