/**
 * MiniMax speech via media gateway (TokenHub wand path proxied by spring-app).
 * Auth: caller-supplied Bearer only — never hardcode API keys.
 */

import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  MINIMAX_DEFAULT_VOICE_ID,
  MINIMAX_TTS_MODEL,
  resolveMinimaxNarrationVoice,
  type MinimaxNarrationVoice
} from "../shared/minimax-narration-voices.js";

export {
  DEFAULT_MINIMAX_NARRATION_VOICE_ID,
  MINIMAX_DEFAULT_VOICE_ID,
  MINIMAX_NARRATION_VOICES,
  MINIMAX_TTS_MODEL,
  readStoredMinimaxNarrationVoiceId,
  resolveMinimaxNarrationVoice,
  storeMinimaxNarrationVoiceId,
  type MinimaxNarrationVoice,
  type MinimaxNarrationVoiceId
} from "../shared/minimax-narration-voices.js";

function resolveGatewayV1Base(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Gateway base URL is required.");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractAudioUrl(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return "";
  if (Array.isArray(root.data)) {
    for (const item of root.data) { const url = extractAudioUrl(item); if (url) return url; }
  }
  if (Array.isArray(root.outputs)) {
    for (const item of root.outputs) { const url = extractAudioUrl(item); if (url) return url; }
  }
  const direct = [
    root.audio_url,
    root.audioUrl,
    root.url,
    root.output_url,
    root.file_url
  ];
  for (const candidate of direct) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
  }
  const data = asRecord(root.data);
  if (data) {
    for (const key of ["audio_url", "audioUrl", "url", "output_url", "file_url"]) {
      const value = data[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
    const audio = asRecord(data.audio);
    if (audio) {
      for (const key of ["url", "audio_url", "download_url"]) {
        const value = audio[key];
        if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
      }
    }
  }
  const result = asRecord(root.result);
  if (result) {
    for (const key of ["audio_url", "url"]) {
      const value = result[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
  }
  return "";
}

export type MinimaxSyncTtsResult = {
  ok: boolean;
  audioBase64?: string;
  mimeType?: string;
  detail?: string;
  provider?: string;
  audioUrl?: string;
};

export type MinimaxSyncTtsInput = {
  gatewayBaseUrl: string;
  bearerToken: string;
  text: string;
  voice?: MinimaxNarrationVoice | { voiceId: string; speed?: number; vol?: number; pitch?: number };
  model?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/** Submit a Spring generation job, await its terminal result, then download audio. */
export async function synthesizeMinimaxSyncTts(input: MinimaxSyncTtsInput): Promise<MinimaxSyncTtsResult> {
  const text = String(input.text || "").trim();
  if (!text) return { ok: false, detail: "没有可生成的内容。" };
  const bearerToken = String(input.bearerToken || "").trim();
  if (!bearerToken) return { ok: false, detail: "未登录或缺少网关凭证。" };
  const fetchImpl = input.fetchImpl ?? fetch;
  const voice = input.voice && "voiceId" in input.voice
    ? input.voice
    : resolveMinimaxNarrationVoice(undefined);
  const base = resolveGatewayV1Base(input.gatewayBaseUrl);
  const endpoint = `${base}/generation-jobs`;
  const body = {
    kind: "speech",
    prompt: text,
    model: input.model || MINIMAX_TTS_MODEL,
    text,
    voice_setting: {
      voice_id: voice.voiceId || MINIMAX_DEFAULT_VOICE_ID,
      speed: Number.isFinite(voice.speed) ? Number(voice.speed) : 1,
      vol: Number.isFinite(voice.vol) ? Number(voice.vol) : 1,
      pitch: Number.isFinite(voice.pitch) ? Number(voice.pitch) : 0
    },
    audio_setting: {
      sample_rate: 32_000,
      bitrate: 128_000,
      format: "mp3",
      channel: 1
    },
    subtitle_enable: false,
    output_format: "url"
  };

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Idempotency-Key": randomUUID(),
        "Content-Type": "application/json",
        Accept: "application/json, audio/mpeg, audio/wav"
      },
      body: JSON.stringify(body),
      signal: input.signal
    });
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "MiniMax TTS 请求失败"
    };
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return {
      ok: false,
      detail: `MiniMax TTS 不可用（HTTP ${response.status}）${errText ? `: ${errText.slice(0, 200)}` : ""}`
    };
  }

  if (contentType.includes("audio/") || contentType.includes("octet-stream")) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return { ok: false, detail: "MiniMax TTS 返回空音频。" };
    return {
      ok: true,
      audioBase64: buffer.toString("base64"),
      mimeType: contentType.includes("wav") ? "audio/wav" : "audio/mpeg",
      provider: "gateway-minimax-sync-tts"
    };
  }

  let payload = await response.json().catch(() => null);
  try {
    let job = asRecord(payload);
    if (!job || typeof job.id !== "string" || typeof job.state !== "string") {
      return { ok: false, detail: "配音任务返回格式无效。" };
    }
    const jobUrl = `${endpoint}/${encodeURIComponent(job.id)}`;
    while (!["SUCCEEDED", "FAILED", "CANCELLED", "CANCELED", "EXPIRED"].includes(String(job.state))) {
      await delay(1000, undefined, { signal: input.signal });
      const status = await fetchImpl(jobUrl, { headers: { Authorization: `Bearer ${bearerToken}` }, signal: input.signal });
      if (!status.ok) throw new Error(`配音任务查询失败（HTTP ${status.status}）`);
      job = asRecord(await status.json());
      if (!job || typeof job.state !== "string") throw new Error("配音任务状态无效。");
    }
    if (job.state !== "SUCCEEDED") return { ok: false, detail: String(job.errorMessage || "配音任务未完成，旧版本已保留。") };
    payload = typeof job.resultJson === "string" ? JSON.parse(job.resultJson) : job.resultJson;
  } catch (error) {
    return { ok: false, detail: input.signal?.aborted ? "配音已取消。" : error instanceof Error ? error.message : "配音任务查询失败。" };
  }
  const audioUrl = extractAudioUrl(payload);
  if (!audioUrl) {
    return { ok: false, detail: "MiniMax TTS 未返回音频 URL。" };
  }

  let audioResponse: Response;
  try {
    audioResponse = await fetchImpl(audioUrl, {
      method: "GET",
      headers: { ...(new URL(audioUrl).origin === new URL(base).origin ? { Authorization: `Bearer ${bearerToken}` } : {}), Accept: "audio/mpeg, audio/wav, */*" },
      signal: input.signal
    });
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "下载 MiniMax 音频失败"
    };
  }
  if (!audioResponse.ok) {
    return { ok: false, detail: `下载 MiniMax 音频失败（HTTP ${audioResponse.status}）` };
  }
  const bytes = Buffer.from(await audioResponse.arrayBuffer());
  if (!bytes.length) return { ok: false, detail: "MiniMax 音频为空。" };
  const audioCt = String(audioResponse.headers.get("content-type") || "").toLowerCase();
  return {
    ok: true,
    audioBase64: bytes.toString("base64"),
    mimeType: audioCt.includes("wav") ? "audio/wav" : "audio/mpeg",
    provider: "gateway-minimax-sync-tts",
    audioUrl
  };
}
