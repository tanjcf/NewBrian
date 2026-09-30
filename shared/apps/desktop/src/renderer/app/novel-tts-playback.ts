import {
  NOVEL_TTS_LOCAL_CHUNK_CHARS,
  chunkNovelSpeechText,
  estimateFollowAbsoluteIndex,
  estimateFollowDurationMs,
  type NovelTtsVoice
} from "../../shared/novel-tts-policy";

export type NovelSpeechSynthesizer = (input: {
  text: string;
  voiceId: string;
  voiceLabel: string;
}) => Promise<{
  ok: boolean;
  audioBase64?: string;
  mimeType?: string;
  detail?: string;
  provider?: string;
  playingInMain?: boolean;
  durationMs?: number;
}>;

export type NovelSpeechCanceller = () => Promise<void> | void;

export type NovelSpeechProgress = {
  absoluteIndex: number;
  chunkIndex: number;
  totalChunks: number;
  chunkText: string;
  mode: "remote" | "local";
};

type PlayInput = {
  text: string;
  voice: NovelTtsVoice;
  synthesizer?: NovelSpeechSynthesizer;
  canceller?: NovelSpeechCanceller;
  onProgress?: (progress: NovelSpeechProgress) => void;
  onStatus?: (message: string) => void;
};

type PlayResult =
  | { ok: true; mode: "remote" | "local"; stopped?: boolean }
  | { ok: false; detail: string };

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let playGeneration = 0;
let activeCanceller: NovelSpeechCanceller | null = null;
let audioUnlocked = false;

/** Approximate Chinese narration speed (chars/sec) for follow-along when onboundary is missing. */
const LOCAL_CHARS_PER_SEC = 9;
/** SoundPlayer needs a moment after IPC returns before audible playback begins. */
const MAIN_PLAYBACK_STARTUP_LAG_MS = 700;

function chunkIndexForAbsolute(chunks: { end: number }[], absoluteIndex: number, totalChunks: number) {
  for (let index = 0; index < chunks.length; index += 1) {
    if (absoluteIndex < chunks[index]!.end) return index;
  }
  return Math.max(0, totalChunks - 1);
}

export function isNovelSpeechActive() {
  return Boolean(activeAudio && !activeAudio.paused) || Boolean(window.speechSynthesis?.speaking);
}

function revokeActiveObjectUrl() {
  if (!activeObjectUrl) return;
  try {
    URL.revokeObjectURL(activeObjectUrl);
  } catch {
    // ignore
  }
  activeObjectUrl = null;
}

export function stopNovelSpeech() {
  playGeneration += 1;
  const canceller = activeCanceller;
  activeCanceller = null;
  try {
    // Never await — cancel IPC must not freeze the renderer stop click.
    void Promise.resolve(canceller?.()).catch(() => undefined);
  } catch {
    // ignore
  }
  try {
    window.speechSynthesis?.cancel();
    window.speechSynthesis?.resume?.();
  } catch {
    // ignore
  }
  if (activeAudio) {
    try {
      activeAudio.onended = null;
      activeAudio.onerror = null;
      activeAudio.ontimeupdate = null;
      activeAudio.pause();
      activeAudio.removeAttribute("src");
      activeAudio.load();
    } catch {
      // ignore
    }
    activeAudio = null;
  }
  revokeActiveObjectUrl();
}

/** Keep a user-gesture audio unlock so async Kokoro results can still call audio.play(). */
async function unlockAudioPlayback() {
  if (audioUnlocked) return;
  try {
    const silent = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA="
    );
    silent.volume = 0.01;
    await silent.play();
    silent.pause();
    audioUnlocked = true;
  } catch {
    // First play may still work from the original click; ignore unlock failures.
  }
}

function base64ToBlob(audioBase64: string, mimeType: string) {
  const binary = window.atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || "audio/wav" });
}

function waitForLocalVoices(timeoutMs = 1_200): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const existing = synth.getVoices?.() ?? [];
  if (existing.length) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", onChange);
      resolve(synth.getVoices?.() ?? []);
    };
    const onChange = () => finish();
    const timer = window.setTimeout(finish, timeoutMs);
    synth.addEventListener?.("voiceschanged", onChange);
    void synth.getVoices?.();
  });
}

function pickLocalVoice(
  voice: NovelTtsVoice,
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const zh = voices.filter((item) => /zh|chinese|中文/i.test(`${item.lang} ${item.name}`));
  const pool = zh.length ? zh : voices;
  const preferFemale = /female|woman|girl|女性|女声|晓|婷|佳|yan|xiaoxiao|xiaoyi|huihui/i;
  const preferMale = /male|man|boy|男性|男声|云希|云健|云扬|yunxi|yunjian|yunyang|kangkang|jason/i;
  const ranked = [...pool].sort((left, right) => {
    const score = (item: SpeechSynthesisVoice) => {
      let value = 0;
      if (voice.local.preferName?.test(item.name)) value += 5;
      if (preferFemale.test(item.name) && voice.local.gender === "female") value += 2;
      if (preferMale.test(item.name) && voice.local.gender === "male") value += 2;
      if (/zh-CN|zh_CN|china/i.test(item.lang)) value += 1;
      return value;
    };
    return score(right) - score(left);
  });
  return ranked[0] || null;
}

function speakChunk(
  text: string,
  voice: NovelTtsVoice,
  voices: SpeechSynthesisVoice[],
  generation: number,
  absoluteBase: number,
  chunkIndex: number,
  totalChunks: number,
  onProgress?: (progress: NovelSpeechProgress) => void
): Promise<PlayResult> {
  return new Promise((resolve) => {
    if (generation !== playGeneration) {
      resolve({ ok: true, mode: "local", stopped: true });
      return;
    }
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      resolve({ ok: false, detail: "当前环境不支持本地朗读。" });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.volume = 1;
    utterance.rate = voice.local.rate;
    utterance.pitch = voice.local.pitch;
    const selected = pickLocalVoice(voice, voices);
    if (selected) {
      utterance.voice = selected;
      if (selected.lang) utterance.lang = selected.lang;
    }
    let settled = false;
    let estimated = 0;
    let heardSpeaking = false;
    const emit = (offsetInChunk: number) => {
      const clamped = Math.max(0, Math.min(text.length, Math.floor(offsetInChunk)));
      onProgress?.({
        absoluteIndex: absoluteBase + clamped,
        chunkIndex,
        totalChunks,
        chunkText: text.slice(clamped, clamped + 48),
        mode: "local"
      });
    };
    const finish = (result: PlayResult) => {
      if (settled) return;
      settled = true;
      window.clearInterval(tickTimer);
      window.clearTimeout(startWatch);
      resolve(result);
    };
    emit(0);
    // Critical: cancel() often skips onend/onerror — resolve when generation flips.
    const tickTimer = window.setInterval(() => {
      if (generation !== playGeneration || settled) {
        finish({ ok: true, mode: "local", stopped: true });
        return;
      }
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch {
        // ignore
      }
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        heardSpeaking = true;
        estimated = Math.min(
          text.length,
          estimated + LOCAL_CHARS_PER_SEC * Math.max(0.6, voice.local.rate) * 0.25
        );
        emit(estimated);
      }
    }, 250);
    const startWatch = window.setTimeout(() => {
      if (settled || generation !== playGeneration) return;
      if (!heardSpeaking && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        finish({
          ok: false,
          detail: "系统朗读没有发出声音。请改用离线音色，或检查 Windows 语音包。"
        });
      }
    }, 1_200);
    utterance.onboundary = (event) => {
      if (generation !== playGeneration) return;
      heardSpeaking = true;
      const charIndex = typeof event.charIndex === "number" ? event.charIndex : 0;
      estimated = Math.max(estimated, charIndex);
      emit(estimated);
    };
    utterance.onend = () => {
      if (generation !== playGeneration) {
        finish({ ok: true, mode: "local", stopped: true });
        return;
      }
      emit(text.length);
      finish({ ok: true, mode: "local" });
    };
    utterance.onerror = () => {
      if (generation !== playGeneration) finish({ ok: true, mode: "local", stopped: true });
      else finish({ ok: false, detail: "本地朗读失败。" });
    };
    try {
      try {
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }
      window.speechSynthesis.speak(utterance);
    } catch {
      finish({ ok: false, detail: "本地朗读失败。" });
    }
  });
}

async function playWithSpeechSynthesis(
  text: string,
  voice: NovelTtsVoice,
  generation: number,
  onProgress?: (progress: NovelSpeechProgress) => void
): Promise<PlayResult> {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
    return { ok: false, detail: "当前环境不支持本地朗读。" };
  }
  const voices = await waitForLocalVoices();
  if (generation !== playGeneration) return { ok: true, mode: "local", stopped: true };
  const chunks = chunkNovelSpeechText(text, NOVEL_TTS_LOCAL_CHUNK_CHARS);
  if (!chunks.length) return { ok: false, detail: "没有可朗读的内容。" };
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    if (generation !== playGeneration) return { ok: true, mode: "local", stopped: true };
    const chunk = chunks[chunkIndex]!;
    const result = await speakChunk(
      chunk.text,
      voice,
      voices,
      generation,
      chunk.start,
      chunkIndex,
      chunks.length,
      onProgress
    );
    if (!result.ok || result.stopped) return result;
  }
  return { ok: true, mode: "local" };
}

async function playMainDrivenProgress(
  text: string,
  durationMs: number,
  generation: number,
  onProgress?: (progress: NovelSpeechProgress) => void
): Promise<PlayResult> {
  const chunks = chunkNovelSpeechText(text, NOVEL_TTS_LOCAL_CHUNK_CHARS);
  const totalChunks = Math.max(1, chunks.length);
  // Clock = real WAV length only (do not alter speech). Startup lag waits for SoundPlayer.
  const wavDuration = estimateFollowDurationMs(text, durationMs);
  const uiDuration = wavDuration + MAIN_PLAYBACK_STARTUP_LAG_MS;
  const started = performance.now();
  onProgress?.({
    absoluteIndex: 0,
    chunkIndex: 0,
    totalChunks,
    chunkText: text.slice(0, 48),
    mode: "remote"
  });
  return await new Promise<PlayResult>((resolve) => {
    const timer = window.setInterval(() => {
      if (generation !== playGeneration) {
        window.clearInterval(timer);
        resolve({ ok: true, mode: "remote", stopped: true });
        return;
      }
      const elapsed = Math.max(0, performance.now() - started - MAIN_PLAYBACK_STARTUP_LAG_MS);
      const absoluteIndex = estimateFollowAbsoluteIndex(text, elapsed, wavDuration);
      const chunkIndex = chunkIndexForAbsolute(chunks, absoluteIndex, totalChunks);
      onProgress?.({
        absoluteIndex,
        chunkIndex,
        totalChunks,
        chunkText: text.slice(absoluteIndex, absoluteIndex + 48),
        mode: "remote"
      });
      if (elapsed >= wavDuration || performance.now() - started >= uiDuration) {
        window.clearInterval(timer);
        resolve({ ok: true, mode: "remote" });
      }
    }, 200);
  });
}

async function playRemoteAudio(
  audioBase64: string,
  mimeType: string,
  text: string,
  generation: number,
  onProgress?: (progress: NovelSpeechProgress) => void
): Promise<PlayResult> {
  if (generation !== playGeneration) return { ok: true, mode: "remote", stopped: true };
  revokeActiveObjectUrl();
  const blob = base64ToBlob(audioBase64, mimeType || "audio/wav");
  if (blob.size < 64) {
    return { ok: false, detail: "离线音频为空，无法播放。" };
  }
  const objectUrl = URL.createObjectURL(blob);
  activeObjectUrl = objectUrl;
  const audio = new Audio(objectUrl);
  audio.volume = 1;
  audio.muted = false;
  activeAudio = audio;
  const chunks = chunkNovelSpeechText(text, NOVEL_TTS_LOCAL_CHUNK_CHARS);
  const totalChunks = Math.max(1, chunks.length);
  onProgress?.({
    absoluteIndex: 0,
    chunkIndex: 0,
    totalChunks,
    chunkText: chunks[0]?.text || text.slice(0, 48),
    mode: "remote"
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let started = false;
      const startWatch = window.setTimeout(() => {
        if (!started && generation === playGeneration) {
          reject(new Error("音频未能开始播放（可能被浏览器拦截）。请再点一次喇叭。"));
        }
      }, 2_000);
      audio.ontimeupdate = () => {
        if (generation !== playGeneration) return;
        if (audio.currentTime > 0) started = true;
        if (!audio.duration || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        const absoluteIndex = estimateFollowAbsoluteIndex(
          text,
          audio.currentTime * 1000,
          audio.duration * 1000
        );
        const chunkIndex = chunkIndexForAbsolute(chunks, absoluteIndex, totalChunks);
        onProgress?.({
          absoluteIndex,
          chunkIndex,
          totalChunks,
          chunkText: text.slice(absoluteIndex, absoluteIndex + 48),
          mode: "remote"
        });
      };
      audio.onended = () => {
        window.clearTimeout(startWatch);
        resolve();
      };
      audio.onerror = () => {
        window.clearTimeout(startWatch);
        reject(new Error("音频播放失败。"));
      };
      void audio.play().then(() => {
        started = true;
      }).catch((error) => {
        window.clearTimeout(startWatch);
        reject(error instanceof Error ? error : new Error("音频播放失败。"));
      });
    });
  } finally {
    if (activeAudio === audio) activeAudio = null;
    if (activeObjectUrl === objectUrl) revokeActiveObjectUrl();
  }
  if (generation !== playGeneration) return { ok: true, mode: "remote", stopped: true };
  return { ok: true, mode: "remote" };
}

export async function playNovelSpeech(input: PlayInput): Promise<PlayResult> {
  stopNovelSpeech();
  const generation = playGeneration;
  activeCanceller = input.canceller || null;
  await unlockAudioPlayback();
  if (generation !== playGeneration) return { ok: true, mode: "remote", stopped: true };

  if (input.synthesizer) {
    input.onStatus?.(`正在加载离线音色 · ${input.voice.label}（首次可能需 1–2 分钟）`);
    try {
      const remote = await input.synthesizer({
        text: input.text,
        voiceId: input.voice.id,
        voiceLabel: input.voice.label
      });
      if (generation !== playGeneration) return { ok: true, mode: "remote", stopped: true };
      if (remote.ok && remote.playingInMain) {
        input.onStatus?.(`正在朗读 · ${input.voice.label}`);
        return playMainDrivenProgress(
          input.text,
          remote.durationMs || Math.max(1500, input.text.length * 110),
          generation,
          input.onProgress
        );
      }
      if (remote.ok && remote.audioBase64) {
        input.onStatus?.(`离线音色就绪 · ${input.voice.label}`);
        try {
          return await playRemoteAudio(
            remote.audioBase64,
            remote.mimeType || "audio/wav",
            input.text,
            generation,
            input.onProgress
          );
        } catch (error) {
          // Do not silently pretend we are reading — surface the real play failure.
          return {
            ok: false,
            detail:
              error instanceof Error
                ? `离线音频无法播放：${error.message}`
                : "离线音频无法播放。"
          };
        }
      }
      input.onStatus?.(
        remote.detail
          ? `${remote.detail} 改用系统朗读。`
          : "离线音色不可用，改用系统朗读。"
      );
    } catch (error) {
      try {
        void Promise.resolve(input.canceller?.()).catch(() => undefined);
      } catch {
        // ignore
      }
      input.onStatus?.(
        error instanceof Error
          ? error.message
          : "离线朗读失败，改用系统朗读。"
      );
    }
  }
  if (generation !== playGeneration) return { ok: true, mode: "local", stopped: true };
  return playWithSpeechSynthesis(input.text, input.voice, generation, input.onProgress);
}
