import type { AutoDecision } from "./model-auto-router.ts";
import {
  formatMediaGenerationReply,
  runAutoMediaTool,
  runMediaGenerationJob,
  toolNameForMediaKind,
  type AutoMediaToolName,
  type MediaGenerationKind,
  type GenerationJobSnapshot
} from "./media-generation-gateway.ts";

export type MediaGenerationTurnDeps = {
  gatewayBaseUrl: string;
  bearerToken: string;
  model: string;
  prompt: string;
  imageUrl?: string;
  /** Optional last-frame image URL (MiniMax H3 role=last_frame). */
  lastFrameImageUrl?: string;
  kind: MediaGenerationKind;
  requestId: string;
  workspaceId?: string;
  threadId?: string;
  turnId?: string;
  /** Prefer spring-app Auto tools when set (image_generate / video_generate). */
  toolName?: AutoMediaToolName | string;
  /** Forwarded to video_generate / image_generate as spring-app `size` (e.g. 1920x1080). */
  size?: string;
  mediaExecution?: "server" | "client";
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (job: GenerationJobSnapshot) => void;
  onJobId?: (mediaJobId: string) => void;
  onCorrelationMismatch?: (message: string) => void;
  pollIntervalMs?: number;
};

/**
 * Run spring-app media channel when Auto selected a specialty model
 * (`requires_*` / `*_capable`) OR server-authoritative Auto set primary_channel
 * to a media specialty (spring-app already hard-fails when no image/video model).
 * Do not trigger on intent-only local codes like `needs_image_gen_channel` alone
 * without server authority or requires_* — that used to call media APIs with flash.
 */
export function resolveMediaGenerationKind(input: {
  autoDecision?: AutoDecision;
  latestUserText?: string;
}): MediaGenerationKind | null {
  const reasons = input.autoDecision?.model.reason_codes ?? [];
  const has = (...needles: string[]) =>
    reasons.some((code) => needles.includes(String(code || "").trim()));
  const serverAuto = has("server_authoritative_auto");
  const channel = String(input.autoDecision?.orchestrator?.primary_channel || "").trim();
  const mediaTool = input.autoDecision?.media_tool;
  const mediaKindFromTool = String(mediaTool?.media_kind || "").trim();
  const toolName = String(mediaTool?.tool_name || "").trim();

  if (
    mediaKindFromTool === "image"
    || toolName === "image_generate"
    || has("requires_image", "image_capable", "local_media_intent_override")
    || (serverAuto && channel === "image_gen")
  ) {
    return "image";
  }
  if (
    mediaKindFromTool === "video"
    || toolName === "video_generate"
    || has("requires_video", "video_capable")
    || (serverAuto && channel === "video_gen")
  ) {
    return "video";
  }
  if (has("requires_music", "music_capable") || (serverAuto && channel === "music_gen")) {
    return "music";
  }
  if (has("requires_3d", "three_d_capable") || (serverAuto && channel === "three_d_gen")) {
    return "3d";
  }
  return null;
}

export function shouldRunMediaGenerationTurn(input: {
  autoDecision?: AutoDecision;
}): boolean {
  return resolveMediaGenerationKind(input) != null;
}

export function resolveAutoMediaToolName(input: {
  kind: MediaGenerationKind;
  toolName?: string;
  autoDecision?: AutoDecision;
}): AutoMediaToolName | null {
  const fromDecision = String(input.autoDecision?.media_tool?.tool_name || "").trim();
  const candidate = String(input.toolName || fromDecision || "").trim();
  if (candidate === "image_generate" || candidate === "video_generate" || candidate === "music_generate") {
    return candidate;
  }
  return toolNameForMediaKind(input.kind);
}

/**
 * Execute media turn via spring-app Auto tools when possible; legacy specialty
 * HTTP paths remain as fallback for music/3d or older gateways without /auto/tools.
 */
export async function executeMediaGenerationTurn(
  input: MediaGenerationTurnDeps
): Promise<{ content: string; job: GenerationJobSnapshot; via: "auto_tools" | "legacy" }> {
  const toolName = resolveAutoMediaToolName({
    kind: input.kind,
    toolName: input.toolName
  });
  // image_generate/video_generate are server-owned Spring Auto tools. An
  // orchestrator's historical `execution: client` hint describes who starts
  // the call; it must not bypass Auto and send the desktop to legacy
  // /images/generations or /videos routes.
  const preferServerTools = toolName != null
    && (input.kind === "image" || input.kind === "video" || input.kind === "music");
  const rememberJobId = (job: GenerationJobSnapshot) => {
    const mediaJobId = String(job.id || "").trim();
    if (mediaJobId) input.onJobId?.(mediaJobId);
  };

  if (preferServerTools && toolName) {
    try {
      // OpenClaw-style: submit immediately (wait=false), then poll job with progress.
      const result = await runAutoMediaTool({
        gatewayBaseUrl: input.gatewayBaseUrl,
        bearerToken: input.bearerToken,
        toolName,
        prompt: input.prompt,
        model: input.model,
        imageUrl: input.imageUrl,
        lastFrameImageUrl: input.lastFrameImageUrl,
        size: input.size,
        idempotencyKey: `newbrain-${input.requestId}`,
        wait: false,
        pollIntervalMs: input.pollIntervalMs,
        signal: input.signal,
        fetchImpl: input.fetchImpl,
        onProgress: input.onProgress,
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        requestId: input.requestId,
        onCorrelationMismatch: (message) => input.onCorrelationMismatch?.(message)
      });
      rememberJobId(result.job);
      return {
        job: result.job,
        content: result.reply,
        via: "auto_tools"
      };
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code !== "AUTO_MEDIA_TOOL_UNAVAILABLE") {
        throw error;
      }
      // Older spring-app without /v1/auto/tools/invoke — fall through.
    }
  }

  const job = await runMediaGenerationJob({
    gatewayBaseUrl: input.gatewayBaseUrl,
    bearerToken: input.bearerToken,
    kind: input.kind,
    model: input.model,
    prompt: input.prompt,
    imageUrl: input.imageUrl,
    lastFrameImageUrl: input.lastFrameImageUrl,
    idempotencyKey: `newbrain-${input.requestId}`,
    pollIntervalMs: input.pollIntervalMs,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    onProgress: input.onProgress,
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    requestId: input.requestId,
    onCorrelationMismatch: (message) => input.onCorrelationMismatch?.(message)
  });
  rememberJobId(job);
  return {
    job,
    via: "legacy",
    content: formatMediaGenerationReply({
      kind: input.kind,
      model: input.model,
      job
    })
  };
}
