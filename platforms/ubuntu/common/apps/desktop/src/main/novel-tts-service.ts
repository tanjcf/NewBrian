import { resolveNovelTtsVoice } from "../shared/novel-tts-policy.js";
import { NovelTtsKokoroEngine } from "./novel-tts-kokoro-engine.js";

export type NovelTtsSynthesizeInput = {
  text: string;
  voiceId: string;
  voiceLabel?: string;
};

export type NovelTtsSynthesizeResult = {
  ok: boolean;
  audioBase64?: string;
  mimeType?: string;
  detail?: string;
  provider?: string;
  runtime?: "gpu" | "cpu";
};

type NovelTtsServiceDependencies = {
  readGatewayBaseUrl: () => Promise<string>;
  readBearerToken: () => Promise<string>;
  appendDebugLog?: (message: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  /** When false, skip spring-app /v1/audio/speech (default: offline-first). */
  enableGatewaySpeech?: boolean;
  kokoroEngine?: NovelTtsKokoroEngine;
};

function trimText(value: string, max = 4_000) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}……`;
}

function buildSpeechUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/v1$/i.test(normalized)) return `${normalized}/audio/speech`;
  if (/\/v1\//i.test(normalized)) return `${normalized.replace(/\/$/, "")}/audio/speech`;
  return `${normalized}/v1/audio/speech`;
}

/**
 * Offline-first novel TTS: Kokoro (GPU/CPU) when assets exist, optional gateway,
 * otherwise renderer falls back to speechSynthesis.
 */
export class NovelTtsService {
  private readonly dependencies: NovelTtsServiceDependencies;
  private readonly kokoroEngine: NovelTtsKokoroEngine;
  private remoteController: AbortController | null = null;

  constructor(dependencies: NovelTtsServiceDependencies) {
    this.dependencies = dependencies;
    this.kokoroEngine = dependencies.kokoroEngine ?? new NovelTtsKokoroEngine({
      appendDebugLog: dependencies.appendDebugLog
    });
  }

  async synthesize(input: NovelTtsSynthesizeInput): Promise<NovelTtsSynthesizeResult> {
    const text = trimText(input.text);
    if (!text) return { ok: false, detail: "没有可朗读的内容。" };
    const voice = resolveNovelTtsVoice(input.voiceId);
    const voiceLabel = input.voiceLabel || voice.label;

    const kokoro = await this.kokoroEngine.synthesize({ text, voiceId: voice.id });
    if (kokoro.ok && kokoro.audioBase64) {
      await this.dependencies.appendDebugLog?.(
        `novel tts kokoro ok runtime=${kokoro.runtime || "cpu"} voice=${voice.id}->${voice.kokoroVoice}`
      );
      return {
        ok: true,
        audioBase64: kokoro.audioBase64,
        mimeType: kokoro.mimeType || "audio/wav",
        provider: kokoro.provider || "kokoro-zh-offline",
        runtime: kokoro.runtime
      };
    }
    await this.dependencies.appendDebugLog?.(
      `novel tts kokoro miss detail=${kokoro.detail || "unknown"}`
    );

    if (this.dependencies.enableGatewaySpeech) {
      const remote = await this.synthesizeViaGateway(text, voice.id, voiceLabel);
      if (remote.ok) return remote;
    }

    return {
      ok: false,
      detail: kokoro.detail || "离线语音不可用，将尝试系统朗读。"
    };
  }

  cancel() {
    this.remoteController?.abort(new Error("Novel speech cancelled"));
    this.remoteController = null;
    this.kokoroEngine.cancel();
  }

  private async synthesizeViaGateway(
    text: string,
    voiceId: string,
    voiceLabel: string
  ): Promise<NovelTtsSynthesizeResult> {
    const fetchImpl = this.dependencies.fetchImpl ?? fetch;
    const controller = new AbortController();
    this.remoteController?.abort(new Error("Novel speech replaced"));
    this.remoteController = controller;
    try {
      const [baseUrl, bearerToken] = await Promise.all([
        this.dependencies.readGatewayBaseUrl(),
        this.dependencies.readBearerToken()
      ]);
      if (!baseUrl || !bearerToken) {
        return { ok: false, detail: "未登录或网关不可用，将尝试本地朗读。" };
      }
      const endpoint = buildSpeechUrl(baseUrl);
      await this.dependencies.appendDebugLog?.(
        `novel tts request endpoint=${endpoint} voice=${voiceId} chars=${text.length}`
      );
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
          Accept: "audio/mpeg, audio/wav, application/json"
        },
        body: JSON.stringify({
          model: "tts-1",
          input: text,
          voice: voiceId,
          voice_label: voiceLabel,
          response_format: "mp3"
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = `朗读服务不可用（HTTP ${response.status}），将尝试本地朗读。`;
        await this.dependencies.appendDebugLog?.(`novel tts failed status=${response.status}`);
        return { ok: false, detail };
      }
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => ({})) as { detail?: string; message?: string };
        return {
          ok: false,
          detail: payload.detail || payload.message || "朗读服务未返回音频，将尝试本地朗读。"
        };
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) return { ok: false, detail: "朗读服务返回空音频。" };
      return {
        ok: true,
        audioBase64: buffer.toString("base64"),
        mimeType: contentType.includes("wav") ? "audio/wav" : "audio/mpeg",
        provider: "gateway-audio-speech"
      };
    } catch (error) {
      const aborted = controller.signal.aborted || Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError");
      const detail = aborted
        ? "朗读已取消。"
        : "朗读服务请求失败，将尝试本地朗读。";
      await this.dependencies.appendDebugLog?.(
        `novel tts error ${aborted ? "cancelled" : error instanceof Error ? error.message : String(error)}`
      );
      return { ok: false, detail };
    } finally {
      if (this.remoteController === controller) this.remoteController = null;
    }
  }
}
