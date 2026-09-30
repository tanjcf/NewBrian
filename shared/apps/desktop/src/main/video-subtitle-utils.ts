export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

function parseTimestamp(value: string) {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim());
  if (!match) throw new Error("BRAIN_SUBTITLE_TIMESTAMP_INVALID");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + millis;
}

/** Parses standard SRT subtitle files into timeline cues. */
export function parseSrt(content: string): SubtitleCue[] {
  const blocks = String(content ?? "").replace(/\uFEFF/g, "").trim().split(/\r?\n\r?\n/u);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim());
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (!text) continue;
    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRaw);
    if (endMs <= startMs) continue;
    cues.push({ startMs, endMs, text });
  }
  return cues;
}

function formatTimestamp(ms: number) {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

/** Serializes subtitle cues to SRT for export or external editors. */
export function formatSrt(cues: SubtitleCue[]) {
  return cues.map((cue, index) => {
    const start = formatTimestamp(cue.startMs);
    const end = formatTimestamp(cue.endMs);
    return `${index + 1}\n${start} --> ${end}\n${cue.text}\n`;
  }).join("\n").trim();
}
