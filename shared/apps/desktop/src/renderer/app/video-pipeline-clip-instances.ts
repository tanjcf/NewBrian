/**
 * Helpers for multi-instance timeline clips (same-type track copy).
 */

import type { BrainVideoClipInstance, BrainVideoShot, BrainVideoTrackEdit } from "@codex-forge/protocol/brain-video-runtime";
import { audioTrackLabelForPath } from "./video-pipeline-audio-resolve.ts";

export function createClipInstanceId(kind: "video" | "audio") {
  return `${kind}-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
}

/** Secondary A/V copies and peeled soundtracks — never treated as shot.audio primary. */
export function isSecondaryClipInstanceId(id: string): boolean {
  const value = String(id || "");
  return value.includes("-copy-") || value.includes("-peel");
}

export function createPeeledAudioInstanceId() {
  return `${createClipInstanceId("audio")}-peel`;
}

export function instanceDurationSec(instance: Pick<BrainVideoClipInstance, "durationSec" | "inSec" | "outSec">) {
  if (Number.isFinite(instance.durationSec) && Number(instance.durationSec) > 0) {
    return Math.max(0.1, Number(instance.durationSec));
  }
  const inSec = Number.isFinite(instance.inSec) ? Number(instance.inSec) : 0;
  const outSec = Number.isFinite(instance.outSec) ? Number(instance.outSec) : inSec + 4;
  return Math.max(0.1, outSec - inSec);
}

export function hasPeeledSoundtrackForShot(
  current: BrainVideoClipInstance[],
  shotId: string
): boolean {
  return current.some(
    (item) => item.kind === "audio" && item.shotId === shotId && String(item.id || "").includes("-peel")
  );
}

/**
 * Sequence-timeline origin (seconds) for a shot, matching deriveClipInstancesFromShots cursor
 * (durations only; offsets live on each instance's startSec).
 */
export function sequenceBaseSecForShot(
  shots: Array<{ id: string }>,
  shotId: string,
  trackEdits: Record<string, BrainVideoTrackEdit | undefined> = {},
  clipInstances: BrainVideoClipInstance[] = []
): number {
  let cursor = 0;
  for (const shot of shots) {
    if (shot.id === shotId) return cursor;
    const fromInstances = clipInstances.filter((item) => item.shotId === shot.id);
    if (fromInstances.length) {
      cursor += Math.max(...fromInstances.map((item) => instanceDurationSec(item)));
      continue;
    }
    const edit = trackEdits[shot.id] || {};
    const inSec = Number.isFinite(edit.inSec) ? Number(edit.inSec) : 0;
    const outSec = Number.isFinite(edit.outSec) ? Number(edit.outSec) : 4;
    cursor += Math.max(0.1, outSec - inSec);
  }
  return cursor;
}

/** Derive instances from legacy one-shot-one-slot shots + trackEdits. */
export function deriveClipInstancesFromShots(
  shots: Array<BrainVideoShot & { id: string }>,
  trackEdits: Record<string, BrainVideoTrackEdit | undefined>
): BrainVideoClipInstance[] {
  const instances: BrainVideoClipInstance[] = [];
  let cursor = 0;
  shots.forEach((shot, index) => {
    const edit = trackEdits[shot.id] || {};
    const inSec = Number.isFinite(edit.inSec) ? Number(edit.inSec) : 0;
    const outSec = Number.isFinite(edit.outSec) ? Number(edit.outSec) : 4;
    const durationSec = Math.max(0.1, outSec - inSec);
    const startSec = Math.max(0, cursor + (Number(edit.offsetSec) || 0));
    // Do NOT auto-link V ↔ 旁白 (A1). Linked groups come from peel/unlink or explicit Relink.
    if (shot.ready && String(shot.clip || "").trim()) {
      instances.push({
        id: createClipInstanceId("video"),
        kind: "video",
        shotId: shot.id,
        relativePath: String(shot.clip),
        trackId: String(edit.videoTrackId || "v1"),
        startSec,
        durationSec,
        inSec,
        outSec,
        label: shot.title || `镜 ${index + 1}`
      });
    }
    if (String(shot.audio || "").trim()) {
      instances.push({
        id: createClipInstanceId("audio"),
        kind: "audio",
        shotId: shot.id,
        relativePath: String(shot.audio),
        trackId: String(edit.audioTrackId || "a1"),
        startSec,
        durationSec,
        inSec,
        outSec,
        muted: edit.muted === true,
        label: audioTrackLabelForPath(String(shot.audio), shot.title, index)
      });
    }
    cursor += durationSec;
  });
  return instances;
}

/**
 * Keep persisted clipInstances, but backfill missing primary V/A slots from shot.clip / shot.audio.
 * Additive and shot-scoped: never reshuffle user-placed startSec / trackId / trim / volume.
 */
export function reconcileClipInstancesWithShots(
  current: BrainVideoClipInstance[],
  shots: Array<BrainVideoShot & { id: string }>,
  trackEdits: Record<string, BrainVideoTrackEdit | undefined> = {}
): BrainVideoClipInstance[] {
  let next = Array.isArray(current) ? [...current] : [];
  let cursor = 0;
  shots.forEach((shot, index) => {
    const edit = trackEdits[shot.id] || {};
    const inSec = Number.isFinite(edit.inSec) ? Number(edit.inSec) : 0;
    const outSec = Number.isFinite(edit.outSec) ? Number(edit.outSec) : 4;
    const durationSec = Math.max(0.1, outSec - inSec);
    const fallbackStart = Math.max(0, cursor + (Number(edit.offsetSec) || 0));
    const existingVideo = next.find((item) => item.kind === "video" && item.shotId === shot.id);
    const existingAudio = next.find(
      (item) => item.kind === "audio" && item.shotId === shot.id && !isSecondaryClipInstanceId(item.id)
    );
    const startSec = existingVideo?.startSec
      ?? existingAudio?.startSec
      ?? fallbackStart;
    const clipPath = String(shot.clip || "").trim().replaceAll("\\", "/");
    const audioPath = String(shot.audio || "").trim().replaceAll("\\", "/");
    const existingVideoPath = String(existingVideo?.relativePath || "").trim().replaceAll("\\", "/");
    const existingAudioPath = String(existingAudio?.relativePath || "").trim().replaceAll("\\", "/");

    const needVideo = Boolean(
      clipPath && shot.ready && (!existingVideo || existingVideoPath !== clipPath)
    );
    const needAudio = Boolean(audioPath && (!existingAudio || existingAudioPath !== audioPath));
    // Drop primary A when shot.audio was cleared (e.g. healed shared unscoped narration).
    // Never drop peeled soundtrack / copy instances.
    if (!audioPath && existingAudio && !isSecondaryClipInstanceId(existingAudio.id)) {
      next = next.filter((item) => item.id !== existingAudio.id);
    }
    if (needVideo) {
      next = upsertPrimaryInstance(next, {
        kind: "video",
        shotId: shot.id,
        relativePath: clipPath,
        trackId: String(existingVideo?.trackId || edit.videoTrackId || "v1"),
        startSec: existingVideo?.startSec ?? startSec,
        durationSec: existingVideo ? instanceDurationSec(existingVideo) : durationSec,
        inSec: existingVideo?.inSec,
        outSec: existingVideo?.outSec,
        label: existingVideo?.label || shot.title || `镜 ${index + 1}`,
        // Preserve peel/manual linkGroupId; never invent V↔旁白 link on reconcile.
        linkGroupId: existingVideo?.linkGroupId,
        placement: "keep-if-present"
      });
    }
    if (needAudio) {
      next = upsertPrimaryInstance(next, {
        kind: "audio",
        shotId: shot.id,
        relativePath: audioPath,
        trackId: String(existingAudio?.trackId || edit.audioTrackId || "a1"),
        startSec: existingAudio?.startSec ?? startSec,
        durationSec: existingAudio ? instanceDurationSec(existingAudio) : durationSec,
        inSec: existingAudio?.inSec,
        outSec: existingAudio?.outSec,
        label: existingAudioPath === audioPath
          ? (existingAudio?.label || audioTrackLabelForPath(audioPath, shot.title, index))
          : audioTrackLabelForPath(audioPath, shot.title, index),
        muted: existingAudio?.muted ?? edit.muted === true,
        volume: existingAudio?.volume,
        volumeKeyframes: existingAudio?.volumeKeyframes,
        // 旁白 stays unlinked unless user Relink; preserve any prior explicit id.
        linkGroupId: existingAudio?.linkGroupId,
        placement: "keep-if-present"
      });
    }
    const afterShot = next.filter((item) => item.shotId === shot.id);
    cursor += afterShot.length
      ? Math.max(...afterShot.map((item) => instanceDurationSec(item)), durationSec)
      : durationSec;
  });
  return next;
}

export type UpsertPlacementMode = "replace" | "keep-if-present";

function applyPlacementFields(
  prev: BrainVideoClipInstance | undefined,
  patch: {
    trackId: string;
    startSec: number;
    durationSec?: number;
    inSec?: number;
    outSec?: number;
    muted?: boolean;
    volume?: number;
    volumeKeyframes?: BrainVideoClipInstance["volumeKeyframes"];
  },
  placement: UpsertPlacementMode
): Pick<BrainVideoClipInstance, "trackId" | "startSec" | "durationSec" | "inSec" | "outSec" | "muted" | "volume" | "volumeKeyframes"> {
  const keep = placement === "keep-if-present" && prev;
  return {
    trackId: keep && prev.trackId ? prev.trackId : patch.trackId,
    startSec: keep && Number.isFinite(prev.startSec) ? prev.startSec : patch.startSec,
    durationSec: keep && Number.isFinite(prev.durationSec) && Number(prev.durationSec) > 0
      ? prev.durationSec
      : (patch.durationSec ?? prev?.durationSec),
    inSec: keep && Number.isFinite(prev.inSec) ? prev.inSec : (patch.inSec ?? prev?.inSec),
    outSec: keep && Number.isFinite(prev.outSec) ? prev.outSec : (patch.outSec ?? prev?.outSec),
    muted: keep && prev.muted !== undefined ? prev.muted : (patch.muted ?? prev?.muted),
    volume: keep && prev.volume !== undefined ? prev.volume : (patch.volume ?? prev?.volume),
    volumeKeyframes: keep && prev.volumeKeyframes ? prev.volumeKeyframes : (patch.volumeKeyframes ?? prev?.volumeKeyframes)
  };
}

export function upsertPrimaryInstance(
  current: BrainVideoClipInstance[],
  patch: {
    kind: "video" | "audio";
    shotId: string;
    relativePath: string;
    trackId: string;
    startSec: number;
    durationSec?: number;
    inSec?: number;
    outSec?: number;
    label?: string;
    muted?: boolean;
    volume?: number;
    volumeKeyframes?: BrainVideoClipInstance["volumeKeyframes"];
    linkGroupId?: string;
    /** keep-if-present: never overwrite user-placed layout on reload/peel/reconcile. */
    placement?: UpsertPlacementMode;
  }
): BrainVideoClipInstance[] {
  const placement = patch.placement ?? "replace";
  // Primary only — never overwrite peeled soundtrack or track copies.
  const index = current.findIndex(
    (item) => item.kind === patch.kind && item.shotId === patch.shotId && !isSecondaryClipInstanceId(item.id)
  );
  if (index >= 0) {
    const next = [...current];
    const prev = next[index]!;
    const placed = applyPlacementFields(prev, patch, placement);
    next[index] = {
      ...prev,
      relativePath: patch.relativePath,
      trackId: placed.trackId,
      startSec: placed.startSec,
      durationSec: placed.durationSec ?? prev.durationSec,
      inSec: placed.inSec,
      outSec: placed.outSec,
      label: patch.label ?? prev.label,
      muted: placed.muted,
      volume: placed.volume,
      volumeKeyframes: placed.volumeKeyframes,
      linkGroupId: patch.linkGroupId ?? prev.linkGroupId
    };
    return next;
  }
  return [
    ...current,
    {
      id: createClipInstanceId(patch.kind),
      kind: patch.kind,
      shotId: patch.shotId,
      relativePath: patch.relativePath,
      trackId: patch.trackId,
      startSec: patch.startSec,
      durationSec: patch.durationSec ?? 4,
      inSec: patch.inSec,
      outSec: patch.outSec,
      label: patch.label,
      muted: patch.muted,
      volume: patch.volume,
      volumeKeyframes: patch.volumeKeyframes,
      linkGroupId: patch.linkGroupId
    }
  ];
}

/**
 * Place / refresh peeled embedded soundtrack as a secondary A-clip.
 * Keeps shot.audio (旁白 TTS) as the primary A slot.
 * Default placement keep-if-present so reload/auto-peel never reshuffles user layout.
 */
export function upsertPeeledSoundtrackInstance(
  current: BrainVideoClipInstance[],
  patch: {
    shotId: string;
    relativePath: string;
    trackId: string;
    startSec: number;
    durationSec?: number;
    label?: string;
    linkGroupId?: string;
    placement?: UpsertPlacementMode;
  }
): BrainVideoClipInstance[] {
  const placement = patch.placement ?? "keep-if-present";
  const index = current.findIndex(
    (item) => item.kind === "audio" && item.shotId === patch.shotId && item.id.includes("-peel")
  );
  if (index >= 0) {
    const next = [...current];
    const prev = next[index]!;
    const placed = applyPlacementFields(prev, patch, placement);
    next[index] = {
      ...prev,
      relativePath: patch.relativePath,
      trackId: placed.trackId,
      startSec: placed.startSec,
      durationSec: placed.durationSec ?? prev.durationSec,
      inSec: placed.inSec,
      outSec: placed.outSec,
      label: patch.label ?? prev.label,
      volume: prev.volume ?? 1,
      linkGroupId: patch.linkGroupId ?? prev.linkGroupId
    };
    return next;
  }
  return [
    ...current,
    {
      id: createPeeledAudioInstanceId(),
      kind: "audio",
      shotId: patch.shotId,
      relativePath: patch.relativePath,
      trackId: patch.trackId,
      startSec: patch.startSec,
      durationSec: patch.durationSec ?? 4,
      label: patch.label || "原声",
      muted: false,
      volume: 1,
      linkGroupId: patch.linkGroupId
    }
  ];
}

export function copyInstanceToTrack(
  current: BrainVideoClipInstance[],
  instanceId: string,
  targetTrackId: string
): { next: BrainVideoClipInstance[]; copy?: BrainVideoClipInstance; error?: string } {
  const source = current.find((item) => item.id === instanceId);
  if (!source) return { next: current, error: "未找到片段" };
  const sameType = source.kind === "video" ? targetTrackId.startsWith("v") : targetTrackId.startsWith("a");
  if (!sameType) {
    return { next: current, error: `只能复制到同类型轨道（${source.kind === "video" ? "V→V" : "A→A"}）` };
  }
  if (targetTrackId === source.trackId) {
    return { next: current, error: "目标轨与源轨相同" };
  }
  const copy: BrainVideoClipInstance = {
    ...source,
    id: `${createClipInstanceId(source.kind)}-copy`,
    trackId: targetTrackId,
    // Keep time position (Premiere-like); no micro-offset by default.
    startSec: source.startSec,
    linkGroupId: undefined
  };
  return { next: [...current, copy], copy };
}

export function createLinkGroupId(prefix = "link") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}

/** All clips sharing the same linkGroupId (includes the source). Empty if unlinked / missing. */
export function findLinkedPeers(
  current: BrainVideoClipInstance[],
  instanceId: string
): BrainVideoClipInstance[] {
  const source = current.find((item) => item.id === instanceId);
  if (!source) return [];
  const groupId = String(source.linkGroupId || "").trim();
  if (!groupId) return [source];
  return current.filter((item) => String(item.linkGroupId || "").trim() === groupId);
}

/** Clear linkGroupId on the whole group so members move/trim independently. */
export function unlinkClipGroup(
  current: BrainVideoClipInstance[],
  instanceId: string
): { next: BrainVideoClipInstance[]; cleared: number; groupId?: string } {
  const peers = findLinkedPeers(current, instanceId);
  const groupId = peers.find((item) => item.linkGroupId)?.linkGroupId;
  if (!groupId || peers.length < 2) {
    // Still clear a lone leftover flag.
    if (peers.length === 1 && peers[0]?.linkGroupId) {
      return {
        next: current.map((item) => (
          item.id === peers[0]!.id ? { ...item, linkGroupId: undefined } : item
        )),
        cleared: 1,
        groupId
      };
    }
    return { next: current, cleared: 0, groupId };
  }
  const ids = new Set(peers.map((item) => item.id));
  return {
    next: current.map((item) => (
      ids.has(item.id) ? { ...item, linkGroupId: undefined } : item
    )),
    cleared: peers.length,
    groupId
  };
}

/**
 * Prefer peel soundtrack as the natural peer for a video (or vice versa).
 * Does not auto-pick 旁白 primary A unless `allowNarration` is true.
 */
export function findRelinkCandidate(
  current: BrainVideoClipInstance[],
  instanceId: string,
  options: { allowNarration?: boolean; partnerId?: string } = {}
): BrainVideoClipInstance | undefined {
  const source = current.find((item) => item.id === instanceId);
  if (!source) return undefined;
  if (options.partnerId) {
    const partner = current.find((item) => item.id === options.partnerId);
    if (partner && partner.kind !== source.kind) return partner;
  }
  const wantKind = source.kind === "video" ? "audio" : "video";
  const sameShot = current.filter(
    (item) => item.kind === wantKind && item.shotId && source.shotId && item.shotId === source.shotId
  );
  if (wantKind === "audio") {
    const peel = sameShot.find((item) => isSecondaryClipInstanceId(item.id) && item.id.includes("-peel"));
    if (peel) return peel;
    if (options.allowNarration) {
      return sameShot.find((item) => !isSecondaryClipInstanceId(item.id));
    }
    return undefined;
  }
  return sameShot.find((item) => item.kind === "video");
}

/** Premiere-style Relink: share a new linkGroupId; keep each clip's current time position. */
export function relinkAvInstances(
  current: BrainVideoClipInstance[],
  videoOrAId: string,
  audioOrBId?: string
): { next: BrainVideoClipInstance[]; linkGroupId?: string; error?: string } {
  const source = current.find((item) => item.id === videoOrAId);
  if (!source) return { next: current, error: "未找到片段" };
  const partner = audioOrBId
    ? current.find((item) => item.id === audioOrBId)
    : findRelinkCandidate(current, videoOrAId);
  if (!partner) {
    return {
      next: current,
      error: "无可链接的配对（请选中 V + 原声 A，或 Shift 点选另一片段）"
    };
  }
  if (partner.kind === source.kind) {
    return { next: current, error: "只能链接视频与音频一对" };
  }
  const video = source.kind === "video" ? source : partner;
  const audio = source.kind === "audio" ? source : partner;
  const linkGroupId = createLinkGroupId("link");
  const ids = new Set([video.id, audio.id]);
  return {
    next: current.map((item) => (
      ids.has(item.id) ? { ...item, linkGroupId } : item
    )),
    linkGroupId
  };
}

export function isLinkedClipGroup(
  current: BrainVideoClipInstance[],
  instanceId: string
): boolean {
  return findLinkedPeers(current, instanceId).length > 1;
}
