import { randomUUID } from "node:crypto";
import type { BrainMusicClip, BrainMusicTimeline } from "@codex-forge/protocol/music-types";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

export class MusicTimelineService {
  private readonly storage: BrainWorkspaceStorage;
  constructor(storage: BrainWorkspaceStorage) { this.storage = storage; }
  ensureTimeline(ownerId: string, projectId: string, settings: { title: string; sampleRate: number; channels: 1 | 2 }): BrainMusicTimeline {
    return this.storage.getMusicTimeline(ownerId, projectId) ?? this.storage.saveMusicTimeline({ ownerId, projectId, ...settings });
  }
  getTimeline(ownerId: string, projectId: string): BrainMusicTimeline {
    const timeline = this.storage.getMusicTimeline(ownerId, projectId);
    if (!timeline) throw new Error("BRAIN_MUSIC_TIMELINE_NOT_FOUND");
    return timeline;
  }
  addClip(ownerId: string, projectId: string, clip: Omit<BrainMusicClip, "id"> & { id?: string }): BrainMusicTimeline {
    return this.storage.addMusicClip({ ownerId, projectId, clip: { ...clip, id: clip.id || `music-clip-${randomUUID()}` } });
  }
}
