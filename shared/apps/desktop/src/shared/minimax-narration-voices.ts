/**
 * MiniMax narration voice profiles for video pipeline UI + gateway client.
 * Only one evidenced Minimax voice_id in-repo; profiles vary speed/pitch.
 */

export const MINIMAX_TTS_MODEL = "minimax-speech-2.8-hd";
export const MINIMAX_DEFAULT_VOICE_ID = "minimax_55e81114-ce7e-4ca1";

export type MinimaxNarrationVoiceId = "narration_default" | "narration_brighter" | "narration_deeper";

export type MinimaxNarrationVoice = {
  id: MinimaxNarrationVoiceId;
  label: string;
  hint: string;
  voiceId: string;
  speed: number;
  vol: number;
  pitch: number;
  /** Kokoro / novel-tts fallback role. */
  kokoroVoiceId: string;
};

/** Three selectable profiles; share the one known Minimax voice_id. */
export const MINIMAX_NARRATION_VOICES: MinimaxNarrationVoice[] = [
  {
    id: "narration_default",
    label: "旁白·标准",
    hint: "MiniMax HD 默认旁白",
    voiceId: MINIMAX_DEFAULT_VOICE_ID,
    speed: 1,
    vol: 1,
    pitch: 0,
    kokoroVoiceId: "calm_narrator"
  },
  {
    id: "narration_brighter",
    label: "旁白·稍快",
    hint: "略快、偏亮（同音色）",
    voiceId: MINIMAX_DEFAULT_VOICE_ID,
    speed: 1.08,
    vol: 1,
    pitch: 1,
    kokoroVoiceId: "youth_bright"
  },
  {
    id: "narration_deeper",
    label: "旁白·沉稳",
    hint: "略慢、偏低（同音色）",
    voiceId: MINIMAX_DEFAULT_VOICE_ID,
    speed: 0.92,
    vol: 1,
    pitch: -1,
    kokoroVoiceId: "uncle_classic"
  }
];

export const DEFAULT_MINIMAX_NARRATION_VOICE_ID: MinimaxNarrationVoiceId = "narration_default";
export const MINIMAX_NARRATION_VOICE_STORAGE_KEY = "newbrain.videoMinimaxNarrationVoice.v1";

export function resolveMinimaxNarrationVoice(voiceId?: string | null): MinimaxNarrationVoice {
  return (
    MINIMAX_NARRATION_VOICES.find((voice) => voice.id === voiceId)
    || MINIMAX_NARRATION_VOICES.find((voice) => voice.id === DEFAULT_MINIMAX_NARRATION_VOICE_ID)
    || MINIMAX_NARRATION_VOICES[0]!
  );
}

export function readStoredMinimaxNarrationVoiceId(): MinimaxNarrationVoiceId {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_MINIMAX_NARRATION_VOICE_ID;
    const raw = localStorage.getItem(MINIMAX_NARRATION_VOICE_STORAGE_KEY);
    if (raw && MINIMAX_NARRATION_VOICES.some((voice) => voice.id === raw)) {
      return raw as MinimaxNarrationVoiceId;
    }
  } catch { /* ignore */ }
  return DEFAULT_MINIMAX_NARRATION_VOICE_ID;
}

export function storeMinimaxNarrationVoiceId(voiceId: MinimaxNarrationVoiceId) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(MINIMAX_NARRATION_VOICE_STORAGE_KEY, voiceId);
  } catch { /* ignore */ }
}
