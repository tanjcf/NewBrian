import { useRef, useState } from "react";
import { SidebarIcon } from "./SidebarIcon";
import {
  DEFAULT_NOVEL_TTS_VOICE_ID,
  mapSpeechOffsetToSourceLines,
  prepareNovelSpeechText,
  resolveNovelTtsVoice,
  storeNovelTtsVoiceId,
  type SpeechFollowTarget
} from "../../shared/novel-tts-policy";
import {
  isNovelSpeechActive,
  playNovelSpeech,
  stopNovelSpeech,
  type NovelSpeechCanceller,
  type NovelSpeechProgress,
  type NovelSpeechSynthesizer
} from "./novel-tts-playback";

type NovelTtsButtonProps = {
  text: string;
  /** Original source used for line follow-along (defaults to text). */
  sourceText?: string;
  disabled?: boolean;
  className?: string;
  synthesizer?: NovelSpeechSynthesizer;
  canceller?: NovelSpeechCanceller;
  onStatus?: (message: string) => void;
  onFollow?: (target: SpeechFollowTarget | null) => void;
};

export function NovelTtsButton({
  text,
  sourceText,
  disabled = false,
  className = "",
  synthesizer,
  canceller,
  onStatus,
  onFollow
}: NovelTtsButtonProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const playTokenRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  // Product ships a single fixed voice; no picker / no alternate selection.
  const selected = resolveNovelTtsVoice(DEFAULT_NOVEL_TTS_VOICE_ID);
  const followSource = sourceText || text;

  const emitFollow = (progress: NovelSpeechProgress | null) => {
    if (!progress) {
      onFollow?.(null);
      return;
    }
    onFollow?.(
      mapSpeechOffsetToSourceLines(followSource, progress.absoluteIndex, progress.chunkText)
    );
  };

  const stopReading = () => {
    playTokenRef.current += 1;
    stopNovelSpeech();
    setPlaying(false);
    emitFollow(null);
    onStatus?.("已停止朗读。");
  };

  const startReading = async () => {
    const prepared = prepareNovelSpeechText(text);
    if (!prepared.ok) {
      onStatus?.("没有可朗读的内容。");
      return;
    }
    if (!synthesizer) {
      onStatus?.("离线朗读通道未连接，将尝试系统朗读（可能无声）。");
    }
    const voice = selected;
    const token = playTokenRef.current + 1;
    playTokenRef.current = token;
    storeNovelTtsVoiceId(voice.id);
    setPlaying(true);
    onStatus?.(prepared.truncated ? `正在朗读（已截取前段）· ${voice.label}` : `正在朗读 · ${voice.label}`);
    try {
      const result = await playNovelSpeech({
        text: prepared.text,
        voice,
        synthesizer,
        canceller,
        onStatus,
        onProgress: emitFollow
      });
      if (playTokenRef.current !== token) return;
      if (!result.ok) {
        onStatus?.(result.detail || "朗读失败。");
        return;
      }
      if (result.stopped) {
        onStatus?.("已停止朗读。");
        return;
      }
      onStatus?.(
        result.mode === "local"
          ? `本地朗读完成 · ${voice.label}`
          : `朗读完成 · ${voice.label}`
      );
    } catch (error) {
      if (playTokenRef.current !== token) return;
      onStatus?.(error instanceof Error ? error.message : "朗读失败。");
    } finally {
      if (playTokenRef.current === token) {
        setPlaying(false);
        emitFollow(null);
      }
    }
  };

  const toggleMain = () => {
    if (playing || isNovelSpeechActive()) {
      stopReading();
      return;
    }
    void startReading();
  };

  return (
    <div
      ref={wrapRef}
      className={`novel-tts-wrap single-voice${playing ? " playing" : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        className="novel-tts-main"
        title={playing ? "停止朗读" : `智能朗读（${selected.label}）`}
        aria-label={playing ? "停止朗读" : `智能朗读（${selected.label}）`}
        aria-pressed={playing}
        disabled={disabled}
        onClick={toggleMain}
      >
        <SidebarIcon name={playing ? "stop" : "speaker"} />
      </button>
    </div>
  );
}
