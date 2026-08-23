import type { BrainVideoClip, BrainVideoTimeline } from "@codex-forge/protocol";
import { randomUUID } from "node:crypto";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { formatSrt, parseSrt } from "./video-subtitle-utils.js";

export class VideoTimelineService {
  private readonly storage: BrainWorkspaceStorage;
  constructor(storage: BrainWorkspaceStorage) { this.storage = storage; }
  ensureTimeline(ownerId: string, projectId: string, settings: { title: string; width: number; height: number; fps: number }): BrainVideoTimeline {
    return this.storage.getVideoTimeline(ownerId, projectId) ?? this.storage.saveVideoTimeline({ ownerId, projectId, ...settings });
  }
  getTimeline(ownerId: string, projectId: string): BrainVideoTimeline {
    const timeline = this.storage.getVideoTimeline(ownerId, projectId);
    if (!timeline) throw new Error("BRAIN_VIDEO_TIMELINE_NOT_FOUND");
    return timeline;
  }
  addClip(ownerId: string, projectId: string, clip: Omit<BrainVideoClip, "id" | "text" | "volume"> & Partial<Pick<BrainVideoClip, "id" | "text" | "volume">>): BrainVideoTimeline {
    return this.storage.addVideoClip({
      ownerId,
      projectId,
      clip: {
        ...clip,
        id: clip.id || `video-clip-${randomUUID()}`,
        text: clip.text || "",
        volume: clip.volume ?? 1
      }
    });
  }
  importSubtitlesFromSrt(ownerId: string, projectId: string, srt: string): BrainVideoTimeline {
    this.ensureTimeline(ownerId, projectId, { title: "未命名时间线", width: 1920, height: 1080, fps: 30 });
    const cues = parseSrt(srt);
    const clips: BrainVideoClip[] = cues.map((cue) => ({
      id: `subtitle-${randomUUID()}`,
      trackType: "subtitle",
      sourceFileId: "",
      startMs: cue.startMs,
      durationMs: Math.max(1, cue.endMs - cue.startMs),
      sourceInMs: 0,
      volume: 1,
      text: cue.text
    }));
    return this.storage.replaceVideoSubtitleClips({ ownerId, projectId, clips });
  }
  exportSubtitlesToSrt(ownerId: string, projectId: string) {
    const timeline = this.getTimeline(ownerId, projectId);
    const cues = timeline.clips
      .filter((clip) => clip.trackType === "subtitle")
      .sort((left, right) => left.startMs - right.startMs)
      .map((clip) => ({ startMs: clip.startMs, endMs: clip.startMs + clip.durationMs, text: clip.text || "" }));
    return formatSrt(cues);
  }
}
