/**
 * Composer context-meter estimates aligned with Cursor-style accounting:
 * count system/rules, chat, tool I/O, skills, MCP schemas, and attachments —
 * not only visible chat text — against the model's real max_context when known.
 */

/** Cursor-like default when the selected model does not publish max_context. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

/** Fallback when neither catalog nor routing reports a window size. */
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000;

/** Rough per-image token cost for vision attachments (Cursor-scale, not the old flat 250). */
export const CONTEXT_IMAGE_TOKEN_ESTIMATE = 1_600;

/** Soft overhead for tool/message framing that pure character counts miss. */
const MESSAGE_OVERHEAD_TOKENS = 4;
const TOOL_SCHEMA_OVERHEAD_TOKENS = 24;

export type ContextMeterBucket =
  | "system"
  | "messages"
  | "tools"
  | "skills"
  | "mcp"
  | "attachments"
  | "draft";

export type ContextMeterBreakdown = Record<ContextMeterBucket, number>;

export type ContextMeterEstimate = {
  usedTokens: number;
  windowTokens: number;
  usedPercent: number;
  remainingPercent: number;
  breakdown: ContextMeterBreakdown;
};

export type ContextMeterModelLike = {
  model?: string;
  systemPrompt?: string;
  toolContext?: string;
  availableModels?: Array<{
    id?: string;
    model?: string;
    max_context?: number;
    routing?: { max_context?: number };
  }>;
};

export type ContextMeterTurnLike = {
  user?: { content?: string };
  assistant?: { content?: string; reasoningSummary?: string };
  tools?: Array<{ content?: string; name?: string; arguments?: unknown }>;
};

export type ContextMeterActivityLike = {
  title?: string;
  detail?: string;
  command?: string;
  toolName?: string;
  stdout?: unknown;
  stderr?: unknown;
  output?: unknown;
  failureMessage?: unknown;
  originalOutputBytes?: unknown;
};

export type ContextMeterEventLike = {
  type?: string;
  payload?: Record<string, unknown>;
};

export type ContextMeterSkillLike = {
  name?: string;
  description?: string;
  body?: string;
  content?: string;
  instructions?: string;
};

export type ContextMeterMcpToolLike = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  schema?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Character heuristic close to Cursor/Codex local estimates (~4 chars/token). */
export function estimateTextTokens(value: unknown): number {
  if (value == null) return 0;
  const text = typeof value === "string" ? value : safeJson(value);
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function emptyBreakdown(): ContextMeterBreakdown {
  return {
    system: 0,
    messages: 0,
    tools: 0,
    skills: 0,
    mcp: 0,
    attachments: 0,
    draft: 0
  };
}

/** Resolve the displayed context window from the selected model catalog entry. */
export function resolveContextWindowTokens(modelConfig?: ContextMeterModelLike | null): number {
  const selected = String(modelConfig?.model || "").trim().toLowerCase();
  const models = Array.isArray(modelConfig?.availableModels) ? modelConfig.availableModels : [];
  const match = models.find((item) => {
    const id = String(item?.id || item?.model || "").trim().toLowerCase();
    return id && selected && id === selected;
  }) || models.find((item) => Number(item?.max_context || item?.routing?.max_context) > 0);

  const fromModel = Number(match?.max_context || match?.routing?.max_context || 0);
  if (Number.isFinite(fromModel) && fromModel >= 8_000) return Math.floor(fromModel);
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

function addBucket(breakdown: ContextMeterBreakdown, bucket: ContextMeterBucket, tokens: number) {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  breakdown[bucket] += Math.round(tokens);
}

function estimateToolPayloadTokens(payload: unknown): number {
  if (payload == null) return 0;
  if (typeof payload === "string") return estimateTextTokens(payload);
  if (typeof payload === "number" && Number.isFinite(payload) && payload > 0) {
    // originalOutputBytes → approximate tokens from byte length
    return Math.max(1, Math.ceil(payload / 4));
  }
  if (!isRecord(payload)) return estimateTextTokens(payload);
  let total = 0;
  for (const key of ["output", "stdout", "stderr", "detail", "command", "content", "text", "failureMessage"]) {
    if (payload[key] != null) total += estimateTextTokens(payload[key]);
  }
  if (payload.arguments != null) total += estimateTextTokens(payload.arguments);
  if (Array.isArray(payload.content)) {
    for (const part of payload.content) {
      if (isRecord(part) && part.text != null) total += estimateTextTokens(part.text);
      else total += estimateTextTokens(part);
    }
  }
  if (total === 0) total = estimateTextTokens(payload);
  return total;
}

function estimateActivityTokens(activity: ContextMeterActivityLike): number {
  let total = MESSAGE_OVERHEAD_TOKENS;
  total += estimateTextTokens(activity.title);
  total += estimateTextTokens(activity.detail);
  total += estimateTextTokens(activity.command);
  total += estimateTextTokens(activity.toolName);
  total += estimateToolPayloadTokens(activity.stdout);
  total += estimateToolPayloadTokens(activity.stderr);
  total += estimateToolPayloadTokens(activity.output);
  total += estimateTextTokens(activity.failureMessage);
  const bytes = Number(activity.originalOutputBytes);
  if (Number.isFinite(bytes) && bytes > 0) {
    // Prefer explicit byte size when present and larger than truncated fields.
    total = Math.max(total, Math.ceil(bytes / 4) + MESSAGE_OVERHEAD_TOKENS);
  }
  return total;
}

function estimateEventTokens(event: ContextMeterEventLike): number {
  const payload = isRecord(event.payload) ? event.payload : {};
  if (event.type === "tool_call") {
    return MESSAGE_OVERHEAD_TOKENS
      + estimateTextTokens(payload.name)
      + estimateTextTokens(payload.arguments);
  }
  if (event.type === "tool_result") {
    return MESSAGE_OVERHEAD_TOKENS
      + estimateTextTokens(payload.name)
      + estimateToolPayloadTokens(payload.result ?? payload);
  }
  if (event.type === "context_compacted") {
    return estimateTextTokens(payload.summary) + MESSAGE_OVERHEAD_TOKENS;
  }
  if (event.type === "skill_loaded") {
    return estimateTextTokens(payload.name) + estimateTextTokens(payload.content || payload.body) + MESSAGE_OVERHEAD_TOKENS;
  }
  return 0;
}

function estimateSkillTokens(skill: ContextMeterSkillLike | null | undefined, skillContext?: string): number {
  if (!skill && !skillContext) return 0;
  return MESSAGE_OVERHEAD_TOKENS
    + estimateTextTokens(skill?.name)
    + estimateTextTokens(skill?.description)
    + estimateTextTokens(skill?.body || skill?.content || skill?.instructions)
    + estimateTextTokens(skillContext);
}

function estimateMcpToolTokens(tool: ContextMeterMcpToolLike): number {
  return TOOL_SCHEMA_OVERHEAD_TOKENS
    + estimateTextTokens(tool.name)
    + estimateTextTokens(tool.description)
    + estimateTextTokens(tool.inputSchema ?? tool.schema);
}

/**
 * Build a Cursor-like context usage estimate from renderer-visible state.
 * Prefer durable tool events over activity projections when both are present
 * so stdout/stderr are not double-counted after truncation in the UI row.
 */
export function estimateContextMeter(input: {
  modelConfig?: ContextMeterModelLike | null;
  conversationTurns?: ContextMeterTurnLike[];
  activities?: ContextMeterActivityLike[];
  events?: ContextMeterEventLike[];
  draftText?: string;
  composerTools?: unknown[];
  imageCount?: number;
  selectedSkill?: ContextMeterSkillLike | null;
  skillContext?: string;
  mcpTools?: ContextMeterMcpToolLike[];
  liveAssistantContent?: string;
  liveReasoningSummary?: string;
  /** Optional server-side estimate from thread compaction; used as a floor. */
  serverEstimatedTokens?: number;
}): ContextMeterEstimate {
  const breakdown = emptyBreakdown();
  const windowTokens = Math.max(
    FALLBACK_CONTEXT_WINDOW_TOKENS,
    resolveContextWindowTokens(input.modelConfig)
  );

  addBucket(breakdown, "system", estimateTextTokens(input.modelConfig?.systemPrompt));
  addBucket(breakdown, "system", estimateTextTokens(input.modelConfig?.toolContext));

  for (const turn of input.conversationTurns ?? []) {
    addBucket(breakdown, "messages", estimateTextTokens(turn.user?.content) + MESSAGE_OVERHEAD_TOKENS);
    addBucket(breakdown, "messages", estimateTextTokens(turn.assistant?.content) + MESSAGE_OVERHEAD_TOKENS);
    addBucket(breakdown, "messages", estimateTextTokens(turn.assistant?.reasoningSummary));
    for (const tool of turn.tools ?? []) {
      addBucket(
        breakdown,
        "tools",
        MESSAGE_OVERHEAD_TOKENS
          + estimateTextTokens(tool.name)
          + estimateTextTokens(tool.content)
          + estimateTextTokens(tool.arguments)
      );
    }
  }

  addBucket(breakdown, "messages", estimateTextTokens(input.liveAssistantContent));
  addBucket(breakdown, "messages", estimateTextTokens(input.liveReasoningSummary));

  const events = Array.isArray(input.events) ? input.events : [];
  if (events.length) {
    for (const event of events) {
      const tokens = estimateEventTokens(event);
      if (event.type === "skill_loaded") addBucket(breakdown, "skills", tokens);
      else if (event.type === "context_compacted") addBucket(breakdown, "messages", tokens);
      else addBucket(breakdown, "tools", tokens);
    }
  } else {
    for (const activity of input.activities ?? []) {
      addBucket(breakdown, "tools", estimateActivityTokens(activity));
    }
  }

  addBucket(breakdown, "skills", estimateSkillTokens(input.selectedSkill, input.skillContext));

  for (const tool of input.mcpTools ?? []) {
    addBucket(breakdown, "mcp", estimateMcpToolTokens(tool));
  }

  const imageCount = Math.max(0, Math.floor(Number(input.imageCount) || 0));
  addBucket(breakdown, "attachments", imageCount * CONTEXT_IMAGE_TOKEN_ESTIMATE);

  addBucket(breakdown, "draft", estimateTextTokens(input.draftText));
  for (const tool of input.composerTools ?? []) {
    addBucket(breakdown, "draft", estimateTextTokens(tool) + MESSAGE_OVERHEAD_TOKENS);
  }

  let usedTokens = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const serverEstimate = Number(input.serverEstimatedTokens);
  if (Number.isFinite(serverEstimate) && serverEstimate > 0) {
    // After compaction, trust the server budget for historical chat/tools so the
    // meter tracks model-visible context instead of raw unsummarized tool dumps.
    const liveAndDraft = breakdown.draft
      + estimateTextTokens(input.liveAssistantContent)
      + estimateTextTokens(input.liveReasoningSummary);
    const fixedOverhead = breakdown.system + breakdown.skills + breakdown.mcp + breakdown.attachments;
    usedTokens = Math.max(serverEstimate, fixedOverhead + liveAndDraft);
    breakdown.messages = Math.max(0, usedTokens - fixedOverhead - liveAndDraft - breakdown.draft);
    breakdown.tools = 0;
  }

  usedTokens = Math.min(windowTokens, Math.max(0, Math.round(usedTokens)));
  const usedPercent = Math.min(100, Math.max(0, Math.round((usedTokens / windowTokens) * 100)));
  return {
    usedTokens,
    windowTokens,
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    breakdown
  };
}

const BUCKET_LABELS: Record<ContextMeterBucket, string> = {
  system: "系统提示",
  messages: "对话消息",
  tools: "工具结果",
  skills: "技能",
  mcp: "MCP 工具定义",
  attachments: "附件",
  draft: "输入草稿"
};

export function formatContextTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0";
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(Math.round(tokens));
}

/** Short multi-line breakdown for the composer tooltip. */
export function formatContextMeterBreakdown(breakdown: ContextMeterBreakdown): string[] {
  return (Object.keys(BUCKET_LABELS) as ContextMeterBucket[])
    .map((key) => ({ key, tokens: breakdown[key] }))
    .filter((item) => item.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens)
    .map((item) => `${BUCKET_LABELS[item.key]} ${formatContextTokens(item.tokens)}`);
}

/** Pull estimatedTokens from the latest context_compacted event when present. */
export function readServerEstimatedTokens(events?: ContextMeterEventLike[]): number {
  if (!Array.isArray(events) || !events.length) return 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "context_compacted" || !isRecord(event.payload)) continue;
    const tokens = Number(event.payload.estimatedTokens);
    if (Number.isFinite(tokens) && tokens > 0) return Math.round(tokens);
  }
  return 0;
}
