export type BrainMusicTrackType = "audio" | "midi";
export type BrainMusicArtifactType = "waveform" | "midi" | "mix" | "stem";

export interface BrainMusicClip {
  id: string;
  trackType: BrainMusicTrackType;
  sourceFileId: string;
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  gain: number;
  pan: number;
}

export interface BrainMusicTimeline {
  schemaVersion: 1;
  projectId: string;
  title: string;
  sampleRate: number;
  channels: 1 | 2;
  durationMs: number;
  clips: BrainMusicClip[];
  updatedAt: string;
}

export interface BrainMusicRenderRequest {
  projectId: string;
  outputRelativePath: string;
  artifactType: BrainMusicArtifactType;
  timeline: BrainMusicTimeline;
}
export interface BrainMusicMediaInfo { sourceFileId: string; kind: BrainMusicTrackType; durationMs: number; sampleRate?: number; channels?: number; waveform?: number[]; midiTracks?: number; midiTicks?: number; warnings: string[]; }
