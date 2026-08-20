import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import type { BrainMusicMediaInfo } from "@codex-forge/protocol/music-types";

export class MusicMediaService {
  constructor(private readonly storage: BrainWorkspaceStorage, private readonly resolveWorkspaceRoot: (id: string) => Promise<string>) {}
  async inspect(ownerId: string, projectId: string, sourceFileId: string): Promise<BrainMusicMediaInfo> {
    const project = this.storage.getProject(ownerId, projectId); if (project.primaryWorkspaceKey !== "music") throw new Error("BRAIN_MUSIC_WORKSPACE_REQUIRED"); if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const file = this.storage.getFile(ownerId, projectId, sourceFileId); const root = await realpath(await this.resolveWorkspaceRoot(project.localWorkspaceId)); if (isAbsolute(file.storageKey)) throw new Error("BRAIN_MUSIC_PATH_OUTSIDE_PROJECT"); const path = await realpath(resolve(root, file.storageKey)); const rel = relative(root, path); if (!rel || rel.startsWith("..") || isAbsolute(rel) || !(await stat(path)).isFile()) throw new Error("BRAIN_MUSIC_PATH_OUTSIDE_PROJECT");
    const bytes = await readFile(path); const ext = file.logicalName.toLowerCase().split(".").pop(); if (ext === "mid" || ext === "midi") return this.midi(sourceFileId, bytes); if (ext === "wav") return this.wav(sourceFileId, bytes); throw new Error("BRAIN_MUSIC_FORMAT_UNSUPPORTED");
  }
  private wav(id: string, b: Buffer): BrainMusicMediaInfo { if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("BRAIN_MUSIC_WAV_INVALID"); const channels = b.readUInt16LE(22); const rate = b.readUInt32LE(24); const bits = b.readUInt16LE(34); const data = b.readUInt32LE(40); const durationMs = rate && channels && bits ? Math.round(data / (rate * channels * bits / 8) * 1000) : 0; return { sourceFileId: id, kind: "audio", durationMs, sampleRate: rate, channels, warnings: data ? [] : ["WAV 未找到音频数据"] }; }
  private midi(id: string, b: Buffer): BrainMusicMediaInfo { if (b.length < 14 || b.toString("ascii", 0, 4) !== "MThd") throw new Error("BRAIN_MUSIC_MIDI_INVALID"); const tracks = b.readUInt16BE(10); const ticks = b.readUInt16BE(12); return { sourceFileId: id, kind: "midi", durationMs: 0, midiTracks: tracks, midiTicks: ticks, warnings: ["MIDI 时长将在事件解析器接入后计算"] }; }
}
