/**
 * Premiere-like volume rubber-band / keyframe envelope helpers.
 * Linear gain: 0 = silence, 1 = 0 dB (100%), 2 = +6 dB-ish (200%).
 */

export type VolumeKeyframe = {
  /** Seconds from clip start (0 … duration). */
  t: number;
  /** Linear gain 0–2. */
  v: number;
};

export const VOLUME_GAIN_MIN = 0;
export const VOLUME_GAIN_MAX = 2;
export const VOLUME_GAIN_DEFAULT = 1;

export function clampVolumeGain(value: unknown, fallback = VOLUME_GAIN_DEFAULT): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(VOLUME_GAIN_MIN, Math.min(VOLUME_GAIN_MAX, n));
}

export function gainToDb(linear: number): number {
  const g = Math.max(1e-6, clampVolumeGain(linear));
  return 20 * Math.log10(g);
}

export function dbToGain(db: number): number {
  if (!Number.isFinite(db)) return VOLUME_GAIN_DEFAULT;
  return clampVolumeGain(10 ** (db / 20));
}

export function gainToPercent(linear: number): number {
  return Math.round(clampVolumeGain(linear) * 100);
}

/** Normalize, sort, clamp; drop near-duplicate times. */
export function normalizeVolumeKeyframes(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number
): VolumeKeyframe[] {
  const duration = Math.max(0.1, Number(durationSec) || 0.1);
  const cleaned = (Array.isArray(raw) ? raw : [])
    .map((item) => ({
      t: Math.max(0, Math.min(duration, Number(item?.t) || 0)),
      v: clampVolumeGain(item?.v)
    }))
    .sort((a, b) => a.t - b.t || a.v - b.v);
  const out: VolumeKeyframe[] = [];
  for (const point of cleaned) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.t - point.t) < 0.001) {
      out[out.length - 1] = point;
      continue;
    }
    out.push(point);
  }
  return out;
}

/** Flat envelope at baseline when no keyframes are stored. */
export function defaultVolumeKeyframes(
  durationSec: number,
  baseline: number = VOLUME_GAIN_DEFAULT
): VolumeKeyframe[] {
  const duration = Math.max(0.1, Number(durationSec) || 0.1);
  const v = clampVolumeGain(baseline);
  return [
    { t: 0, v },
    { t: duration, v }
  ];
}

/** True when stored keyframes are all ~0 (rubber-band stuck at clip bottom / silent). */
export function isAllZeroVolumeEnvelope(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null
): boolean {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return raw.every((item) => {
    const v = Number(item?.v);
    return Number.isFinite(v) && v <= 0.001;
  });
}

/**
 * Heal accidental all-zero envelopes (line glued to clip bottom) back to a flat
 * 100% / baseline rubber-band. Empty / undefined envelopes are left alone
 * (effectiveVolumeKeyframes already materializes a mid-line default).
 */
export function healSilentVolumeKeyframes(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number,
  baseline: number = VOLUME_GAIN_DEFAULT
): VolumeKeyframe[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  if (!isAllZeroVolumeEnvelope(raw)) {
    return normalizeVolumeKeyframes(raw, durationSec);
  }
  return defaultVolumeKeyframes(durationSec, clampVolumeGain(baseline, VOLUME_GAIN_DEFAULT));
}

export function effectiveVolumeKeyframes(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number,
  baseline: number = VOLUME_GAIN_DEFAULT
): VolumeKeyframe[] {
  const normalized = normalizeVolumeKeyframes(raw, durationSec);
  if (normalized.length >= 1) {
    if (normalized.length === 1) {
      const only = normalized[0]!;
      const duration = Math.max(0.1, Number(durationSec) || 0.1);
      if (only.t <= 0.001) return [{ t: 0, v: only.v }, { t: duration, v: only.v }];
      if (only.t >= duration - 0.001) return [{ t: 0, v: only.v }, { t: duration, v: only.v }];
      return [{ t: 0, v: only.v }, only, { t: duration, v: only.v }];
    }
    return normalized;
  }
  return defaultVolumeKeyframes(durationSec, baseline);
}

/** Linear interpolate envelope at clip-local time, then multiply baseline. */
export function sampleVolumeEnvelope(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  tLocal: number,
  durationSec: number,
  baseline: number = VOLUME_GAIN_DEFAULT
): number {
  const gainMul = clampVolumeGain(baseline);
  const points = effectiveVolumeKeyframes(raw, durationSec, 1);
  const t = Math.max(0, Number(tLocal) || 0);
  if (t <= points[0]!.t) return clampVolumeGain(points[0]!.v * gainMul);
  const last = points[points.length - 1]!;
  if (t >= last.t) return clampVolumeGain(last.v * gainMul);
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const dt = Math.max(1e-6, b.t - a.t);
      const lerp = a.v + (b.v - a.v) * ((t - a.t) / dt);
      return clampVolumeGain(lerp * gainMul);
    }
  }
  return clampVolumeGain(gainMul);
}

export function insertVolumeKeyframe(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number,
  t: number,
  v: number,
  baseline: number = VOLUME_GAIN_DEFAULT
): VolumeKeyframe[] {
  const duration = Math.max(0.1, Number(durationSec) || 0.1);
  const points = effectiveVolumeKeyframes(raw, duration, baseline).map((p) => ({ ...p }));
  const nextT = Math.max(0, Math.min(duration, t));
  const nextV = clampVolumeGain(v);
  const near = points.findIndex((p) => Math.abs(p.t - nextT) < 0.04);
  if (near >= 0) {
    points[near] = { t: nextT, v: nextV };
    return normalizeVolumeKeyframes(points, duration);
  }
  points.push({ t: nextT, v: nextV });
  return normalizeVolumeKeyframes(points, duration);
}

export function updateVolumeKeyframe(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number,
  index: number,
  patch: Partial<VolumeKeyframe>
): VolumeKeyframe[] {
  const duration = Math.max(0.1, Number(durationSec) || 0.1);
  const points = effectiveVolumeKeyframes(raw, duration, 1).map((p) => ({ ...p }));
  if (index < 0 || index >= points.length) return normalizeVolumeKeyframes(points, duration);
  const current = points[index]!;
  points[index] = {
    t: patch.t === undefined ? current.t : Math.max(0, Math.min(duration, Number(patch.t) || 0)),
    v: patch.v === undefined ? current.v : clampVolumeGain(patch.v)
  };
  return normalizeVolumeKeyframes(points, duration);
}

export function removeVolumeKeyframe(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number,
  index: number
): VolumeKeyframe[] {
  const duration = Math.max(0.1, Number(durationSec) || 0.1);
  const points = effectiveVolumeKeyframes(raw, duration, 1).map((p) => ({ ...p }));
  if (points.length <= 2 || index < 0 || index >= points.length) {
    return normalizeVolumeKeyframes(points, duration);
  }
  points.splice(index, 1);
  return normalizeVolumeKeyframes(points, duration);
}

/** Shift every keyframe level (and return suggested baseline if flat). */
export function nudgeVolumeEnvelope(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number,
  deltaV: number,
  baseline: number = VOLUME_GAIN_DEFAULT
): { keyframes: VolumeKeyframe[]; volume: number } {
  const points = effectiveVolumeKeyframes(raw, durationSec, baseline).map((p) => ({
    t: p.t,
    v: clampVolumeGain(p.v + deltaV)
  }));
  return { keyframes: normalizeVolumeKeyframes(points, durationSec), volume: clampVolumeGain(baseline) };
}

function fmtNum(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

/**
 * Build FFmpeg volume expression (commas escaped for filter_complex).
 * Apply on clip audio BEFORE adelay so t=0 is clip start.
 */
export function buildFfmpegVolumeExpression(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number,
  baseline: number = VOLUME_GAIN_DEFAULT,
  muted = false
): string {
  if (muted) return "0";
  const gainMul = clampVolumeGain(baseline);
  const points = effectiveVolumeKeyframes(raw, durationSec, 1).map((p) => ({
    t: p.t,
    v: clampVolumeGain(p.v * gainMul)
  }));
  if (points.length === 1) return fmtNum(points[0]!.v);
  const flat = points.every((p) => Math.abs(p.v - points[0]!.v) < 0.0005);
  if (flat) return fmtNum(points[0]!.v);

  // Nested if(lt(t,t_next), lerp, …) — commas escaped as \, for filter_complex.
  const lerp = (a: VolumeKeyframe, b: VolumeKeyframe) => {
    const dt = Math.max(0.001, b.t - a.t);
    return `${fmtNum(a.v)}+(${fmtNum(b.v)}-${fmtNum(a.v)})*(t-${fmtNum(a.t)})/${fmtNum(dt)}`;
  };

  let expr = fmtNum(points[points.length - 1]!.v);
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    expr = `if(lt(t\\,${fmtNum(b.t)})\\,${lerp(a, b)}\\,${expr})`;
  }
  const first = points[0]!;
  if (first.t > 0.001) {
    expr = `if(lt(t\\,${fmtNum(first.t)})\\,${fmtNum(first.v)}\\,${expr})`;
  }
  return expr;
}

/** Full audio filter fragment: volume=… or volume='expr':eval=frame */
export function buildFfmpegVolumeFilterFragment(
  raw: Array<Partial<VolumeKeyframe>> | undefined | null,
  durationSec: number,
  baseline: number = VOLUME_GAIN_DEFAULT,
  muted = false
): string {
  const expr = buildFfmpegVolumeExpression(raw, durationSec, baseline, muted);
  if (/^[0-9.]+$/.test(expr)) return `volume=${expr}`;
  return `volume='${expr}':eval=frame`;
}

/** Map gain 0–2 → Y position inside clip (0 = top, 1 = bottom). */
export function volumeGainToYRatio(gain: number): number {
  return 1 - clampVolumeGain(gain) / VOLUME_GAIN_MAX;
}

export function yRatioToVolumeGain(yRatio: number): number {
  const y = Math.max(0, Math.min(1, Number(yRatio) || 0));
  return clampVolumeGain((1 - y) * VOLUME_GAIN_MAX);
}
