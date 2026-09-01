/**
 * Music-scene Agent tools: drive the right-side Music DAW / Tools panel
 * (same pattern as video.pipeline.* / video.shot.generate).
 */
import { createHash } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import {
  BRAIN_MUSIC_RUNTIME_VERSION,
  type BrainMusicDawState,
  type BrainMusicTrack
} from "@codex-forge/protocol/brain-music-runtime";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import type { MusicRenderService } from "./music-render-service.js";
import type { MusicRuntimeService } from "./music-runtime-service.js";
import type { MusicTimelineService } from "./music-timeline-service.js";

type ToolRuntime = {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(
    definition: Record<string, unknown>,
    execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>
  ): unknown;
};

export type MusicGenerationResult = { url: string; providerResult: unknown };

export type MusicAgentToolDependencies = {
  ownerId: () => Promise<string>;
  projectId: string;
  projectRoot: string;
  storage: BrainWorkspaceStorage;
  musicRuntime: MusicRuntimeService;
  timeline: MusicTimelineService;
  render: MusicRenderService;
  generateMusic: (input: { prompt: string; model?: string }) => Promise<MusicGenerationResult>;
  notifyUi?: (payload: { projectId: string; reason: string }) => void;
  fetchImpl?: typeof fetch;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => String(value ?? "").trim();
const TRUSTED_COS_HOST = /(?:^|\.)(?:cos\.[a-z0-9-]+\.myqcloud\.com|cos\.[a-z0-9-]+\.tencentcos\.cn)$/i;

async function fetchGeneratedMedia(deps: MusicAgentToolDependencies, parsed: URL): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    return await fetchImpl(parsed);
  } catch (error) {
    if (parsed.protocol !== "https:" || !TRUSTED_COS_HOST.test(parsed.hostname)) throw error;
    const fallback = new URL(parsed);
    fallback.protocol = "http:";
    return fetchImpl(fallback);
  }
}

function emptyDawState(partial?: Partial<BrainMusicDawState>): BrainMusicDawState {
  return {
    schemaVersion: 1,
    pipeline: BRAIN_MUSIC_RUNTIME_VERSION,
    title: text(partial?.title) || "未命名歌曲",
    lyrics: typeof partial?.lyrics === "string" ? partial.lyrics : "",
    style: partial?.style ?? { genre: "cinematic", mood: "hopeful", bpm: 90 },
    tracks: Array.isArray(partial?.tracks) ? partial!.tracks! : [],
    markers: Array.isArray(partial?.markers) ? partial!.markers! : [],
    segments: Array.isArray(partial?.segments) ? partial!.segments! : [],
    exportFormat: text(partial?.exportFormat) || "wav"
  };
}

function asTrack(value: unknown): BrainMusicTrack | null {
  const row = record(value);
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    clip: text(row.clip),
    start: Number.isFinite(Number(row.start)) ? Number(row.start) : 0,
    width: Number.isFinite(Number(row.width)) ? Number(row.width) : 32,
    muted: row.muted === true
  };
}

function normalizeDawState(value: unknown): BrainMusicDawState {
  const input = record(value);
  const tracks = Array.isArray(input.tracks)
    ? input.tracks.map(asTrack).filter((track): track is BrainMusicTrack => Boolean(track))
    : [];
  const title = text(input.title);
  if (!title) throw new TypeError("title is required");
  if (typeof input.lyrics !== "string") throw new TypeError("lyrics must be a string");
  return {
    schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : 1,
    pipeline: BRAIN_MUSIC_RUNTIME_VERSION,
    title,
    lyrics: input.lyrics,
    style: input.style ?? {},
    tracks,
    markers: Array.isArray(input.markers) ? input.markers : [],
    segments: Array.isArray(input.segments) ? input.segments : [],
    exportFormat: text(input.exportFormat) || "wav"
  };
}

async function readDawState(deps: MusicAgentToolDependencies): Promise<BrainMusicDawState> {
  const binding = { projectId: deps.projectId, projectRoot: deps.projectRoot };
  const raw = record(await deps.musicRuntime.dawGet(binding));
  const state = raw.state ?? raw;
  try {
    return normalizeDawState(state);
  } catch {
    return emptyDawState(record(state) as Partial<BrainMusicDawState>);
  }
}

function notify(deps: MusicAgentToolDependencies, reason: string) {
  deps.notifyUi?.({ projectId: deps.projectId, reason });
}

function mimeForAudioPath(relativePath: string) {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "audio/mpeg";
}

async function persistGeneratedMusic(deps: MusicAgentToolDependencies, url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("BRAIN_MUSIC_MEDIA_URL_INVALID");
  const response = await fetchGeneratedMedia(deps, parsed);
  if (!response.ok) throw new Error(`BRAIN_MUSIC_MEDIA_DOWNLOAD_FAILED:${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > 128 * 1024 * 1024) throw new Error("BRAIN_MUSIC_MEDIA_TOO_LARGE");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 128 * 1024 * 1024) throw new Error("BRAIN_MUSIC_MEDIA_INVALID");
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const fromUrl = basename(parsed.pathname);
  const ext = fromUrl.includes(".")
    ? fromUrl.slice(fromUrl.lastIndexOf("."))
    : contentType.includes("wav")
      ? ".wav"
      : contentType.includes("flac")
        ? ".flac"
        : contentType.includes("ogg")
          ? ".ogg"
          : contentType.includes("m4a") || contentType.includes("mp4")
            ? ".m4a"
            : ".mp3";
  const root = await realpath(deps.projectRoot);
  const relativePath = `media/stems/song-${Date.now()}${ext}`;
  const target = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(boundary)) throw new Error("BRAIN_MUSIC_MEDIA_PATH_INVALID");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const fileStat = await stat(target);
  const ownerId = await deps.ownerId();
  const file = deps.storage.registerFile({
    ownerId,
    projectId: deps.projectId,
    logicalName: basename(relativePath),
    mimeType: mimeForAudioPath(relativePath),
    sizeBytes: fileStat.size,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    storageKey: relativePath
  });
  return { file, relativePath, bytes: bytes.length };
}

function buildGeneratePrompt(input: {
  prompt?: string;
  title?: string;
  lyrics?: string;
  style?: unknown;
}) {
  const explicit = text(input.prompt);
  if (explicit) return explicit;
  const parts = [
    text(input.title) ? `Title: ${text(input.title)}` : "",
    input.style != null && text(typeof input.style === "string" ? input.style : JSON.stringify(input.style))
      ? `Style: ${typeof input.style === "string" ? text(input.style) : JSON.stringify(input.style)}`
      : "",
    text(input.lyrics) ? `Lyrics:\n${text(input.lyrics)}` : ""
  ].filter(Boolean);
  if (!parts.length) throw new TypeError("prompt or title/lyrics/style is required");
  return parts.join("\n");
}

/** Register music-scene tools on the project-scoped Agent runtime. */
export function registerMusicAgentTools(runtime: ToolRuntime, deps: MusicAgentToolDependencies) {
  if (!deps.projectId.trim() || !deps.projectRoot.trim()) return;
  runtime.unregisterExternalTools("music");
  const binding = { projectId: deps.projectId, projectRoot: deps.projectRoot };

  runtime.registerExternalTool({
    name: "music.project.inspect",
    title: "读取音乐工程",
    description: "读取右侧音乐创作 Tools（DAW）的真实状态、时间线与文件登记。先 inspect 再改写。",
    namespace: "music",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const ownerId = await deps.ownerId();
    const daw = await deps.musicRuntime.dawGet(binding);
    const timeline = (() => {
      try {
        return deps.timeline.getTimeline(ownerId, deps.projectId);
      } catch {
        return null;
      }
    })();
    return {
      ok: true,
      output: JSON.stringify({
        daw,
        timeline,
        files: deps.storage.listFiles(ownerId, deps.projectId),
        panel: "右侧 Tools · 生成 / 音轨 / 标记切片 / 导出"
      })
    };
  });

  runtime.registerExternalTool({
    name: "music.daw.save",
    title: "保存歌词风格到右侧 DAW",
    description: "把标题、歌词、风格、音轨编排真实写入右侧音乐创作 Tools（DAW）。用户要改歌词/风格/曲名时必须调用，只回复文字不算完成。",
    namespace: "music",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        lyrics: { type: "string" },
        style: {},
        tracks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              clip: { type: "string" },
              start: { type: "number" },
              width: { type: "number" },
              muted: { type: "boolean" }
            },
            required: ["id", "name"],
            additionalProperties: false
          }
        },
        markers: { type: "array" },
        segments: { type: "array" },
        exportFormat: { type: "string" }
      },
      required: ["title", "lyrics"],
      additionalProperties: false
    }
  }, async (input) => {
    const current = await readDawState(deps);
    const next = normalizeDawState({
      ...current,
      title: text(input.title) || current.title,
      lyrics: typeof input.lyrics === "string" ? input.lyrics : current.lyrics,
      style: input.style !== undefined ? input.style : current.style,
      tracks: Array.isArray(input.tracks) ? input.tracks : current.tracks,
      markers: Array.isArray(input.markers) ? input.markers : current.markers,
      segments: Array.isArray(input.segments) ? input.segments : current.segments,
      exportFormat: text(input.exportFormat) || current.exportFormat
    });
    const saved = await deps.musicRuntime.dawSave(binding, next);
    notify(deps, "music:daw.save");
    return { ok: true, output: JSON.stringify(saved) };
  });

  runtime.registerExternalTool({
    name: "music.song.generate",
    title: "生成整曲并写入右侧 DAW",
    description:
      "在音乐创作场景必须用本工具（不要只用裸 music_generate）。调用 spring-app music_generate，下载真实音频到 media/stems/，登记文件，更新右侧「生成/音轨」DAW，并挂到音乐时间线。",
    namespace: "music",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "完整生成提示；若省略则用 title/lyrics/style 组装" },
        title: { type: "string" },
        lyrics: { type: "string" },
        style: {},
        model: { type: "string" },
        durationMs: { type: "integer", minimum: 1000, maximum: 600000 }
      },
      additionalProperties: false
    }
  }, async (input) => {
    const current = await readDawState(deps);
    const title = text(input.title) || current.title;
    const lyrics = typeof input.lyrics === "string" ? input.lyrics : current.lyrics;
    const style = input.style !== undefined ? input.style : current.style;
    const prompt = buildGeneratePrompt({ prompt: text(input.prompt), title, lyrics, style });
    const generated = await deps.generateMusic({ prompt, model: text(input.model) || undefined });
    const persisted = await persistGeneratedMusic(deps, generated.url);
    const trackId = `stem-${Date.now()}`;
    const tracks = [
      ...current.tracks.filter((track) => track.clip),
      {
        id: trackId,
        name: title || "生成整曲",
        clip: persisted.relativePath,
        start: 0,
        width: 64,
        muted: false
      }
    ];
    const next = normalizeDawState({ ...current, title, lyrics, style, tracks });
    const daw = await deps.musicRuntime.dawSave(binding, next);
    const ownerId = await deps.ownerId();
    const durationMs = Math.max(1000, Number(input.durationMs) || 120_000);
    deps.timeline.ensureTimeline(ownerId, deps.projectId, { title: title || "音乐时间线", sampleRate: 48_000, channels: 2 });
    const timeline = deps.timeline.addClip(ownerId, deps.projectId, {
      trackType: "audio",
      sourceFileId: persisted.file.id,
      startMs: 0,
      durationMs,
      sourceInMs: 0,
      gain: 1,
      pan: 0
    });
    notify(deps, "music:song.generate");
    return {
      ok: true,
      output: JSON.stringify({
        generated: generated.providerResult,
        file: persisted.file,
        relativePath: persisted.relativePath,
        daw,
        timeline,
        panelHint: "右侧 Tools 已更新 · 请查看「生成」与「音轨」页签"
      })
    };
  });

  runtime.registerExternalTool({
    name: "music.daw.cook",
    title: "Cook 音乐工程",
    description: "把右侧 DAW 草稿 cook 为 Docs/BRAIN 歌词与风格产物。",
    namespace: "music",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }, async () => {
    const result = await deps.musicRuntime.cook(binding);
    notify(deps, "music:daw.cook");
    return { ok: true, output: JSON.stringify(result) };
  });

  runtime.registerExternalTool({
    name: "music.render.start",
    title: "导出混音",
    description: "通过 Rust Core 与 FFmpeg 渲染当前音乐时间线 mix；返回 renderId 后用 music.render.status 查询。",
    namespace: "music",
    kind: "write",
    risk: "medium",
    requiresApproval: true,
    inputSchema: {
      type: "object",
      properties: { outputRelativePath: { type: "string", description: "例如 exports/music-mix.wav" } },
      required: ["outputRelativePath"],
      additionalProperties: false
    }
  }, async (input) => {
    const ownerId = await deps.ownerId();
    const timeline = deps.timeline.getTimeline(ownerId, deps.projectId);
    const files = new Map(deps.storage.listFiles(ownerId, deps.projectId).map((file) => [file.id, file]));
    const mediaRelativePaths = timeline.clips
      .map((clip) => files.get(clip.sourceFileId)?.storageKey || "")
      .filter(Boolean);
    const result = await deps.render.start(ownerId, {
      projectId: deps.projectId,
      projectRoot: deps.projectRoot,
      timeline,
      outputRelativePath: text(input.outputRelativePath),
      artifactType: "mix",
      mediaRelativePaths
    });
    notify(deps, "music:render.start");
    return { ok: true, output: JSON.stringify(result) };
  });

  runtime.registerExternalTool({
    name: "music.render.status",
    title: "查询音乐渲染状态",
    description: "查询真实 FFmpeg 混音任务；SUCCEEDED 时返回输出路径。",
    namespace: "music",
    kind: "read",
    risk: "low",
    requiresApproval: false,
    inputSchema: {
      type: "object",
      properties: { renderId: { type: "string" } },
      required: ["renderId"],
      additionalProperties: false
    }
  }, async (input) => ({
    ok: true,
    output: JSON.stringify(deps.render.status(await deps.ownerId(), text(input.renderId)))
  }));
}
