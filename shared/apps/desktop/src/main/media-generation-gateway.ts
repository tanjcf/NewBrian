/**
 * Client for spring-app media generation APIs.
 *
 * Preferred path for image/video: Auto tools `/v1/auto/tools/invoke`
 * (`image_generate` / `video_generate`, server-owned).
 * Legacy specialty paths remain for music/3d and fallback.
 */

import {
  collectSpringCorrelationMismatches,
  formatSpringCorrelationDiagnostics,
  withSpringCorrelationBody,
  withSpringCorrelationHeaders,
  type SpringCorrelationMismatch
} from "./spring-correlation.ts";

export type MediaGenerationKind = "image" | "video" | "music" | "3d";

export type GenerationJobSnapshot = {
  id: string;
  kind?: string;
  provider?: string;
  state: string;
  resultJson?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type MediaCorrelationIds = {
  workspaceId?: string;
  threadId?: string;
  requestId?: string;
};

type MediaCorrelationHooks = {
  workspaceId?: string;
  threadId?: string;
  requestId?: string;
  onCorrelationMismatch?: (message: string, mismatches: SpringCorrelationMismatch[]) => void;
};

export type CreateMediaGenerationInput = {
  gatewayBaseUrl: string;
  bearerToken: string;
  kind: MediaGenerationKind;
  model: string;
  prompt: string;
  /** Optional reference image URL (image-to-video / 3d). */
  imageUrl?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
} & MediaCorrelationHooks;

export type PollMediaGenerationInput = {
  gatewayBaseUrl: string;
  bearerToken: string;
  kind: MediaGenerationKind;
  jobId: string;
  model?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
} & MediaCorrelationHooks;

export type RunMediaGenerationInput = CreateMediaGenerationInput & {
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onProgress?: (job: GenerationJobSnapshot) => void;
};

export type AutoMediaToolName = "image_generate" | "video_generate";

export type RunAutoMediaToolInput = {
  gatewayBaseUrl: string;
  bearerToken: string;
  toolName: AutoMediaToolName;
  prompt: string;
  model?: string;
  imageUrl?: string;
  idempotencyKey?: string;
  wait?: boolean;
  maxWaitMs?: number;
  /** Client poll interval when wait=false (OpenClaw-style). */
  pollIntervalMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (job: GenerationJobSnapshot) => void;
} & MediaCorrelationHooks;

function reportCorrelation(
  source: string,
  expected: MediaCorrelationIds,
  payload: unknown,
  onCorrelationMismatch?: MediaCorrelationHooks["onCorrelationMismatch"]
) {
  const mismatches = collectSpringCorrelationMismatches(expected, payload);
  if (!mismatches.length) return;
  const message = formatSpringCorrelationDiagnostics(source, mismatches);
  onCorrelationMismatch?.(message, mismatches);
}

export function toolNameForMediaKind(kind: MediaGenerationKind): AutoMediaToolName | null {
  if (kind === "image") return "image_generate";
  if (kind === "video") return "video_generate";
  return null;
}

function resolveBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Model base URL is required.");
  // Accept either https://host/v1 or https://host
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function createPath(kind: MediaGenerationKind): string {
  if (kind === "image") return "/images/generations";
  if (kind === "video") return "/videos";
  if (kind === "music") return "/music/generations";
  return "/3d/generations";
}

function queryPath(kind: MediaGenerationKind, jobId: string): string {
  if (kind === "image") return `/images/generations/${encodeURIComponent(jobId)}`;
  if (kind === "video") return `/videos/${encodeURIComponent(jobId)}`;
  if (kind === "music") return `/music/generations/${encodeURIComponent(jobId)}`;
  return `/3d/generations/${encodeURIComponent(jobId)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseGenerationJobSnapshot(payload: unknown): GenerationJobSnapshot {
  const body = asRecord(payload) ?? {};
  const id = String(body.id ?? body.platformJobId ?? body.task_id ?? "").trim();
  if (!id) throw new Error("媒体生成任务未返回任务 ID。");
  return {
    id,
    kind: body.kind == null ? undefined : String(body.kind),
    provider: body.provider == null ? undefined : String(body.provider),
    state: String(body.state ?? body.status ?? "queued").trim() || "queued",
    resultJson: body.resultJson == null && body.result_json == null
      ? undefined
      : String(body.resultJson ?? body.result_json ?? ""),
    errorCode: body.errorCode == null && body.error_code == null
      ? undefined
      : String(body.errorCode ?? body.error_code ?? ""),
    errorMessage: body.errorMessage == null && body.error_message == null
      ? undefined
      : String(body.errorMessage ?? body.error_message ?? "")
  };
}

export function isTerminalGenerationState(state: string): boolean {
  return /^(succeeded|success|completed|failed|error|failure|cancelled|canceled)$/i.test(state.trim());
}

export function isSuccessfulGenerationState(state: string): boolean {
  return /^(succeeded|success|completed)$/i.test(state.trim());
}

/** Recursively collect http(s) URLs that look like media assets. */
export function extractMediaUrlsFromResult(resultJson: string | undefined | null): string[] {
  if (!resultJson || !String(resultJson).trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(resultJson));
  } catch {
    const loose = String(resultJson).match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    return [...new Set(loose)];
  }
  const found: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (/^https?:\/\//i.test(text)) found.push(text);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    for (const [key, child] of Object.entries(record)) {
      if (/url|uri|href|video|audio|file|download|output/i.test(key) || typeof child === "object") {
        visit(child, depth + 1);
      }
    }
  };
  visit(parsed, 0);
  return [...new Set(found)];
}

export function formatMediaGenerationReply(input: {
  kind: MediaGenerationKind;
  model: string;
  job: GenerationJobSnapshot;
}): string {
  const urls = extractMediaUrlsFromResult(input.job.resultJson);
  const kindLabel = input.kind === "image" ? "图片" : input.kind === "video" ? "视频" : input.kind === "music" ? "音乐" : "3D";
  if (!isSuccessfulGenerationState(input.job.state)) {
    const detail = input.job.errorMessage || input.job.errorCode || input.job.state;
    return `${kindLabel}生成失败（模型 ${input.model}）：${detail}`;
  }
  if (!urls.length) {
    return `${kindLabel}生成已完成（模型 ${input.model}，任务 ${input.job.id}），但响应中未找到可下载地址。`;
  }
  const lines = [
    `${kindLabel}已生成完成（模型 \`${input.model}\`）。`,
    "",
    ...urls.map((url, index) => (urls.length === 1 ? url : `${index + 1}. ${url}`))
  ];
  return lines.join("\n");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw_body: text };
  }
}

export async function createMediaGenerationJob(
  input: CreateMediaGenerationInput
): Promise<GenerationJobSnapshot> {
  const base = resolveBase(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const correlation = {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    requestId: input.requestId
  };
  const body = withSpringCorrelationBody({
    model: input.model,
    prompt: input.prompt
  }, correlation);
  if (input.imageUrl) {
    body.image_url = input.imageUrl;
    body.image = { url: input.imageUrl };
  }
  const headers = withSpringCorrelationHeaders({
    "Content-Type": "application/json",
    Authorization: `Bearer ${input.bearerToken}`,
    Accept: "application/json"
  }, correlation);
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;
  let response: Response;
  try {
    response = await fetchImpl(`${base}${createPath(input.kind)}`, {
      method: "POST",
      headers,
      signal: input.signal ?? AbortSignal.timeout(60_000),
      body: JSON.stringify(body)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`提交${input.kind}生成任务失败：${detail}`);
  }
  const payload = await readJson(response);
  if (!response.ok && response.status !== 202) {
    const record = asRecord(payload);
    const message = String(record?.message ?? record?.error ?? `HTTP ${response.status}`);
    throw new Error(`提交${input.kind}生成任务失败（${response.status}）：${message}`);
  }
  reportCorrelation(`media/${input.kind}/create`, correlation, payload, input.onCorrelationMismatch);
  return parseGenerationJobSnapshot(payload);
}

export async function getMediaGenerationJob(
  input: PollMediaGenerationInput
): Promise<GenerationJobSnapshot> {
  const base = resolveBase(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const correlation = {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    requestId: input.requestId
  };
  const query = input.model ? `?model=${encodeURIComponent(input.model)}` : "";
  let response: Response;
  try {
    response = await fetchImpl(`${base}${queryPath(input.kind, input.jobId)}${query}`, {
      method: "GET",
      headers: withSpringCorrelationHeaders({
        Authorization: `Bearer ${input.bearerToken}`,
        Accept: "application/json"
      }, correlation),
      signal: input.signal ?? AbortSignal.timeout(30_000)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`查询${input.kind}生成任务失败：${detail}`);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const record = asRecord(payload);
    const message = String(record?.message ?? record?.error ?? `HTTP ${response.status}`);
    throw new Error(`查询${input.kind}生成任务失败（${response.status}）：${message}`);
  }
  reportCorrelation(`media/${input.kind}/poll`, correlation, payload, input.onCorrelationMismatch);
  return parseGenerationJobSnapshot(payload);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    }, { once: true });
  });
}

/**
 * Query spring-app Auto media tool job snapshot (`/v1/auto/tools/jobs/{id}`).
 */
export async function getAutoMediaToolJob(input: {
  gatewayBaseUrl: string;
  bearerToken: string;
  jobId: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
} & MediaCorrelationHooks): Promise<{ job: GenerationJobSnapshot; reply: string; tool: string }> {
  const base = resolveBase(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const correlation = {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    requestId: input.requestId
  };
  const response = await fetchImpl(`${base}/auto/tools/jobs/${encodeURIComponent(input.jobId)}`, {
    method: "GET",
    headers: withSpringCorrelationHeaders({
      Authorization: `Bearer ${input.bearerToken}`,
      Accept: "application/json"
    }, correlation),
    signal: input.signal ?? AbortSignal.timeout(60_000)
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const record = asRecord(payload);
    const message = String(record?.message ?? record?.error ?? `HTTP ${response.status}`);
    throw new Error(`查询 Auto 媒体任务失败（${response.status}）：${message}`);
  }
  reportCorrelation("auto/tools/jobs", correlation, payload, input.onCorrelationMismatch);
  const record = asRecord(payload) ?? {};
  const job = parseGenerationJobSnapshot({
    id: record.job_id ?? record.id ?? input.jobId,
    kind: record.kind,
    provider: record.provider,
    state: record.state ?? record.status ?? "queued",
    resultJson: record.result_json ?? record.resultJson,
    errorCode: record.error_code ?? record.errorCode,
    errorMessage: record.error ?? record.errorMessage
  });
  return {
    job,
    tool: String(record.tool || ""),
    reply: String(record.reply || "").trim()
  };
}

/**
 * Invoke spring-app Auto media tool (image_generate / video_generate).
 *
 * OpenClaw-style default: submit with {@code wait=false}, return task id, then
 * poll `/auto/tools/jobs/{id}` with progress callbacks. Server still owns keys
 * and provider adapters. Pass {@code wait:true} only when a single blocking
 * HTTP round-trip is explicitly required.
 */
export async function runAutoMediaTool(
  input: RunAutoMediaToolInput
): Promise<{ job: GenerationJobSnapshot; reply: string; tool: string }> {
  const base = resolveBase(input.gatewayBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const waitOnServer = input.wait === true;
  const correlation = {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    requestId: input.requestId
  };
  const argumentsBody: Record<string, unknown> = {
    prompt: input.prompt
  };
  if (input.model) argumentsBody.model = input.model;
  if (input.imageUrl) argumentsBody.image_url = input.imageUrl;
  const headers = withSpringCorrelationHeaders({
    "Content-Type": "application/json",
    Authorization: `Bearer ${input.bearerToken}`,
    Accept: "application/json"
  }, correlation);
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;
  let response: Response;
  try {
    response = await fetchImpl(`${base}/auto/tools/invoke`, {
      method: "POST",
      headers,
      // Submit should return quickly when wait=false; keep a short HTTP budget.
      signal: input.signal ?? AbortSignal.timeout(
        waitOnServer
          ? Math.max(60_000, input.maxWaitMs ?? 10 * 60_000)
          : 120_000
      ),
      body: JSON.stringify(withSpringCorrelationBody({
        name: input.toolName,
        arguments: argumentsBody,
        idempotency_key: input.idempotencyKey,
        wait: waitOnServer,
        max_wait_ms: input.maxWaitMs ?? 10 * 60_000
      }, correlation))
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`调用 Auto 媒体工具失败：${detail}`);
  }
  const payload = await readJson(response);
  if (response.status === 404) {
    const err = new Error("AUTO_MEDIA_TOOL_UNAVAILABLE");
    (err as Error & { code?: string }).code = "AUTO_MEDIA_TOOL_UNAVAILABLE";
    throw err;
  }
  if (!response.ok && response.status !== 202) {
    const record = asRecord(payload);
    const message = String(record?.message ?? record?.error ?? `HTTP ${response.status}`);
    throw new Error(`Auto 媒体工具失败（${response.status}）：${message}`);
  }
  reportCorrelation("auto/tools/invoke", correlation, payload, input.onCorrelationMismatch);
  const record = asRecord(payload) ?? {};
  let job = parseGenerationJobSnapshot({
    id: record.job_id ?? record.id,
    kind: record.kind,
    provider: record.provider,
    state: record.state ?? record.status ?? "queued",
    resultJson: record.result_json ?? record.resultJson,
    errorCode: record.error_code ?? record.errorCode,
    errorMessage: record.error ?? record.errorMessage
  });
  input.onProgress?.(job);
  let reply = String(record.reply || "").trim();
  let tool = String(record.tool || input.toolName);

  // OpenClaw path: client polls while the provider runs (progress stays visible).
  if (!waitOnServer && job.id && !isTerminalGenerationState(job.state)
    && extractMediaUrlsFromResult(job.resultJson).length === 0) {
    const pollIntervalMs = Math.max(1, input.pollIntervalMs ?? 2_000);
    const maxWaitMs = Math.max(pollIntervalMs, input.maxWaitMs ?? 10 * 60_000);
    const started = Date.now();
    while (!isTerminalGenerationState(job.state)
      && extractMediaUrlsFromResult(job.resultJson).length === 0) {
      if (Date.now() - started > maxWaitMs) {
        throw new Error(
          `${input.toolName === "video_generate" ? "视频" : "图片"}生成超时（任务 ${job.id}，已等待 ${Math.round(maxWaitMs / 1000)} 秒）。`
        );
      }
      await sleep(pollIntervalMs, input.signal);
      const polled = await getAutoMediaToolJob({
        gatewayBaseUrl: input.gatewayBaseUrl,
        bearerToken: input.bearerToken,
        jobId: job.id,
        signal: input.signal,
        fetchImpl,
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        requestId: input.requestId,
        onCorrelationMismatch: input.onCorrelationMismatch
      });
      job = polled.job;
      if (polled.reply) reply = polled.reply;
      if (polled.tool) tool = polled.tool;
      input.onProgress?.(job);
    }
  }

  if (!isTerminalGenerationState(job.state) && extractMediaUrlsFromResult(job.resultJson).length > 0) {
    job = { ...job, state: "SUCCEEDED" };
  }
  if (/failed|cancelled|expired/i.test(job.state)) {
    throw new Error(job.errorMessage || `${input.toolName} 失败（${job.state}）`);
  }
  return {
    job,
    tool,
    reply: reply || formatMediaGenerationReply({
      kind: input.toolName === "video_generate" ? "video" : "image",
      model: input.model || "",
      job
    })
  };
}

/**
 * Submit a media job to spring-app and poll until terminal state.
 */
export async function runMediaGenerationJob(
  input: RunMediaGenerationInput
): Promise<GenerationJobSnapshot> {
  let job = await createMediaGenerationJob(input);
  input.onProgress?.(job);
  // Sync providers (e.g. hy-image-v3) may return the asset on POST; skip poll
  // when we already have a terminal state OR usable media URLs in resultJson.
  if (isTerminalGenerationState(job.state) || extractMediaUrlsFromResult(job.resultJson).length > 0) {
    if (!isTerminalGenerationState(job.state) && extractMediaUrlsFromResult(job.resultJson).length > 0) {
      job = { ...job, state: "SUCCEEDED" };
    }
    return job;
  }

  const pollIntervalMs = Math.max(1_500, input.pollIntervalMs ?? 3_000);
  const maxWaitMs = Math.max(pollIntervalMs, input.maxWaitMs ?? 10 * 60_000);
  const started = Date.now();
  while (!isTerminalGenerationState(job.state)) {
    if (Date.now() - started > maxWaitMs) {
      throw new Error(`${input.kind}生成超时（任务 ${job.id}，已等待 ${Math.round(maxWaitMs / 1000)} 秒）。`);
    }
    await sleep(pollIntervalMs, input.signal);
    job = await getMediaGenerationJob({
      gatewayBaseUrl: input.gatewayBaseUrl,
      bearerToken: input.bearerToken,
      kind: input.kind,
      jobId: job.id,
      model: input.model,
      signal: input.signal,
      fetchImpl: input.fetchImpl,
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      requestId: input.requestId,
      onCorrelationMismatch: input.onCorrelationMismatch
    });
    input.onProgress?.(job);
  }
  return job;
}

export function mediaKindFromOrchestratorChannel(
  channel: string | undefined | null
): MediaGenerationKind | null {
  const value = String(channel || "").trim();
  if (value === "image_gen") return "image";
  if (value === "video_gen") return "video";
  if (value === "music_gen") return "music";
  if (value === "three_d_gen") return "3d";
  return null;
}
