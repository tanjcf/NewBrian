import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

/** Title/subtitle clip drawn over the monitor (WYSIWYG). */
export type WorkspaceVideoTextOverlay = {
  id: string;
  text: string;
  fontSize: number;
  color: string;
  /** Normalized center X (0–1). Default 0.5. */
  x?: number;
  /** Normalized center Y (0–1). Default 0.5. */
  y?: number;
  /** Uniform scale on fontSize. Default 1. */
  scale?: number;
  /** Optional max width as fraction of frame. */
  width?: number;
  /** Higher = drawn above (e.g. V2 over V1). */
  zIndex?: number;
  selected?: boolean;
};

/**
 * Premiere-like subtitle layer: positions by normalized x/y (default center),
 * scales design px to the live monitor, and supports in-place edit.
 */
export function PreviewTextOverlayLayer(props: {
  items: WorkspaceVideoTextOverlay[];
  canvasWidth?: number;
  canvasHeight?: number;
  className?: string;
  onSelect?: (id: string) => void;
  onChange?: (id: string, text: string) => void;
  onCommit?: (id: string) => void;
  onMovePointerDown?: (event: ReactMouseEvent, id: string) => void;
  onScalePointerDown?: (event: ReactMouseEvent, id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const canvasW = Math.max(1, Number(props.canvasWidth) || 1920);
  const canvasH = Math.max(1, Number(props.canvasHeight) || 1080);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const next = Math.min(rect.width / canvasW, rect.height / canvasH);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [canvasW, canvasH]);

  if (!props.items.length) return null;

  return (
    <div
      ref={rootRef}
      className={`brain-video-pipe__text-overlays${props.className ? ` ${props.className}` : ""}`}
      data-testid="brain-video-text-overlays"
      aria-label="字幕预览"
    >
      {props.items.map((item) => (
        <PreviewTextOverlayItem
          key={item.id}
          item={item}
          monitorScale={scale}
          onSelect={props.onSelect}
          onChange={props.onChange}
          onCommit={props.onCommit}
          onMovePointerDown={props.onMovePointerDown}
          onScalePointerDown={props.onScalePointerDown}
        />
      ))}
    </div>
  );
}

function PreviewTextOverlayItem(props: {
  item: WorkspaceVideoTextOverlay;
  monitorScale: number;
  onSelect?: (id: string) => void;
  onChange?: (id: string, text: string) => void;
  onCommit?: (id: string) => void;
  onMovePointerDown?: (event: ReactMouseEvent, id: string) => void;
  onScalePointerDown?: (event: ReactMouseEvent, id: string) => void;
}) {
  const { item } = props;
  const userScale = Math.max(0.2, Math.min(5, Number(item.scale) || 1));
  const fontPx = Math.max(10, Math.round((Number(item.fontSize) || 48) * userScale * props.monitorScale));
  const color = /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : "#ffffff";
  const x = Number.isFinite(item.x) ? Math.min(1, Math.max(0, Number(item.x))) : 0.5;
  const y = Number.isFinite(item.y) ? Math.min(1, Math.max(0, Number(item.y))) : 0.5;
  const maxWidthPct = item.width !== undefined && Number.isFinite(item.width)
    ? Math.min(100, Math.max(8, Number(item.width) * 100))
    : 90;
  const style: CSSProperties = {
    color,
    fontSize: `${fontPx}px`,
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    maxWidth: `${maxWidthPct}%`,
    zIndex: Math.max(1, Number(item.zIndex) || 1)
  };

  return (
    <div
      className={`brain-video-pipe__text-overlay${item.selected ? " brain-video-pipe__text-overlay--selected" : ""}`}
      data-testid="brain-video-text-overlay"
      data-text-id={item.id}
      style={style}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (!item.selected) props.onSelect?.(item.id);
      }}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect?.(item.id);
      }}
    >
      <PreviewTextOverlayEditable
        textId={item.id}
        text={item.text}
        selected={Boolean(item.selected)}
        onSelect={() => props.onSelect?.(item.id)}
        onChange={(next) => props.onChange?.(item.id, next)}
        onCommit={() => props.onCommit?.(item.id)}
      />
      {item.selected ? (
        <>
          <button
            type="button"
            className="brain-video-pipe__text-overlay-handle brain-video-pipe__text-overlay-handle--move"
            title="拖动位置"
            aria-label="拖动字幕位置"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onSelect?.(item.id);
              props.onMovePointerDown?.(event, item.id);
            }}
          />
          {(["nw", "ne", "sw", "se"] as const).map((corner) => (
            <button
              key={corner}
              type="button"
              className={`brain-video-pipe__text-overlay-handle brain-video-pipe__text-overlay-handle--scale brain-video-pipe__text-overlay-handle--${corner}`}
              title="拖动缩放"
              aria-label={`缩放字幕 ${corner}`}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onSelect?.(item.id);
                props.onScalePointerDown?.(event, item.id);
              }}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

/** contentEditable body synced to textClips; safe while focused (no cursor reset). */
export function PreviewTextOverlayEditable(props: {
  textId: string;
  text: string;
  selected: boolean;
  onSelect?: () => void;
  onChange?: (text: string) => void;
  onCommit?: () => void;
  onMovePointerDown?: (event: ReactMouseEvent) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focusedRef.current) return;
    const next = String(props.text ?? "");
    if (el.textContent !== next) el.textContent = next || "";
  }, [props.textId, props.text]);

  return (
    <div
      ref={ref}
      className="brain-video-pipe__text-overlay-body"
      role="textbox"
      tabIndex={0}
      contentEditable={Boolean(props.selected)}
      suppressContentEditableWarning
      onFocus={() => {
        focusedRef.current = true;
        props.onSelect?.();
      }}
      onInput={() => {
        props.onChange?.(ref.current?.textContent ?? "");
      }}
      onBlur={() => {
        focusedRef.current = false;
        props.onChange?.(ref.current?.textContent ?? "");
        props.onCommit?.();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          (event.currentTarget as HTMLDivElement).blur();
        }
      }}
    />
  );
}

/** One audible A-track in the preview mix (A1 旁白 + A2 原声, …). */
export type WorkspaceMixAudioTrack = {
  id: string;
  url: string;
  muted?: boolean;
  /** Linear gain 0–2. */
  gain?: number;
  /** Timeline clock when clip starts (audio.currentTime = clock - offsetSec). */
  offsetSec: number;
  /** Timeline clock when clip ends; outside range → pause. */
  endSec?: number;
};

/**
 * Incoming clip for sequence preview transitions (FFmpeg xfade analogue).
 * Applied over the last `durationSec` of the primary video.
 */
export type WorkspaceVideoTransitionLayer = {
  url: string;
  /** UI transition id: fade | fade-0.6 | dissolve | wipe-left | blur */
  kind: string;
  durationSec: number;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Stable HTML5 video preview for workspace artifacts.
 * Assigns `src` imperatively so parent re-renders do not reset playback.
 * Optional narrationUrl / mixTracks play synced A-track audio with Mute/Solo.
 * mixTracks plays ALL unmuted lanes simultaneously (Premiere-style mix).
 * When previewUrl is empty but audio is set, audio becomes the master
 * clock (narration-only shots still show a playable letterbox monitor).
 * playToken forces play after sequence clip advances (Premiere-like playlist).
 */
export function WorkspaceVideoViewer(props: {
  previewUrl: string;
  name?: string;
  aspectRatio?: number;
  onEnded?: () => void;
  autoPlay?: boolean;
  /** Bump to force play() after src swap (full-sequence advance). */
  playToken?: number;
  /** When true, each new previewUrl starts at 0 (sequence playlist). */
  resetOnSrcChange?: boolean;
  muted?: boolean;
  /** Separate narration / TTS track URL (blob or file preview). Legacy single-track. */
  narrationUrl?: string;
  /** Mute only the narration track (A1 M/S + clip mute). */
  narrationMuted?: boolean;
  /**
   * Linear gain for narration (0–2). Uses Web Audio GainNode so values >1 work.
   * Interpolated from volume keyframes / baseline by the parent.
   */
  narrationGain?: number;
  /**
   * When previewing a full-timeline export, map video clock → local narration:
   * audioTime = video.currentTime - narrationOffsetSec.
   */
  narrationOffsetSec?: number;
  /**
   * Multi-track mix: every unmuted A clip under the playhead.
   * When non-empty, overrides single narrationUrl for playback.
   */
  mixTracks?: WorkspaceMixAudioTrack[];
  /** Hide picture but keep audio (track eye / Toggle Track Output). */
  videoHidden?: boolean;
  /** Seek request in seconds; parent bumps a token to re-apply the same time. */
  seekTo?: number | null;
  seekToken?: number;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onDurationChange?: (duration: number) => void;
  /** Fired when narration play() fails (autoplay policy / missing decode). */
  onNarrationError?: (detail: string) => void;
  /**
   * Next-clip URL + kind for in-monitor dissolve/blur/wipe during the last
   * `durationSec` of the primary clip (sequence preview only).
   */
  transitionLayer?: WorkspaceVideoTransitionLayer | null;
  /**
   * Seconds of the incoming clip already shown during the outgoing blend.
   * Parent should seek the next primary clip to this offset after onEnded.
   */
  onTransitionConsumed?: (consumedSec: number) => void;
  /** Active text clips to draw as WYSIWYG overlays on the monitor. */
  textOverlays?: WorkspaceVideoTextOverlay[];
  canvasWidth?: number;
  canvasHeight?: number;
  onSelectTextOverlay?: (id: string) => void;
  onChangeTextOverlay?: (id: string, text: string) => void;
  onCommitTextOverlay?: (id: string) => void;
  onMoveTextOverlay?: (event: ReactMouseEvent, id: string) => void;
  onScaleTextOverlay?: (event: ReactMouseEvent, id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const incomingRef = useRef<HTMLVideoElement | null>(null);
  const transitionProgressRef = useRef(0);
  const transitionConsumedRef = useRef(0);
  const [transitionProgress, setTransitionProgress] = useState(0);
  const narrationRef = useRef<HTMLAudioElement | null>(null);
  const mixHostRef = useRef<HTMLDivElement | null>(null);
  const mixAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const mixGraphRefs = useRef<Map<string, { ctx: AudioContext; gain: GainNode; source: MediaElementAudioSourceNode }>>(new Map());
  const mixTracksRef = useRef<WorkspaceMixAudioTrack[]>([]);
  const activeSrcRef = useRef("");
  const activeNarrationRef = useRef("");
  const narrationOffsetRef = useRef(0);
  const narrationGainRef = useRef(1);
  const audioGraphRef = useRef<{ ctx: AudioContext; gain: GainNode; source: MediaElementAudioSourceNode } | null>(null);
  const endedNotifiedRef = useRef(false);
  const onTimeUpdateRef = useRef(props.onTimeUpdate);
  const onDurationChangeRef = useRef(props.onDurationChange);
  const onEndedRef = useRef(props.onEnded);
  const onNarrationErrorRef = useRef(props.onNarrationError);
  const onTransitionConsumedRef = useRef(props.onTransitionConsumed);
  onTimeUpdateRef.current = props.onTimeUpdate;
  onDurationChangeRef.current = props.onDurationChange;
  onEndedRef.current = props.onEnded;
  onNarrationErrorRef.current = props.onNarrationError;
  onTransitionConsumedRef.current = props.onTransitionConsumed;
  narrationOffsetRef.current = Math.max(0, Number(props.narrationOffsetSec) || 0);
  narrationGainRef.current = Math.max(0, Math.min(2, Number(props.narrationGain) || 1));
  const mixTracks = Array.isArray(props.mixTracks) ? props.mixTracks : [];
  mixTracksRef.current = mixTracks;
  const useMix = mixTracks.length > 0;

  const hasVideoSrc = Boolean(String(props.previewUrl || "").trim());
  const hasNarrationSrc = Boolean(String(props.narrationUrl || "").trim());
  const hasMixSrc = useMix && mixTracks.some((track) => String(track.url || "").trim());
  const audioIsMaster = !hasVideoSrc && (hasMixSrc || hasNarrationSrc);

  const ensureNarrationGraph = (audio: HTMLAudioElement) => {
    if (audioGraphRef.current) return audioGraphRef.current;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      gain.gain.value = narrationGainRef.current;
      source.connect(gain);
      gain.connect(ctx.destination);
      audioGraphRef.current = { ctx, gain, source };
      // Element volume stays at 1; GainNode owns audible level (supports >100%).
      audio.volume = 1;
      return audioGraphRef.current;
    } catch {
      return null;
    }
  };

  const applyNarrationGain = (audio: HTMLAudioElement | null) => {
    if (!audio) return;
    const linear = Math.max(0, Math.min(2, narrationGainRef.current));
    // Clean path at ≤100%: keep native HTMLAudioElement output (matches OS/media-bin
    // playback). MediaElementSource + AudioContext resamples 32 kHz MiniMax TTS and
    // can make旁白 sound thin/ugly even when gain is 1.0.
    if (linear <= 1.001 && !audioGraphRef.current) {
      audio.volume = linear;
      return;
    }
    const graph = ensureNarrationGraph(audio);
    if (graph) {
      try {
        if (graph.ctx.state === "suspended") void graph.ctx.resume();
      } catch { /* ignore */ }
      graph.gain.gain.value = linear;
      audio.volume = 1;
      return;
    }
    // Fallback when Web Audio is unavailable: HTMLMediaElement clamps to 0–1.
    audio.volume = Math.max(0, Math.min(1, linear));
  };

  const ensureMixGraph = (id: string, audio: HTMLAudioElement, gainValue: number) => {
    const existing = mixGraphRefs.current.get(id);
    if (existing) return existing;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(2, gainValue));
      source.connect(gain);
      gain.connect(ctx.destination);
      const graph = { ctx, gain, source };
      mixGraphRefs.current.set(id, graph);
      audio.volume = 1;
      return graph;
    } catch {
      return null;
    }
  };

  const applyMixGain = (id: string, audio: HTMLAudioElement, gainValue: number) => {
    const linear = Math.max(0, Math.min(2, gainValue));
    if (linear <= 1.001 && !mixGraphRefs.current.has(id)) {
      audio.volume = linear;
      return;
    }
    const graph = ensureMixGraph(id, audio, linear);
    if (graph) {
      try {
        if (graph.ctx.state === "suspended") void graph.ctx.resume();
      } catch { /* ignore */ }
      graph.gain.gain.value = linear;
      audio.volume = 1;
      return;
    }
    audio.volume = Math.max(0, Math.min(1, linear));
  };

  const localMixTime = (clockSec: number, offsetSec: number) => {
    return Math.max(0, (Number.isFinite(clockSec) ? clockSec : 0) - Math.max(0, offsetSec || 0));
  };

  const syncMixTrackToClock = (track: WorkspaceMixAudioTrack, clockSec: number, shouldPlay: boolean) => {
    const audio = mixAudioRefs.current.get(track.id);
    if (!audio) return;
    const url = String(track.url || "").trim();
    if (!url) return;
    const endSec = Number.isFinite(track.endSec) ? Number(track.endSec) : Number.POSITIVE_INFINITY;
    const inRange = clockSec >= track.offsetSec - 0.02 && clockSec < endSec;
    audio.muted = Boolean(track.muted) || !inRange;
    applyMixGain(track.id, audio, track.gain ?? 1);
    if (!inRange || track.muted) {
      try { audio.pause(); } catch { /* ignore */ }
      return;
    }
    const want = localMixTime(clockSec, track.offsetSec);
    try {
      if (Math.abs((audio.currentTime || 0) - want) > 0.25) {
        audio.currentTime = Math.min(want, Number.isFinite(audio.duration) ? audio.duration : want);
      }
    } catch { /* ignore seek before metadata */ }
    if (shouldPlay && !audio.muted) {
      void audio.play().catch((error) => {
        const detail = error instanceof Error ? error.message : String(error || "play failed");
        onNarrationErrorRef.current?.(detail);
      });
    }
  };

  const syncAllMixToClock = (clockSec: number, shouldPlay: boolean) => {
    for (const track of mixTracksRef.current) {
      syncMixTrackToClock(track, clockSec, shouldPlay);
    }
  };

  const pauseAllMix = () => {
    for (const audio of mixAudioRefs.current.values()) {
      try { audio.pause(); } catch { /* ignore */ }
    }
  };

  const playWhenReady = (video: HTMLVideoElement) => {
    const start = () => {
      endedNotifiedRef.current = false;
      void video.play().catch(() => undefined);
    };
    if (video.readyState >= 2) start();
    else {
      video.addEventListener("canplay", start, { once: true });
      video.addEventListener("loadeddata", start, { once: true });
      video.addEventListener("loadedmetadata", start, { once: true });
    }
  };

  const playNarrationMaster = (audio: HTMLAudioElement) => {
    if (audio.muted) return;
    const start = () => {
      endedNotifiedRef.current = false;
      void audio.play().catch((error) => {
        const detail = error instanceof Error ? error.message : String(error || "play failed");
        onNarrationErrorRef.current?.(detail);
      });
    };
    if (audio.readyState >= 2) start();
    else {
      audio.addEventListener("canplay", start, { once: true });
      audio.addEventListener("loadeddata", start, { once: true });
    }
  };

  const localNarrationTime = (videoTime: number) => {
    const offset = narrationOffsetRef.current;
    return Math.max(0, (Number.isFinite(videoTime) ? videoTime : 0) - offset);
  };

  const playNarrationSynced = (video: HTMLVideoElement, audio: HTMLAudioElement) => {
    if (!activeNarrationRef.current || audio.muted) return;
    const want = localNarrationTime(video.currentTime || 0);
    try {
      applyNarrationGain(audio);
      if (Math.abs((audio.currentTime || 0) - want) > 0.25) {
        audio.currentTime = Math.min(want, Number.isFinite(audio.duration) ? audio.duration : want);
      }
    } catch {
      // ignore seek before metadata
    }
    const start = () => {
      void audio.play().catch((error) => {
        const detail = error instanceof Error ? error.message : String(error || "play failed");
        onNarrationErrorRef.current?.(detail);
      });
    };
    if (audio.readyState >= 2) start();
    else {
      audio.addEventListener("canplay", start, { once: true });
      audio.addEventListener("loadeddata", start, { once: true });
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextSrc = String(props.previewUrl || "").trim();
    if (!nextSrc) {
      activeSrcRef.current = "";
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // ignore
      }
      return;
    }
    if (activeSrcRef.current === nextSrc) return;
    endedNotifiedRef.current = false;
    const resumeTime = !props.resetOnSrcChange
      && activeSrcRef.current
      && Number.isFinite(video.currentTime)
      ? video.currentTime
      : 0;
    activeSrcRef.current = nextSrc;
    try { video.pause(); } catch { /* ignore */ }
    video.src = nextSrc;
    video.load();
    if (resumeTime > 0.05) {
      const restore = () => {
        if (video.currentTime + 0.25 < resumeTime) video.currentTime = resumeTime;
      };
      video.addEventListener("loadedmetadata", restore, { once: true });
    } else {
      try { video.currentTime = 0; } catch { /* ignore */ }
    }
    if (props.autoPlay) playWhenReady(video);
  }, [props.previewUrl, props.autoPlay, props.resetOnSrcChange]);

  // Maintain one HTMLAudioElement per mix track id (A1 + A2 + …).
  useEffect(() => {
    if (!useMix) {
      for (const [id, audio] of [...mixAudioRefs.current]) {
        try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch { /* ignore */ }
        audio.remove();
        mixAudioRefs.current.delete(id);
        mixGraphRefs.current.delete(id);
      }
      return;
    }
    const host = mixHostRef.current;
    if (!host) return;
    const wanted = new Set(mixTracks.map((track) => track.id));
    for (const [id, audio] of [...mixAudioRefs.current]) {
      if (wanted.has(id)) continue;
      try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch { /* ignore */ }
      audio.remove();
      mixAudioRefs.current.delete(id);
      mixGraphRefs.current.delete(id);
    }
    const video = videoRef.current;
    const clock = audioIsMaster
      ? (mixAudioRefs.current.values().next().value?.currentTime || 0)
      : (video?.currentTime || 0);
    const shouldPlay = audioIsMaster
      ? Boolean(props.autoPlay || (props.playToken && props.playToken > 0))
      : Boolean(video && !video.paused);
    for (const track of mixTracks) {
      const url = String(track.url || "").trim();
      if (!url) continue;
      let audio = mixAudioRefs.current.get(track.id);
      if (!audio) {
        audio = document.createElement("audio");
        audio.preload = "auto";
        audio.hidden = true;
        audio.setAttribute("data-mix-id", track.id);
        host.appendChild(audio);
        mixAudioRefs.current.set(track.id, audio);
      }
      if (audio.dataset.src !== url) {
        audio.dataset.src = url;
        audio.src = url;
        applyMixGain(track.id, audio, track.gain ?? 1);
        audio.load();
      } else {
        applyMixGain(track.id, audio, track.gain ?? 1);
      }
      audio.muted = Boolean(track.muted);
    }
    syncAllMixToClock(clock, shouldPlay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useMix, mixTracks.map((t) => [t.id, t.url, t.muted ? 1 : 0, t.gain ?? 1, t.offsetSec, t.endSec ?? ""].join("|")).join(";"), audioIsMaster, props.autoPlay, props.playToken]);

  const consumedPlayTokenRef = useRef(props.playToken);
  useEffect(() => {
    const requestedPlay = props.playToken !== consumedPlayTokenRef.current;
    consumedPlayTokenRef.current = props.playToken;
    if (!props.autoPlay && !requestedPlay) {
      videoRef.current?.pause();
      narrationRef.current?.pause();
      pauseAllMix();
      return;
    }
    endedNotifiedRef.current = false;
    if (audioIsMaster) {
      if (useMix) {
        syncAllMixToClock(0, true);
        return;
      }
      const audio = narrationRef.current;
      if (!audio || !activeNarrationRef.current) return;
      if (audio.ended || audio.paused) {
        try {
          if (audio.ended) audio.currentTime = Math.min(audio.currentTime, Math.max((audio.duration || 1) - 0.05, 0));
        } catch { /* ignore */ }
      }
      playNarrationMaster(audio);
      return;
    }
    const video = videoRef.current;
    if (!video || !activeSrcRef.current) return;
    if (video.ended || video.paused) {
      try { if (video.ended) video.currentTime = Math.min(video.currentTime, Math.max((video.duration || 1) - 0.05, 0)); } catch { /* ignore */ }
    }
    playWhenReady(video);
  }, [props.playToken, props.autoPlay, audioIsMaster, useMix]);

  useEffect(() => {
    const audio = narrationRef.current;
    if (!audio) return;
    if (useMix) {
      activeNarrationRef.current = "";
      try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch { /* ignore */ }
      return;
    }
    const nextSrc = String(props.narrationUrl || "").trim();
    if (!nextSrc) {
      activeNarrationRef.current = "";
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {
        // ignore
      }
      return;
    }
    if (activeNarrationRef.current === nextSrc) return;
    activeNarrationRef.current = nextSrc;
    endedNotifiedRef.current = false;
    audio.src = nextSrc;
    applyNarrationGain(audio);
    audio.load();
    const video = videoRef.current;
    if (audioIsMaster) {
      try { audio.currentTime = 0; } catch { /* ignore */ }
      if (props.autoPlay || (props.playToken && props.playToken > 0)) {
        playNarrationMaster(audio);
      }
      return;
    }
    const startAt = localNarrationTime(video?.currentTime || 0);
    try { audio.currentTime = startAt; } catch { /* ignore */ }
    if (video && !video.paused && !audio.muted) {
      playNarrationSynced(video, audio);
    }
  }, [props.narrationUrl, audioIsMaster, props.autoPlay, props.playToken, useMix]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || audioIsMaster) return;
    const handler = () => {
      if (endedNotifiedRef.current) return;
      endedNotifiedRef.current = true;
      const consumed = Math.max(0, transitionConsumedRef.current);
      if (consumed > 0.02) onTransitionConsumedRef.current?.(consumed);
      transitionProgressRef.current = 0;
      transitionConsumedRef.current = 0;
      setTransitionProgress(0);
      onEndedRef.current?.();
    };
    video.addEventListener("ended", handler);
    return () => video.removeEventListener("ended", handler);
  }, [props.previewUrl, audioIsMaster]);

  // Preload / drive the incoming clip for sequence dissolve / blur / wipe.
  useEffect(() => {
    const incoming = incomingRef.current;
    const layer = props.transitionLayer;
    const url = String(layer?.url || "").trim();
    if (!incoming) return;
    if (!url || !(Number(layer?.durationSec) > 0)) {
      try {
        incoming.pause();
        incoming.removeAttribute("src");
        incoming.load();
      } catch { /* ignore */ }
      transitionProgressRef.current = 0;
      transitionConsumedRef.current = 0;
      setTransitionProgress(0);
      return;
    }
    if (incoming.dataset.transitionSrc !== url) {
      incoming.dataset.transitionSrc = url;
      incoming.muted = true;
      incoming.src = url;
      incoming.load();
      try { incoming.currentTime = 0; } catch { /* ignore */ }
    }
  }, [props.transitionLayer?.url, props.transitionLayer?.durationSec]);

  useEffect(() => {
    const video = videoRef.current;
    const incoming = incomingRef.current;
    const layer = props.transitionLayer;
    const durationSec = Math.max(0, Number(layer?.durationSec) || 0);
    const url = String(layer?.url || "").trim();
    if (!video || !incoming || !url || durationSec <= 0 || audioIsMaster) {
      transitionProgressRef.current = 0;
      transitionConsumedRef.current = 0;
      setTransitionProgress(0);
      return;
    }

    const syncIncoming = () => {
      const primaryDur = Number.isFinite(video.duration) ? video.duration : 0;
      if (primaryDur < durationSec + 0.05) {
        if (transitionProgressRef.current !== 0) {
          transitionProgressRef.current = 0;
          transitionConsumedRef.current = 0;
          setTransitionProgress(0);
        }
        try { incoming.pause(); } catch { /* ignore */ }
        return;
      }
      const startAt = Math.max(0, primaryDur - durationSec);
      const t = video.currentTime || 0;
      if (t < startAt - 0.02) {
        if (transitionProgressRef.current !== 0) {
          transitionProgressRef.current = 0;
          transitionConsumedRef.current = 0;
          setTransitionProgress(0);
        }
        try { incoming.pause(); } catch { /* ignore */ }
        return;
      }
      const progress = clamp01((t - startAt) / durationSec);
      const localIncoming = Math.min(progress * durationSec, Number.isFinite(incoming.duration) ? incoming.duration : progress * durationSec);
      transitionProgressRef.current = progress;
      transitionConsumedRef.current = localIncoming;
      setTransitionProgress(progress);
      try {
        if (Math.abs((incoming.currentTime || 0) - localIncoming) > 0.2) {
          incoming.currentTime = localIncoming;
        }
      } catch { /* ignore */ }
      if (!video.paused) {
        void incoming.play().catch(() => undefined);
      } else {
        try { incoming.pause(); } catch { /* ignore */ }
      }
    };

    const onPlay = () => { syncIncoming(); };
    const onPause = () => { try { incoming.pause(); } catch { /* ignore */ } };
    video.addEventListener("timeupdate", syncIncoming);
    video.addEventListener("seeked", syncIncoming);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    syncIncoming();
    return () => {
      video.removeEventListener("timeupdate", syncIncoming);
      video.removeEventListener("seeked", syncIncoming);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [
    props.transitionLayer?.url,
    props.transitionLayer?.durationSec,
    props.transitionLayer?.kind,
    props.previewUrl,
    audioIsMaster
  ]);

  useEffect(() => {
    const audio = narrationRef.current;
    if (!audio || !audioIsMaster) return;
    const handler = () => {
      if (endedNotifiedRef.current) return;
      endedNotifiedRef.current = true;
      onEndedRef.current?.();
    };
    audio.addEventListener("ended", handler);
    return () => audio.removeEventListener("ended", handler);
  }, [props.narrationUrl, audioIsMaster]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const hasNarration = Boolean(String(props.narrationUrl || "").trim()) || hasMixSrc;
    // Separate A-track audio owns playback; keep muxed video silent when mix/narration is present.
    video.muted = hasNarration || audioIsMaster ? true : Boolean(props.muted);
  }, [props.muted, props.narrationUrl, audioIsMaster, hasMixSrc]);

  useEffect(() => {
    const audio = narrationRef.current;
    if (!audio) return;
    audio.muted = Boolean(props.narrationMuted);
    if (!props.narrationMuted) applyNarrationGain(audio);
  }, [props.narrationMuted, props.narrationGain]);

  useEffect(() => {
    narrationGainRef.current = Math.max(0, Math.min(2, Number(props.narrationGain) || 1));
    applyNarrationGain(narrationRef.current);
  }, [props.narrationGain]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = narrationRef.current;
    if (props.seekTo == null || !Number.isFinite(props.seekTo)) return;
    const target = Math.max(0, props.seekTo);
    endedNotifiedRef.current = false;
    if (audioIsMaster) {
      if (useMix) {
        syncAllMixToClock(target, Boolean(props.autoPlay || (props.playToken && props.playToken > 0)));
        return;
      }
      if (!audio || !activeNarrationRef.current) return;
      const applyAudio = () => {
        try {
          audio.currentTime = Math.min(target, Number.isFinite(audio.duration) ? audio.duration : target);
        } catch {
          // ignore
        }
      };
      if (audio.readyState >= 1) applyAudio();
      else audio.addEventListener("loadedmetadata", applyAudio, { once: true });
      return;
    }
    if (!video) return;
    const apply = () => {
      try {
        video.currentTime = target;
      } catch {
        // ignore seek failures before metadata
      }
      if (useMix) {
        syncAllMixToClock(target, !video.paused);
      } else if (audio && activeNarrationRef.current) {
        try {
          const local = localNarrationTime(target);
          audio.currentTime = Math.min(local, Number.isFinite(audio.duration) ? audio.duration : local);
        } catch {
          // ignore
        }
      }
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });
  }, [props.seekTo, props.seekToken, props.narrationOffsetSec, audioIsMaster, useMix]);

  useEffect(() => {
    if (audioIsMaster) {
      const audio = useMix
        ? (mixTracks[0] ? mixAudioRefs.current.get(mixTracks[0].id) : null)
        : narrationRef.current;
      if (!audio) return;
      const emitTime = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const t = audio.currentTime || 0;
        onTimeUpdateRef.current?.(t, duration);
        if (useMix) syncAllMixToClock(t, !audio.paused);
      };
      const emitDuration = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        onDurationChangeRef.current?.(duration);
        emitTime();
      };
      audio.addEventListener("timeupdate", emitTime);
      audio.addEventListener("seeked", emitTime);
      audio.addEventListener("loadedmetadata", emitDuration);
      audio.addEventListener("durationchange", emitDuration);
      return () => {
        audio.removeEventListener("timeupdate", emitTime);
        audio.removeEventListener("seeked", emitTime);
        audio.removeEventListener("loadedmetadata", emitDuration);
        audio.removeEventListener("durationchange", emitDuration);
      };
    }

    const video = videoRef.current;
    const audio = narrationRef.current;
    if (!video) return;

    const syncNarrationTime = () => {
      if (useMix) {
        syncAllMixToClock(video.currentTime || 0, !video.paused);
        return;
      }
      if (!audio || !activeNarrationRef.current) return;
      const want = localNarrationTime(video.currentTime || 0);
      const drift = Math.abs((audio.currentTime || 0) - want);
      if (drift > 0.35) {
        try {
          audio.currentTime = Math.min(want, Number.isFinite(audio.duration) ? audio.duration : want);
        } catch {
          // ignore
        }
      }
    };

    const emitTime = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      onTimeUpdateRef.current?.(video.currentTime || 0, duration);
      syncNarrationTime();
    };
    const emitDuration = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      onDurationChangeRef.current?.(duration);
      emitTime();
    };
    const onPlay = () => {
      endedNotifiedRef.current = false;
      if (useMix) {
        syncAllMixToClock(video.currentTime || 0, true);
        return;
      }
      if (!audio || !activeNarrationRef.current) return;
      playNarrationSynced(video, audio);
    };
    const onPause = () => {
      if (useMix) {
        pauseAllMix();
        return;
      }
      if (!audio) return;
      try { audio.pause(); } catch { /* ignore */ }
    };
    const onSeeking = () => syncNarrationTime();
    const onEndedLocal = () => {
      if (useMix) {
        pauseAllMix();
        return;
      }
      if (!audio) return;
      try { audio.pause(); } catch { /* ignore */ }
    };
    const onVolumeChange = () => {
      const hasNarration = useMix || Boolean(activeNarrationRef.current);
      if (!hasNarration) return;
      if (!video.muted) {
        video.muted = true;
        if (video.paused === false) {
          if (useMix) syncAllMixToClock(video.currentTime || 0, true);
          else if (audio && !audio.muted) playNarrationSynced(video, audio);
        }
      }
    };

    video.addEventListener("timeupdate", emitTime);
    video.addEventListener("seeked", emitTime);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("loadedmetadata", emitDuration);
    video.addEventListener("durationchange", emitDuration);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEndedLocal);
    video.addEventListener("volumechange", onVolumeChange);
    return () => {
      video.removeEventListener("timeupdate", emitTime);
      video.removeEventListener("seeked", emitTime);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("loadedmetadata", emitDuration);
      video.removeEventListener("durationchange", emitDuration);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEndedLocal);
      video.removeEventListener("volumechange", onVolumeChange);
    };
  }, [props.previewUrl, props.narrationUrl, props.narrationOffsetSec, audioIsMaster, useMix, mixTracks.map((t) => t.id).join("|")]);


  useEffect(() => {
    const video = videoRef.current;
    const audio = narrationRef.current;
    if (!audio || !activeNarrationRef.current) return;
    if (props.narrationMuted) {
      try { audio.pause(); } catch { /* ignore */ }
      return;
    }
    if (audioIsMaster) {
      if (props.autoPlay || (props.playToken && props.playToken > 0)) {
        playNarrationMaster(audio);
      }
      return;
    }
    if (!video) return;
    if (!video.paused) {
      playNarrationSynced(video, audio);
    }
  }, [props.narrationMuted, props.narrationUrl, props.narrationOffsetSec, audioIsMaster, props.autoPlay, props.playToken]);

  const ratio = Number.isFinite(props.aspectRatio) && (props.aspectRatio || 0) > 0 ? props.aspectRatio : undefined;
  const hidePicture = Boolean(props.videoHidden || audioIsMaster);
  const transitionKind = String(props.transitionLayer?.kind || "").trim().toLowerCase();
  const transitionActive = transitionProgress > 0.001 && Boolean(String(props.transitionLayer?.url || "").trim());
  const outgoingOpacity = transitionActive
    ? (transitionKind === "wipe-left" ? 1 : 1 - transitionProgress)
    : 1;
  const incomingOpacity = transitionActive
    ? (transitionKind === "wipe-left" ? 1 : transitionProgress)
    : 0;
  const blurPx = transitionActive && (transitionKind === "blur" || /模糊/.test(transitionKind))
    ? Math.round(18 * Math.sin(Math.PI * transitionProgress))
    : 0;
  const outgoingStyle: CSSProperties = hidePicture
    ? { opacity: 0 }
    : {
      opacity: outgoingOpacity,
      filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
      zIndex: 1
    };
  const incomingStyle: CSSProperties = {
    opacity: hidePicture ? 0 : incomingOpacity,
    filter: blurPx > 0 ? `blur(${Math.max(0, blurPx - 4)}px)` : undefined,
    clipPath: transitionActive && transitionKind === "wipe-left"
      ? `inset(0 ${Math.max(0, (1 - transitionProgress) * 100)}% 0 0)`
      : undefined,
    zIndex: 2,
    pointerEvents: "none"
  };

  return (
    <div
      className={`workspace-artifact-video${hidePicture ? " workspace-artifact-video--hidden-picture" : ""}${transitionActive ? " workspace-artifact-video--transitioning" : ""}`}
      data-testid="workspace-video-viewer"
      data-preview-mode={audioIsMaster ? "narration-only" : "video"}
      data-transition-kind={transitionActive ? transitionKind || "dissolve" : undefined}
      data-transition-progress={transitionActive ? transitionProgress.toFixed(3) : undefined}
      style={ratio ? { aspectRatio: String(ratio), maxHeight: 360 } : undefined}
    >
      <video
        ref={videoRef}
        className="workspace-artifact-video__primary"
        controls={!audioIsMaster}
        preload="auto"
        playsInline
        style={outgoingStyle}
      >
        当前环境无法播放该视频。
      </video>
      <video
        ref={incomingRef}
        className="workspace-artifact-video__incoming"
        muted
        playsInline
        preload="auto"
        controls={false}
        aria-hidden
        style={incomingStyle}
      />
      <audio ref={narrationRef} controls={audioIsMaster && !useMix} preload="auto" hidden={useMix || !audioIsMaster} aria-hidden={useMix || !audioIsMaster} />
      <div ref={mixHostRef} data-testid="workspace-video-mix-host" hidden aria-hidden />
      {props.videoHidden && !audioIsMaster ? <div className="workspace-artifact-video__eye-off" aria-hidden>视频轨已关闭输出</div> : null}
      {audioIsMaster ? <div className="workspace-artifact-video__eye-off" aria-hidden>{useMix ? ("多轨混音 · " + mixTracks.length + " 轨") : "仅旁白 · 尚无视频 clip"}</div> : null}
      <PreviewTextOverlayLayer
        items={props.textOverlays || []}
        canvasWidth={props.canvasWidth}
        canvasHeight={props.canvasHeight}
        onSelect={props.onSelectTextOverlay}
        onChange={props.onChangeTextOverlay}
        onCommit={props.onCommitTextOverlay}
        onMovePointerDown={props.onMoveTextOverlay}
        onScalePointerDown={props.onScaleTextOverlay}
      />
    </div>
  );
}
