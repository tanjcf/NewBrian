/**
 * Server-authoritative Auto routing client.
 * Desktop must NOT pick specialty models locally — call spring-app `/v1/auto/route`.
 */

import {
  collectSpringCorrelationMismatches,
  formatSpringCorrelationDiagnostics,
  withSpringCorrelationBody,
  withSpringCorrelationHeaders,
  type SpringCorrelationMismatch
} from "./spring-correlation.ts";

export type SpringAppAutoRouteDecision = {
  schema_version: 1;
  model: string;
  provider?: string;
  channel: string;
  task_class: string;
  optimize_for: string;
  degraded: boolean;
  reason_codes: string[];
  selected_reason: string;
  parent_role: string;
  child_specialty: string;
  fallback_models: string[];
  notes?: string;
  /** OpenClaw-style tool owned by spring-app Auto (image_generate / video_generate). */
  tool_name?: string;
  media_kind?: string;
  /** When "server", desktop must invoke /v1/auto/tools/* instead of vendor APIs. */
  media_execution?: "server" | "client";
  /** Diagnostic only — local TurnScope remains authoritative. */
  correlationMismatches?: SpringCorrelationMismatch[];
};

export type FetchSpringAppAutoRouteInput = {
  gatewayBaseUrl: string;
  bearerToken: string;
  latestUserText: string;
  optimizeFor?: string;
  selectedSkillNames?: string[];
  hasImageAttachments?: boolean;
  workspaceId?: string;
  threadId?: string;
  requestId?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onCorrelationMismatch?: (message: string, mismatches: SpringCorrelationMismatch[]) => void;
};

function resolveBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Model base URL is required.");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/**
 * Ask spring-app Auto to classify intent and pick model/channel.
 * On image_gen with no model, gateway returns 400 with Chinese message — surface as Error.
 */
export async function fetchSpringAppAutoRoute(
  input: FetchSpringAppAutoRouteInput
): Promise<SpringAppAutoRouteDecision> {
  const base = resolveBase(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const content: unknown[] = [
    { type: "input_text", text: String(input.latestUserText || "") }
  ];
  if (input.hasImageAttachments) {
    content.push({ type: "input_image", image_url: "data:image/png;base64,aa==" });
  }
  const correlation = {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    requestId: input.requestId
  };
  const body = withSpringCorrelationBody({
    model: "auto",
    optimize_for: input.optimizeFor || "balanced",
    optimizeFor: input.optimizeFor || "balanced",
    selected_skill_names: input.selectedSkillNames ?? [],
    input: [{ role: "user", content }],
    messages: [{ role: "user", content: String(input.latestUserText || "") }]
  }, correlation);
  let response: Response;
  try {
    response = await fetchImpl(`${base}/auto/route`, {
      method: "POST",
      headers: withSpringCorrelationHeaders({
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.bearerToken}`,
        Accept: "application/json"
      }, correlation),
      signal: input.signal,
      body: JSON.stringify(body)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Auto 路由网关不可达：${detail}`);
  }
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    payload = { message: text };
  }
  if (!response.ok) {
    const message = String(
      payload.message ?? payload.error ?? payload.errorMessage ?? `HTTP ${response.status}`
    );
    throw new Error(message);
  }
  const correlationMismatches = collectSpringCorrelationMismatches(correlation, payload);
  if (correlationMismatches.length) {
    const message = formatSpringCorrelationDiagnostics("auto/route", correlationMismatches);
    input.onCorrelationMismatch?.(message, correlationMismatches);
  }
  const mediaExecutionRaw = String(payload.media_execution || "").trim().toLowerCase();
  const mediaExecution =
    mediaExecutionRaw === "server" || mediaExecutionRaw === "client"
      ? mediaExecutionRaw
      : undefined;
  const toolName = String(payload.tool_name || "").trim();
  return {
    schema_version: 1,
    model: String(payload.model || "").trim(),
    provider: payload.provider == null ? undefined : String(payload.provider),
    channel: String(payload.channel || "text_chat").trim() || "text_chat",
    task_class: String(payload.task_class || "general").trim() || "general",
    optimize_for: String(payload.optimize_for || input.optimizeFor || "balanced"),
    degraded: Boolean(payload.degraded),
    reason_codes: Array.isArray(payload.reason_codes)
      ? payload.reason_codes.map((item) => String(item))
      : [],
    selected_reason: String(payload.selected_reason || ""),
    parent_role: String(payload.parent_role || "orchestrator"),
    child_specialty: String(payload.child_specialty || ""),
    fallback_models: Array.isArray(payload.fallback_models)
      ? payload.fallback_models.map((item) => String(item))
      : [],
    notes: payload.notes == null ? undefined : String(payload.notes),
    tool_name: toolName || undefined,
    media_kind: payload.media_kind == null ? undefined : String(payload.media_kind).trim() || undefined,
    media_execution: mediaExecution,
    correlationMismatches: correlationMismatches.length ? correlationMismatches : undefined
  };
}
