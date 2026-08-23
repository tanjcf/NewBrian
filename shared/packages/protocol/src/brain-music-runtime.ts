/** BRAIN Music Runtime v1 — DAW editor protocol contract. */

export const BRAIN_MUSIC_RUNTIME_VERSION = "brain-music-runtime-v1" as const;

export const brainMusicCoreOperations = {
  dawGet: "music.daw_get",
  dawSave: "music.daw_save",
  cook: "music.cook"
} as const;

export type BrainMusicCoreOperation =
  (typeof brainMusicCoreOperations)[keyof typeof brainMusicCoreOperations];

export interface BrainMusicTrack {
  id: string;
  name: string;
  clip: string;
  start: number;
  width: number;
  muted: boolean;
}

export interface BrainMusicDawState {
  schemaVersion?: number;
  pipeline?: typeof BRAIN_MUSIC_RUNTIME_VERSION;
  title: string;
  lyrics: string;
  style: unknown;
  tracks: BrainMusicTrack[];
  markers: unknown[];
  segments: unknown[];
  exportFormat: string;
}

export interface BrainMusicDawSavePayload {
  state: BrainMusicDawState;
}

export function requiresMusicCoreApproval(operation: BrainMusicCoreOperation): boolean {
  return operation !== brainMusicCoreOperations.dawGet;
}
