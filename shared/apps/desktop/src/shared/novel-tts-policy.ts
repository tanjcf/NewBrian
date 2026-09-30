export type NovelTtsVoiceId =
  | "multi_natural"
  | "dual_lively"
  | "uncle_supernatural"
  | "uncle_classic"
  | "sweet_girl"
  | "youth_bright"
  | "young_uncle"
  | "calm_narrator";

export type NovelTtsVoice = {
  id: NovelTtsVoiceId;
  label: string;
  hint: string;
  /** Primary Kokoro-zh voice asset id (offline engine). */
  kokoroVoice: string;
  /** Hint for local SpeechSynthesis fallback only. */
  local: {
    gender: "female" | "male" | "neutral";
    rate: number;
    pitch: number;
    preferName?: RegExp;
  };
};

/**
 * Eight curated roles ↔ eight distinct Kokoro-zh voice bins (1:1).
 * Pack voices: zf_001/017/021 + zm_010/020/030/050/080.
 * Dual/multi labels use distinct single speakers for now (true multi-speaker comes later).
 */
export const NOVEL_TTS_VOICES: NovelTtsVoice[] = [
  {
    id: "multi_natural",
    label: "多角色对话-自然流畅",
    hint: "女声旁白，对话小说通用",
    kokoroVoice: "zf_001",
    local: { gender: "female", rate: 1, pitch: 1, preferName: /xiaoxiao|晓晓|huihui|女/i }
  },
  {
    id: "dual_lively",
    label: "双角色对话-双音灵动",
    hint: "灵动女声",
    kokoroVoice: "zf_017",
    local: { gender: "female", rate: 1.06, pitch: 1.12, preferName: /xiaoyi|晓伊|甜|女/i }
  },
  {
    id: "uncle_supernatural",
    label: "成熟大叔音-超自然",
    hint: "低沉成熟男声",
    kokoroVoice: "zm_010",
    local: { gender: "male", rate: 0.9, pitch: 0.78, preferName: /yunjian|云健|kangkang|男/i }
  },
  {
    id: "uncle_classic",
    label: "成熟大叔音-经典",
    hint: "经典旁白男声",
    kokoroVoice: "zm_020",
    local: { gender: "male", rate: 0.92, pitch: 0.88, preferName: /yunxi|云希|男/i }
  },
  {
    id: "sweet_girl",
    label: "甜美少女音-感然力",
    hint: "甜美偏高少女声",
    kokoroVoice: "zf_021",
    local: { gender: "female", rate: 1.06, pitch: 1.28, preferName: /xiaoxiao|晓晓|甜|女/i }
  },
  {
    id: "youth_bright",
    label: "开朗青年音-轻快",
    hint: "轻快青年男声",
    kokoroVoice: "zm_050",
    local: { gender: "male", rate: 1.12, pitch: 1.08, preferName: /yunyang|云扬|男/i }
  },
  {
    id: "young_uncle",
    label: "清亮青叔音-活力",
    hint: "清亮有活力的轻熟男声",
    kokoroVoice: "zm_080",
    local: { gender: "male", rate: 1.04, pitch: 0.98, preferName: /yunjian|云健|男/i }
  },
  {
    id: "calm_narrator",
    label: "沉稳旁白-清晰",
    hint: "沉稳清晰男声旁白",
    kokoroVoice: "zm_030",
    local: { gender: "male", rate: 0.94, pitch: 0.9, preferName: /yunxi|云希|男/i }
  }
];

/** Voice .bin files required for the curated offline pack. */
export const NOVEL_TTS_KOKORO_VOICE_FILES = NOVEL_TTS_VOICES.map(
  (voice) => `${voice.kokoroVoice}.bin`
);

export const DEFAULT_NOVEL_TTS_VOICE_ID: NovelTtsVoiceId = "youth_bright";
/** Voices offered in the UI. Product currently ships a single fixed voice for novel. */
export const NOVEL_TTS_SELECTABLE_VOICES: NovelTtsVoice[] = NOVEL_TTS_VOICES.filter(
  (voice) => voice.id === DEFAULT_NOVEL_TTS_VOICE_ID
);
/** v3: UI no longer exposes a voice picker; always use youth_bright. */
export const NOVEL_TTS_VOICE_STORAGE_KEY = "newbrain.novelTtsVoice.v3";
/** Keep speakable payload bounded; Chromium freezes on multi-thousand-char utterances. */
export const NOVEL_TTS_MAX_CHARS = 4_000;
/** Local SpeechSynthesis chunk size — long single utterances hang Electron. */
export const NOVEL_TTS_LOCAL_CHUNK_CHARS = 220;
export function resolveNovelTtsVoice(voiceId?: string | null): NovelTtsVoice {
  return (
    NOVEL_TTS_VOICES.find((voice) => voice.id === voiceId) ||
    NOVEL_TTS_VOICES.find((voice) => voice.id === DEFAULT_NOVEL_TTS_VOICE_ID) ||
    NOVEL_TTS_VOICES[0]!
  );
}

export function readStoredNovelTtsVoiceId(): NovelTtsVoiceId {
  // Voice picker removed — always the single product voice.
  return DEFAULT_NOVEL_TTS_VOICE_ID;
}

export function storeNovelTtsVoiceId(voiceId: NovelTtsVoiceId) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(NOVEL_TTS_VOICE_STORAGE_KEY, DEFAULT_NOVEL_TTS_VOICE_ID);
    void voiceId;
  } catch {
    // ignore quota / private mode
  }
}

/** True for markdown thematic breaks / separator-only lines (not spoken). */
export function isNonSpeakableSourceLine(line: string) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return true;
  if (/^([-*_])\1{2,}$/.test(trimmed)) return true;
  if (/^#{1,6}$/.test(trimmed)) return true;
  return false;
}

/** Flatten markdown/chat markup into speakable plain text. */
export function stripMarkdownForSpeech(input: string) {
  return String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    // Drop thematic breaks (---/***/___) — TTS skips them, so keeping them desyncs follow-along.
    .replace(/^\s{0,3}([-*_])\1{2,}\s*$/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\|/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function prepareNovelSpeechText(input: string, maxChars = NOVEL_TTS_MAX_CHARS) {
  const plain = stripMarkdownForSpeech(input);
  if (!plain) {
    return { ok: false as const, reason: "empty" as const, text: "" };
  }
  if (plain.length <= maxChars) {
    return { ok: true as const, text: plain, truncated: false };
  }
  return {
    ok: true as const,
    text: `${plain.slice(0, maxChars).trimEnd()}……`,
    truncated: true
  };
}

export type NovelSpeechChunk = {
  text: string;
  /** Inclusive start offset into the prepared speakable string. */
  start: number;
  /** Exclusive end offset into the prepared speakable string. */
  end: number;
};

/**
 * Split speakable text into short chunks so SpeechSynthesis stays responsive.
 * Chunks are exact slices of the input so progress offsets stay aligned with prepared text.
 */
export function chunkNovelSpeechText(text: string, maxChars = NOVEL_TTS_LOCAL_CHUNK_CHARS): NovelSpeechChunk[] {
  const source = String(text || "");
  if (!source.trim()) return [];
  if (source.length <= maxChars) {
    return [{ text: source, start: 0, end: source.length }];
  }
  const chunks: NovelSpeechChunk[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source.length - cursor <= maxChars) {
      chunks.push({ text: source.slice(cursor), start: cursor, end: source.length });
      break;
    }
    const window = source.slice(cursor, cursor + maxChars + 1);
    const breakAt = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf("；"),
      window.lastIndexOf("，"),
      window.lastIndexOf("、"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf(" ")
    );
    const cut = breakAt >= Math.floor(maxChars * 0.4) ? breakAt + 1 : maxChars;
    const end = cursor + cut;
    const piece = source.slice(cursor, end);
    if (piece.trim()) chunks.push({ text: piece, start: cursor, end });
    cursor = end;
    while (cursor < source.length && /[ \t]/.test(source[cursor] || "")) cursor += 1;
  }
  return chunks;
}

export type SpeechFollowTarget = {
  line: number;
  endLine: number;
  totalLines: number;
  snippet: string;
  absoluteIndex: number;
};

function stripSingleLineForSpeech(line: string) {
  return String(line || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s{0,3}[-*+]\s+/, "")
    .replace(/^\s{0,3}\d+\.\s+/, "")
    .replace(/^\s{0,3}>\s?/, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Map an offset in prepared speakable text back onto source line numbers.
 * Prefers locating each source line inside stripMarkdownForSpeech(source) so local/remote
 * progress (indexed into prepared text) stays aligned with the preview gutter.
 *
 * Never highlights blank / separator lines: inter-paragraph gaps stay on the previous
 * speakable line until the next paragraph's range begins.
 */
export function mapSpeechOffsetToSourceLines(
  source: string,
  absoluteIndex: number,
  snippet = ""
): SpeechFollowTarget {
  const normalized = String(source || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const totalLines = Math.max(1, lines.length);
  const prepared = stripMarkdownForSpeech(normalized);
  const safeIndex = Math.min(Math.max(0, Number(absoluteIndex) || 0), Math.max(0, prepared.length));
  const fromPrepared = prepared.slice(safeIndex, safeIndex + 48).replace(/\s+/g, " ").trim();
  const cleanSnippet = (fromPrepared || String(snippet || "").replace(/\s+/g, " ").trim()).slice(0, 48);

  const ranges: Array<{ line: number; start: number; end: number }> = [];
  let searchFrom = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] || "";
    if (isNonSpeakableSourceLine(raw)) continue;
    const piece = stripSingleLineForSpeech(raw);
    if (!piece || isNonSpeakableSourceLine(piece)) continue;
    let foundAt = prepared.indexOf(piece, searchFrom);
    if (foundAt < 0) {
      const compactPiece = piece.replace(/\s+/g, "");
      if (!compactPiece) continue;
      const compactPrepared = prepared.slice(searchFrom).replace(/\s+/g, "");
      const compactAt = compactPrepared.indexOf(compactPiece);
      if (compactAt < 0) continue;
      // Approximate only as last resort; prefer exact indexOf above.
      let approx = searchFrom;
      let seen = 0;
      while (approx < prepared.length && seen < compactAt) {
        if (!/\s/.test(prepared[approx] || "")) seen += 1;
        approx += 1;
      }
      foundAt = approx;
    }
    const end = Math.min(prepared.length, foundAt + piece.length);
    ranges.push({ line: index + 1, start: foundAt, end: Math.max(foundAt + 1, end) });
    searchFrom = end;
  }

  if (!ranges.length) {
    // Fall back to nearest non-empty source line — never park on a blank gutter row.
    const ratio = prepared.length ? safeIndex / prepared.length : 0;
    let line = Math.min(totalLines, Math.max(1, Math.floor(ratio * totalLines) + 1));
    if (isNonSpeakableSourceLine(lines[line - 1] || "")) {
      let next = line + 1;
      while (next <= totalLines && isNonSpeakableSourceLine(lines[next - 1] || "")) next += 1;
      if (next <= totalLines) line = next;
      else {
        let prev = line - 1;
        while (prev >= 1 && isNonSpeakableSourceLine(lines[prev - 1] || "")) prev -= 1;
        if (prev >= 1) line = prev;
      }
    }
    return { line, endLine: line, totalLines, snippet: cleanSnippet, absoluteIndex: safeIndex };
  }

  let active = ranges[0]!;
  for (const range of ranges) {
    if (safeIndex >= range.start) active = range;
  }
  return {
    line: active.line,
    endLine: active.line,
    totalLines,
    snippet: cleanSnippet,
    absoluteIndex: safeIndex
  };
}

/**
 * Build a cumulative "speech weight" timeline for follow-along.
 * Newlines and punctuation get extra weight so the playhead doesn't race through
 * paragraph breaks faster than Kokoro's natural pauses.
 */
export function buildSpeechProgressWeights(text: string): { cumulative: number[]; total: number } {
  const source = String(text || "");
  const cumulative: number[] = new Array(source.length + 1);
  cumulative[0] = 0;
  let total = 0;
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index] || "";
    let weight = 1;
    if (ch === "\n") weight = 28;
    else if ("。！？；…".includes(ch)) weight = 16;
    else if ("，、：".includes(ch)) weight = 5;
    else if (/\s/.test(ch)) weight = 3;
    else if ("—–-·・「」『』“”".includes(ch)) weight = 3;
    total += weight;
    cumulative[index + 1] = total;
  }
  if (total <= 0) {
    return { cumulative: [0], total: 1 };
  }
  return { cumulative, total };
}

/** Map a 0..1 playback ratio onto a character index using weighted pauses. */
export function speechRatioToAbsoluteIndex(text: string, ratio: number): number {
  const source = String(text || "");
  if (!source.length) return 0;
  const clamped = Math.min(1, Math.max(0, Number(ratio) || 0));
  if (clamped <= 0) return 0;
  if (clamped >= 1) return source.length;
  const { cumulative, total } = buildSpeechProgressWeights(source);
  const target = clamped * total;
  let low = 0;
  let high = source.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((cumulative[mid] || 0) <= target) low = mid;
    else high = mid - 1;
  }
  return Math.min(source.length, Math.max(0, low));
}

/** Highlight trails audible playback so line changes do not lead the voice. */
export const NOVEL_TTS_HIGHLIGHT_TRAIL_MS = 750;
/** Minimum weight for a speakable line so short lines still dwell before advancing. */
const MIN_SPEAKABLE_LINE_WEIGHT = 48;

type SpeakableSegment = { start: number; end: number; weight: number };

function buildSpeakableSegments(text: string): SpeakableSegment[] {
  const source = String(text || "");
  const segments: SpeakableSegment[] = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && source[index] === "\n") index += 1;
    if (index >= source.length) break;
    const start = index;
    while (index < source.length && source[index] !== "\n") index += 1;
    const end = index;
    const piece = source.slice(start, end);
    const { total } = buildSpeechProgressWeights(piece);
    const segment: SpeakableSegment = {
      start,
      end,
      weight: Math.max(MIN_SPEAKABLE_LINE_WEIGHT, total)
    };
    let newlines = 0;
    while (index < source.length && source[index] === "\n") {
      newlines += 1;
      index += 1;
    }
    // Paragraph breaks keep the highlight on the finished line a bit longer.
    segment.weight += newlines * 36;
    segments.push(segment);
  }
  return segments;
}

/**
 * Highlight-only playhead: follows WAV time, trails audio slightly, and advances
 * line-by-line with dwell so gutter highlighting does not race ahead of speech.
 * Does not change TTS/audio speed.
 */
export function estimateFollowAbsoluteIndex(
  text: string,
  elapsedMs: number,
  durationMs: number
): number {
  const source = String(text || "");
  if (!source.length) return 0;
  const duration = Math.max(1, Number(durationMs) || 1);
  const rawElapsed = Math.max(0, Number(elapsedMs) || 0);
  if (rawElapsed >= duration - 120) return source.length;

  const trailed = Math.max(0, rawElapsed - NOVEL_TTS_HIGHLIGHT_TRAIL_MS);
  const ratio = Math.min(1, trailed / duration);
  if (ratio <= 0) return 0;

  const segments = buildSpeakableSegments(source);
  if (!segments.length) return speechRatioToAbsoluteIndex(source, ratio);

  const totalWeight = segments.reduce((sum, segment) => sum + segment.weight, 0) || 1;
  let target = ratio * totalWeight;
  for (const segment of segments) {
    if (target <= segment.weight) {
      const localRatio = segment.weight > 0 ? target / segment.weight : 1;
      const localText = source.slice(segment.start, segment.end);
      return segment.start + speechRatioToAbsoluteIndex(localText, localRatio);
    }
    target -= segment.weight;
  }
  return source.length;
}

/** Follow-along clock = real WAV duration (speech rate unchanged). */
export function estimateFollowDurationMs(_text: string, wavDurationMs?: number) {
  return Math.max(800, Number(wavDurationMs) || 0);
}
