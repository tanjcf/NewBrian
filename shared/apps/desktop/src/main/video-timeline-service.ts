import type { BrainVideoClip, BrainVideoTimeline } from "@codex-forge/protocol";
import { randomUUID } from "node:crypto";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

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
    return this.storage.addVideoClip({ ownerId, projectId, clip: { id: clip.id || `video-clip-${randomUUID()}`, text: clip.text || "", volume: clip.volume ?? 1, ...clip } });
  }
}
