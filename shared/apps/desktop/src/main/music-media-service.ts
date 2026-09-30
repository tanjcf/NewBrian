import { realpath, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import type { BrainMusicMediaInfo } from "@codex-forge/protocol/music-types";
import { probeMediaAv } from "./video-media-peel.js";

const COMPRESSED_AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "flac", "ogg", "opus"]);

function audioExtension(...names: string[]) {
  for (const name of names) {
    const ext = extname(String(name || "")).toLowerCase().replace(/^\./, "");
    if (ext) return ext;
  }
  return "";
}

export class MusicMediaService {
  private readonly storage: BrainWorkspaceStorage;
  private readonly resolveWorkspaceRoot: (id: string) => Promise<string>;
  private readonly resolveFfprobe?: () => Promise<string>;
  constructor(
    storage: BrainWorkspaceStorage,
    resolveWorkspaceRoot: (id: string) => Promise<string>,
    resolveFfprobe?: () => Promise<string>
  ) {
    this.storage = storage;
    this.resolveWorkspaceRoot = resolveWorkspaceRoot;
    this.resolveFfprobe = resolveFfprobe;
  }
  async inspect(ownerId: string, projectId: string, sourceFileId: string): Promise<BrainMusicMediaInfo> {
    const project = this.storage.getProject(ownerId, projectId); if (project.primaryWorkspaceKey !== "music") throw new Error("BRAIN_MUSIC_WORKSPACE_REQUIRED"); if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const file = this.storage.getFile(ownerId, projectId, sourceFileId); const root = await realpath(await this.resolveWorkspaceRoot(project.localWorkspaceId)); if (isAbsolute(file.storageKey)) throw new Error("BRAIN_MUSIC_PATH_OUTSIDE_PROJECT"); const path = await realpath(resolve(root, file.storageKey)); const rel = relative(root, path); if (!rel || rel.startsWith("..") || isAbsolute(rel) || !(await stat(path)).isFile()) throw new Error("BRAIN_MUSIC_PATH_OUTSIDE_PROJECT");
    const ext = audioExtension(file.logicalName, file.storageKey, path);
    if (ext === "mid" || ext === "midi") return this.midi(sourceFileId, await readFile(path));
    if (ext === "wav") return this.wav(sourceFileId, await readFile(path));
    if (COMPRESSED_AUDIO_EXTENSIONS.has(ext)) return this.compressedAudio(sourceFileId, path);
    throw new Error("BRAIN_MUSIC_FORMAT_UNSUPPORTED");
  }
  private async compressedAudio(id: string, path: string): Promise<BrainMusicMediaInfo> {
    const ffprobe = this.resolveFfprobe ? await this.resolveFfprobe().catch(() => "") : "";
    if (ffprobe) {
      try {
        const probe = await probeMediaAv(path, { ffprobeExecutable: ffprobe, timeoutMs: 30_000 });
        if (!probe.hasAudio) throw new Error("BRAIN_MUSIC_FORMAT_UNSUPPORTED");
        return {
          sourceFileId: id,
          kind: "audio",
          durationMs: Math.max(0, Math.round(probe.durationSec * 1000)),
          warnings: probe.hasVideo ? ["文件含视频轨，音乐工作区仅使用音频部分"] : []
        };
      } catch (error) {
        if (error instanceof Error && error.message === "BRAIN_MUSIC_FORMAT_UNSUPPORTED") throw error;
      }
    }
    return {
      sourceFileId: id,
      kind: "audio",
      durationMs: 0,
      warnings: ["未能解析压缩音频时长，请确认已安装 ffprobe 或稍后重试"]
    };
  }
  private wav(id: string, b: Buffer): BrainMusicMediaInfo {
    if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("BRAIN_MUSIC_WAV_INVALID");
    const channels = b.readUInt16LE(22);
    const rate = b.readUInt32LE(24);
    const bits = b.readUInt16LE(34);
    let dataOffset = 44;
    let dataSize = 0;
    for (let index = 12; index + 8 <= b.length; ) {
      const chunkId = b.toString("ascii", index, index + 4);
      const chunkSize = b.readUInt32LE(index + 4);
      if (chunkId === "data") {
        dataOffset = index + 8;
        dataSize = chunkSize;
        break;
      }
      index += 8 + chunkSize + (chunkSize % 2);
    }
    if (!dataSize) dataSize = Math.max(0, b.length - dataOffset);
    const durationMs = rate && channels && bits ? Math.round(dataSize / (rate * channels * bits / 8) * 1000) : 0;
    const waveform: number[] = [];
    const bytesPerSample = Math.max(1, Math.floor(bits / 8));
    const frames = Math.floor(dataSize / Math.max(1, channels * bytesPerSample));
    const stride = Math.max(1, Math.floor(frames / 256));
    for (let frame = 0; frame < frames && waveform.length < 256; frame += stride) {
      const position = dataOffset + frame * channels * bytesPerSample;
      if (position + bytesPerSample > b.length) break;
      const sample = bits === 16 ? b.readInt16LE(position) / 32768 : bits === 8 ? (b[position] - 128) / 128 : 0;
      waveform.push(Math.max(-1, Math.min(1, sample)));
    }
    return { sourceFileId: id, kind: "audio", durationMs, sampleRate: rate, channels, waveform, warnings: dataSize ? [] : ["WAV 未找到音频数据"] };
  }
  private midi(id: string, b: Buffer): BrainMusicMediaInfo { if (b.length < 14 || b.toString("ascii", 0, 4) !== "MThd") throw new Error("BRAIN_MUSIC_MIDI_INVALID"); const tracks = b.readUInt16BE(10); const ticks = b.readUInt16BE(12); return { sourceFileId: id, kind: "midi", durationMs: 0, midiTracks: tracks, midiTicks: ticks, warnings: ["MIDI 时长将在事件解析器接入后计算"] }; }
}
