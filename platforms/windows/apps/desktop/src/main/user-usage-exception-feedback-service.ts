import type {
  ConfirmUsageExceptionFeedbackInput,
  CreateUsageExceptionFeedbackPreviewInput,
  UsageExceptionFeedbackPreview,
  UsageExceptionFeedbackSubmissionResult
} from "@codex-forge/protocol";

const MAX_CONTEXT_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_DIAGNOSTIC_CHARS = 8_000;
const PREVIEW_TTL_MS = 5 * 60_000;

export interface UsageExceptionSourceMessage {
  id: string;
  role: string;
  content: string;
  excludeFromModelContext?: boolean;
}

export interface UsageExceptionConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface TrustedUsageExceptionContext {
  messages: UsageExceptionSourceMessage[];
  environment: Record<string, unknown>;
  diagnostics: string;
  stackTrace?: string;
  deviceId: string;
  appVersion: string;
  ownerKey: string;
}

interface UsageExceptionAnalysis {
  title: string;
  symptomSummary: string;
  possibleCause: string;
  category: string;
  stableFeatures: string[];
  contextSummary: string;
}

interface UsageExceptionFailureInput {
  kind: string;
  message: string;
  stackTrace?: string;
  context: Record<string, unknown>;
  deviceId: string;
  appVersion: string;
}

interface UsageExceptionFeedbackDependencies {
  now: () => Date;
  makeId: () => string;
  readTrustedContext: (input: CreateUsageExceptionFeedbackPreviewInput) => Promise<TrustedUsageExceptionContext>;
  analyze: (prompt: string) => Promise<string>;
  report: (failure: UsageExceptionFailureInput) => Promise<{
    localReportId: string;
    delivery: "uploaded" | "queued";
  }>;
  getCurrentOwnerKey?: () => Promise<string> | string;
}

interface StoredPreview {
  public: UsageExceptionFeedbackPreview;
  input: CreateUsageExceptionFeedbackPreviewInput;
  trusted: TrustedUsageExceptionContext;
  conversation: UsageExceptionConversationMessage[];
  analysis: UsageExceptionAnalysis;
  consumed: boolean;
}

function bounded(value: unknown, limit: number): string {
  return String(value ?? "").slice(0, limit);
}

/** Remove credentials before content reaches either the analysis model or the durable outbox. */
export function redactUsageExceptionText(value: unknown): string {
  return String(value ?? "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)(?:\s*[=:]\s*))[^\s,;&]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)=)[^&#\s]+/gi, "$1[REDACTED]");
}

/** Select only user-visible conversation text; attachments and private reasoning never cross the boundary. */
export function selectUsageExceptionConversation(
  messages: UsageExceptionSourceMessage[]
): UsageExceptionConversationMessage[] {
  return messages
    .filter((message): message is UsageExceptionSourceMessage & { role: "user" | "assistant" } =>
      !message.excludeFromModelContext && (message.role === "user" || message.role === "assistant"))
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message) => ({
      id: bounded(message.id, 200),
      role: message.role,
      content: redactUsageExceptionText(bounded(message.content, MAX_MESSAGE_CHARS))
    }));
}

function parseAnalysis(raw: string): UsageExceptionAnalysis {
  const normalized = String(raw ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new TypeError("异常分析必须返回有效 JSON。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("异常分析必须返回 JSON 对象。");
  }
  const record = value as Record<string, unknown>;
  const required = (key: string, limit: number) => {
    const item = typeof record[key] === "string" ? record[key].trim() : "";
    if (!item) throw new TypeError(`异常分析缺少 ${key}。`);
    if (item.length > limit) {
      if (key === "title") throw new TypeError("异常标题不能超过 30 个字符。");
      throw new TypeError(`异常分析字段 ${key} 超过长度限制。`);
    }
    return redactUsageExceptionText(item);
  };
  if (!Array.isArray(record.stableFeatures) || record.stableFeatures.length === 0 || record.stableFeatures.length > 8) {
    throw new TypeError("异常分析 stableFeatures 必须包含 1 到 8 项。");
  }
  const stableFeatures = record.stableFeatures.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 80) {
      throw new TypeError("异常分析 stableFeatures 项无效。");
    }
    return item.trim().toLowerCase();
  });
  return {
    title: required("title", 30),
    symptomSummary: required("symptomSummary", 1_000),
    possibleCause: required("possibleCause", 2_000),
    category: required("category", 120).toLowerCase(),
    stableFeatures: [...new Set(stableFeatures)].sort(),
    contextSummary: required("contextSummary", 2_000)
  };
}

/** Local heuristic used when the analysis model is unavailable or returns invalid JSON twice. */
export function buildFallbackUsageExceptionAnalysis(
  description: string,
  conversation: UsageExceptionConversationMessage[]
): UsageExceptionAnalysis {
  const symptom = redactUsageExceptionText(bounded(description, 1_000)) || "用户报告的使用异常";
  const title = symptom.slice(0, 30);
  const recent = conversation
    .slice(-4)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const features = new Set<string>(["usage-exception", "local-fallback"]);
  if (/安全步数|max.?steps|步数上限/iu.test(symptom)) features.add("max-steps");
  if (/没有输出|无结果|空白/u.test(symptom)) features.add("empty-output");
  if (/超时|timeout/iu.test(symptom)) features.add("timeout");
  if (/政务|写作/u.test(symptom)) features.add("government-writing");
  return {
    title,
    symptomSummary: symptom,
    possibleCause: "模型分析暂不可用，已使用本地启发式摘要。可能与生成中断、安全步数上限、网关或模型响应异常有关，需结合上下文进一步排查。",
    category: "usage_exception",
    stableFeatures: [...features].slice(0, 8).sort(),
    contextSummary: redactUsageExceptionText(bounded(recent || symptom, 2_000))
  };
}

function buildPrompt(
  input: CreateUsageExceptionFeedbackPreviewInput,
  trusted: TrustedUsageExceptionContext,
  conversation: UsageExceptionConversationMessage[]
): string {
  const payload = {
    description: redactUsageExceptionText(bounded(input.description, MAX_MESSAGE_CHARS)),
    recentConversation: conversation,
    environment: JSON.parse(redactUsageExceptionText(JSON.stringify(trusted.environment ?? {}))) as Record<string, unknown>,
    diagnostics: redactUsageExceptionText(bounded(trusted.diagnostics, MAX_DIAGNOSTIC_CHARS)),
    stackTrace: redactUsageExceptionText(bounded(trusted.stackTrace, MAX_DIAGNOSTIC_CHARS))
  };
  return [
    "分析一次 NewBrain 用户主动报告的使用异常。只依据给定材料，不把可能原因表述为已确认根因。",
    "只返回 JSON：title(不超过30字符)、symptomSummary、possibleCause、category、stableFeatures(1到8个稳定英文特征)、contextSummary。",
    JSON.stringify(payload)
  ].join("\n");
}

function summarizeEnvironment(environment: Record<string, unknown>): string {
  return Object.entries(environment)
    .slice(0, 12)
    .map(([key, value]) => `${key}: ${redactUsageExceptionText(bounded(value, 300))}`)
    .join("\n");
}

export class UserUsageExceptionFeedbackService {
  private readonly dependencies: UsageExceptionFeedbackDependencies;
  private readonly previews = new Map<string, StoredPreview>();

  constructor(dependencies: UsageExceptionFeedbackDependencies) {
    this.dependencies = dependencies;
  }

  async createPreview(input: CreateUsageExceptionFeedbackPreviewInput): Promise<UsageExceptionFeedbackPreview> {
    const trusted = await this.dependencies.readTrustedContext(input);
    const conversation = selectUsageExceptionConversation(trusted.messages);
    const prompt = buildPrompt(input, trusted, conversation);
    let analysis: UsageExceptionAnalysis;
    try {
      analysis = parseAnalysis(await this.dependencies.analyze(prompt));
    } catch (firstError) {
      try {
        analysis = parseAnalysis(await this.dependencies.analyze(
          `${prompt}\n修复上一次无效输出，严格遵守 JSON 字段和长度限制。`
        ));
      } catch {
        // Keep the confirm UI reachable even when the selected model is down.
        analysis = buildFallbackUsageExceptionAnalysis(input.description, conversation);
        if (firstError instanceof Error && firstError.message.trim()) {
          analysis = {
            ...analysis,
            possibleCause: `${analysis.possibleCause}（分析失败：${redactUsageExceptionText(bounded(firstError.message, 200))}）`
          };
        }
      }
    }
    const createdAt = this.dependencies.now();
    const previewId = this.dependencies.makeId();
    const preview: UsageExceptionFeedbackPreview = {
      previewId,
      title: analysis.title,
      symptomSummary: analysis.symptomSummary,
      possibleCause: analysis.possibleCause,
      category: analysis.category,
      contextSummary: analysis.contextSummary,
      environmentSummary: summarizeEnvironment(trusted.environment),
      logSummary: redactUsageExceptionText(bounded(trusted.diagnostics, 2_000)),
      expiresAt: new Date(createdAt.getTime() + PREVIEW_TTL_MS).toISOString()
    };
    this.previews.set(previewId, { public: preview, input, trusted, conversation, analysis, consumed: false });
    return preview;
  }

  async confirm(input: ConfirmUsageExceptionFeedbackInput): Promise<UsageExceptionFeedbackSubmissionResult> {
    const stored = this.previews.get(input.previewId);
    if (!stored) throw new Error("Usage exception feedback preview was not found.");
    if (stored.consumed) throw new Error("Usage exception feedback was already submitted.");
    if (this.dependencies.now().getTime() >= Date.parse(stored.public.expiresAt)) {
      this.previews.delete(input.previewId);
      throw new Error("Usage exception feedback preview expired.");
    }
    const currentOwner = await this.dependencies.getCurrentOwnerKey?.();
    if (currentOwner !== undefined && currentOwner !== stored.trusted.ownerKey) {
      throw new Error("Usage exception feedback preview owner changed.");
    }
    stored.consumed = true;
    try {
      const submitted = await this.dependencies.report({
        kind: "user_reported_usage_exception",
        message: stored.analysis.title,
        stackTrace: redactUsageExceptionText(bounded(stored.trusted.stackTrace, 24_000)),
        deviceId: bounded(stored.trusted.deviceId, 160),
        appVersion: bounded(stored.trusted.appVersion, 64),
        context: {
          feedbackSchemaVersion: 1,
          description: redactUsageExceptionText(bounded(stored.input.description, MAX_MESSAGE_CHARS)),
          symptomSummary: stored.analysis.symptomSummary,
          possibleCause: stored.analysis.possibleCause,
          category: stored.analysis.category,
          stableFeatures: stored.analysis.stableFeatures,
          contextSummary: stored.analysis.contextSummary,
          recentConversation: stored.conversation,
          diagnostics: redactUsageExceptionText(bounded(stored.trusted.diagnostics, MAX_DIAGNOSTIC_CHARS)),
          environment: stored.trusted.environment,
          workspaceId: stored.input.workspaceId,
          threadId: stored.input.threadId
        }
      });
      return { ok: true, ...submitted };
    } catch (error) {
      stored.consumed = false;
      throw error;
    }
  }
}
