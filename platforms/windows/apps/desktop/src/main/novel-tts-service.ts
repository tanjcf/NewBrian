import { resolveNovelTtsVoice } from "../shared/novel-tts-policy.js";
import {
  resolveMinimaxNarrationVoice,
  type MinimaxNarrationVoiceId
} from "../shared/minimax-narration-voices.js";
import { synthesizeMinimaxSyncTts } from "./minimax-tts-gateway.js";
import { NovelTtsKokoroEngine } from "./novel-tts-kokoro-engine.js";
import { NovelTtsNativePlayer } from "./novel-tts-native-player.js";

export type NovelTtsSynthesizeInput = {
  text: string;
  voiceId: string;
  voiceLabel?: string;
  /** When false, synthesize WAV/base64 without native SoundPlayer playback (video timeline preview). */
  playback?: boolean;
  /** Prefer MiniMax gateway TTS before Kokoro (video narration). */
  preferGateway?: boolean;
};

export type NovelTtsSynthesizeResult = {
  ok: boolean;
  audioBase64?: string;
  mimeType?: string;
  detail?: string;
  provider?: string;
  runtime?: "gpu" | "cpu";
  playingInMain?: boolean;
  durationMs?: number;
  audioPath?: string;
};

type NovelTtsServiceDependencies = {
  readGatewayBaseUrl: () => Promise<string>;
  readBearerToken: () => Promise<string>;
  appendDebugLog?: (message: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  /** When true, MiniMax sync_tts is attempted (gateway-first when preferGateway / silent path). */
  enableGatewaySpeech?: boolean;
  kokoroEngine?: NovelTtsKokoroEngine;
  nativePlayer?: NovelTtsNativePlayer;
};

function trimText(value: string, max = 4_000) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}……`;
}

function isMinimaxVoiceId(voiceId: string) {
  return /^(narration_default|narration_brighter|narration_deeper)$/.test(voiceId)
    || /^minimax_/i.test(voiceId);
}

/**
 * Novel / video TTS:
 * 1) Optional MiniMax gateway (`/v1/wand/minimax-tts/sync_tts`) — preferred for video narration
 * 2) Kokoro offline fallback
 * 3) Windows SoundPlayer for audible novel playback
 */
export class NovelTtsService {
  private readonly dependencies: NovelTtsServiceDependencies;
  private readonly kokoroEngine: NovelTtsKokoroEngine;
  private readonly nativePlayer: NovelTtsNativePlayer;
  private remoteController: AbortController | null = null;

  constructor(dependencies: NovelTtsServiceDependencies) {
    this.dependencies = dependencies;
    this.kokoroEngine = dependencies.kokoroEngine ?? new NovelTtsKokoroEngine({
      appendDebugLog: dependencies.appendDebugLog
    });
    this.nativePlayer = dependencies.nativePlayer ?? new NovelTtsNativePlayer({
      appendDebugLog: dependencies.appendDebugLog
    });
  }

  async synthesize(input: NovelTtsSynthesizeInput): Promise<NovelTtsSynthesizeResult> {
    const text = trimText(input.text);
    if (!text) return { ok: false, detail: "没有可朗读的内容。" };
    const wantPlayback = input.playback !== false;

    this.nativePlayer.stop();

    // Silent path for video timeline: durable audio + base64, no SoundPlayer.
    if (!wantPlayback) {
      const file = await this.synthesizeToFile({ ...input, preferGateway: input.preferGateway !== false });
      if (!file.ok || !file.audioBase64) {
        if (file.ok && file.audioPath) {
          try {
            const { readFile } = await import("node:fs/promises");
            const bytes = await readFile(file.audioPath);
            return {
              ok: true,
              audioBase64: bytes.toString("base64"),
              mimeType: file.mimeType || "audio/wav",
              provider: file.provider,
              runtime: file.runtime,
              durationMs: file.durationMs,
              audioPath: file.audioPath,
              playingInMain: false
            };
          } catch (error) {
            return { ok: false, detail: error instanceof Error ? error.message : "旁白音频读取失败。" };
          }
        }
        return { ok: false, detail: file.detail || "旁白生成失败。" };
      }
      return { ...file, playingInMain: false };
    }

    const kokoroVoiceId = this.resolveKokoroVoiceId(input.voiceId);
    const voice = resolveNovelTtsVoice(kokoroVoiceId);
    const kokoro = await this.kokoroEngine.synthesize({ text, voiceId: voice.id });
    if (kokoro.ok && kokoro.audioPath) {
      await this.dependencies.appendDebugLog?.(
        `novel tts kokoro ok runtime=${kokoro.runtime || "cpu"} voice=${voice.id}->${voice.kokoroVoice} path=${kokoro.audioPath}`
      );
      let audioBase64: string | undefined;
      try {
        const { readFile } = await import("node:fs/promises");
        audioBase64 = (await readFile(kokoro.audioPath)).toString("base64");
      } catch {
        audioBase64 = undefined;
      }
      const played = await this.nativePlayer.playWavFile(kokoro.audioPath, kokoro.durationMs);
      if (played.ok) {
        return {
          ok: true,
          audioBase64,
          provider: kokoro.provider || "kokoro-zh-offline",
          runtime: kokoro.runtime,
          playingInMain: true,
          durationMs: played.durationMs || kokoro.durationMs,
          mimeType: "audio/wav",
          audioPath: kokoro.audioPath
        };
      }
      await this.dependencies.appendDebugLog?.(
        `novel tts native play miss detail=${played.detail || "unknown"}`
      );
      return {
        ok: false,
        detail: played.detail || "离线音频合成成功但无法播放。"
      };
    }
    await this.dependencies.appendDebugLog?.(
      `novel tts kokoro miss detail=${kokoro.detail || "unknown"}`
    );

    if (this.dependencies.enableGatewaySpeech) {
      const remote = await this.synthesizeViaMinimax(text, input.voiceId);
      if (remote.ok) return remote;
    }

    return {
      ok: false,
      detail: kokoro.detail || "离线语音不可用，将尝试系统朗读。"
    };
  }

  /** Generate durable audio for project workflows without starting playback. Gateway-first when enabled. */
  async synthesizeToFile(input: NovelTtsSynthesizeInput): Promise<NovelTtsSynthesizeResult> {
    const text = trimText(input.text);
    if (!text) return { ok: false, detail: "没有可生成的内容。" };
    const preferGateway = isMinimaxVoiceId(input.voiceId) && input.preferGateway !== false && this.dependencies.enableGatewaySpeech;

    // A chosen remote voice must never silently become a different local speaker.
    if (isMinimaxVoiceId(input.voiceId) && !preferGateway) {
      return { ok: false, detail: "所选远程声音不可用，请启用配音网关后重试，或试听并选择本地声音。" };
    }

    if (preferGateway) {
      const remote = await this.synthesizeViaMinimax(text, input.voiceId);
      if (remote.ok && remote.audioBase64) {
        try {
          const { writeFile, mkdtemp } = await import("node:fs/promises");
          const { tmpdir } = await import("node:os");
          const { join } = await import("node:path");
          const dir = await mkdtemp(join(tmpdir(), "newbrain-minimax-tts-"));
          const ext = remote.mimeType?.includes("wav") ? ".wav" : ".mp3";
          const audioPath = join(dir, `narration${ext}`);
          await writeFile(audioPath, Buffer.from(remote.audioBase64, "base64"));
          return {
            ok: true,
            audioBase64: remote.audioBase64,
            audioPath,
            mimeType: remote.mimeType || "audio/mpeg",
            provider: remote.provider || "gateway-minimax-sync-tts"
          };
        } catch (error) {
          await this.dependencies.appendDebugLog?.(
            `novel tts minimax persist miss ${error instanceof Error ? error.message : String(error)}`
          );
          return remote;
        }
      }
      await this.dependencies.appendDebugLog?.(
        `novel tts minimax miss detail=${remote.detail || "unknown"}; selected voice preserved`
      );
      return { ok: false, detail: remote.detail || "所选声音生成失败，请重试；未切换音色或引擎。" };
    }

    const kokoroVoiceId = this.resolveKokoroVoiceId(input.voiceId);
    const voice = resolveNovelTtsVoice(kokoroVoiceId);
    const result = await this.kokoroEngine.synthesize({ text, voiceId: voice.id });
    if (!result.ok || !result.audioPath) {
      return { ok: false, detail: result.detail || "离线配音生成失败。" };
    }
    return {
      ok: true,
      audioPath: result.audioPath,
      mimeType: "audio/wav",
      provider: result.provider || "kokoro-zh-offline",
      runtime: result.runtime,
      durationMs: result.durationMs
    };
  }

  cancel() {
    this.remoteController?.abort(new Error("Novel speech cancelled"));
    this.remoteController = null;
    this.kokoroEngine.cancel();
    this.nativePlayer.stop();
  }

  private resolveKokoroVoiceId(voiceId: string) {
    if (isMinimaxVoiceId(voiceId)) {
      return resolveMinimaxNarrationVoice(voiceId as MinimaxNarrationVoiceId).kokoroVoiceId;
    }
    return voiceId;
  }

  private async synthesizeViaMinimax(
    text: string,
    voiceId: string
  ): Promise<NovelTtsSynthesizeResult> {
    const controller = new AbortController();
    this.remoteController?.abort(new Error("Novel speech replaced"));
    this.remoteController = controller;
    try {
      const [baseUrl, bearerToken] = await Promise.all([
        this.dependencies.readGatewayBaseUrl(),
        this.dependencies.readBearerToken()
      ]);
      if (!baseUrl || !bearerToken) {
        return { ok: false, detail: "未登录或网关不可用，请登录后重试。" };
      }
      const voice = resolveMinimaxNarrationVoice(
        isMinimaxVoiceId(voiceId) ? voiceId : undefined
      );
      await this.dependencies.appendDebugLog?.(
        `novel tts minimax request voice=${voice.id}->${voice.voiceId} chars=${text.length}`
      );
      const remote = await synthesizeMinimaxSyncTts({
        gatewayBaseUrl: baseUrl,
        bearerToken,
        text,
        voice,
        fetchImpl: this.dependencies.fetchImpl,
        signal: controller.signal
      });
      if (!remote.ok) {
        await this.dependencies.appendDebugLog?.(`novel tts minimax failed detail=${remote.detail || ""}`);
      }
      return remote;
    } catch (error) {
      const aborted = controller.signal.aborted
        || Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError");
      const detail = aborted
        ? "朗读已取消。"
        : "朗读服务请求失败，请重试。";
      await this.dependencies.appendDebugLog?.(
        `novel tts minimax error ${aborted ? "cancelled" : error instanceof Error ? error.message : String(error)}`
      );
      return { ok: false, detail };
    } finally {
      if (this.remoteController === controller) this.remoteController = null;
    }
  }
}
