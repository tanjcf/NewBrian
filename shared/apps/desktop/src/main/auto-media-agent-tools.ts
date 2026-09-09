/**
 * Auto chat media tools: model decides via tool_calls whether to generate.
 * Execution stays on spring-app `/v1/auto/tools/invoke` (keys never leave the gateway).
 * Completed assets are downloaded into the workspace so the user can open them locally.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";
import type { BrainWorkspaceKey } from "@codex-forge/protocol";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import {
  extractMediaUrlsFromResult,
  formatGenerationJobProgress,
  runAutoMediaTool,
  type AutoMediaToolName,
  type GenerationJobSnapshot,
  DEFAULT_AUTO_MEDIA_POLL_INTERVAL_MS
} from "./media-generation-gateway.ts";

type ToolRuntime = {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(
    definition: Record<string, unknown>,
    execute: (input: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>
  ): unknown;
};

export type AutoMediaAgentToolDependencies = {
  workspaceId: string;
  threadId: string;
  /** Absolute workspace root used to persist downloaded media. */
  workspaceRoot: string;
  /**
   * Managed composer attachment directories (app state, outside the project tree).
   * Chat uploads live here; image_generate/video_generate may use them as reference images.
   */
  attachmentRoots?: string[];
  resolveGateway: () => Promise<{ baseUrl: string; bearerToken: string }>;
  /** Open a workspace-relative image/video in the side panel after download. */
  openLocalMedia?: (input: { kind: "image" | "video"; relativePath: string }) => Promise<void> | void;
  /** When set, downloaded media is registered into BRAIN 文件/产物/任务. */
  ownerId?: () => Promise<string>;
  projectId?: string;
  workspaceKey?: BrainWorkspaceKey | string;
  storage?: BrainWorkspaceStorage;
  notifyUi?: (payload: { projectId: string; reason: string }) => void;
  onProgress?: (detail: string) => void;
  onJobId?: (mediaJobId: string) => void;
  /** Active model-chat turn abort signal (user cancel). */
  resolveAbortSignal?: () => AbortSignal | undefined;
  fetchImpl?: typeof fetch;
};

const text = (value: unknown) => String(value ?? "").trim();
const TRUSTED_COS_HOST = /(?:^|\.)(?:cos\.[a-z0-9-]+\.myqcloud\.com|cos\.[a-z0-9-]+\.tencentcos\.cn)$/i;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_MUSIC_BYTES = 128 * 1024 * 1024;

type GeneratedMediaKind = "image" | "video" | "music";

function mediaKindForTool(toolName: AutoMediaToolName): GeneratedMediaKind {
  if (toolName === "video_generate") return "video";
  if (toolName === "music_generate") return "music";
  return "image";
}

async function fetchGeneratedMedia(fetchImpl: typeof fetch, parsed: URL): Promise<Response> {
  try {
    return await fetchImpl(parsed);
  } catch (error) {
    if (parsed.protocol !== "https:" || !TRUSTED_COS_HOST.test(parsed.hostname)) throw error;
    const fallback = new URL(parsed);
    fallback.protocol = "http:";
    return fetchImpl(fallback);
  }
}

function guessExtension(kind: GeneratedMediaKind, url: string, contentType: string): string {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (fromUrl && fromUrl.length <= 5) return fromUrl;
  const mime = contentType.toLowerCase();
  if (kind === "video") {
    if (mime.includes("webm")) return ".webm";
    if (mime.includes("quicktime")) return ".mov";
    return ".mp4";
  }
  if (kind === "music") {
    if (mime.includes("wav")) return ".wav";
    if (mime.includes("flac")) return ".flac";
    if (mime.includes("ogg")) return ".ogg";
    if (mime.includes("m4a") || mime.includes("mp4")) return ".m4a";
    return ".mp3";
  }
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  return ".png";
}

/**
 * Download a remote media URL into `{workspace}/.newbrain/generated-media/{kind}/`.
 *
 * @param workspaceRoot Absolute workspace root
 * @param kind image, video, or music
 * @param url Remote https URL from spring-app
 * @param fetchImpl Optional fetch implementation
 * @returns Workspace-relative path of the saved file
 */
export async function downloadGeneratedMediaToWorkspace(input: {
  workspaceRoot: string;
  kind: GeneratedMediaKind;
  url: string;
  fetchImpl?: typeof fetch;
  index?: number;
}): Promise<{ relativePath: string; absolutePath: string; bytes: number }> {
  const parsed = new URL(input.url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("媒体地址无效（仅支持 http/https）。");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchGeneratedMedia(fetchImpl, parsed);
  if (!response.ok) {
    throw new Error(`下载生成结果失败（HTTP ${response.status}）。`);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  const maxBytes = input.kind === "video"
    ? MAX_VIDEO_BYTES
    : input.kind === "music"
      ? MAX_MUSIC_BYTES
      : MAX_IMAGE_BYTES;
  if (declared > maxBytes) throw new Error("生成文件过大，已拒绝下载。");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error("生成文件无效或过大。");
  const root = await realpath(input.workspaceRoot);
  const extension = guessExtension(
    input.kind,
    input.url,
    String(response.headers.get("content-type") || "")
  );
  const stamp = Date.now();
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  const indexPart = input.index == null ? "" : `-${input.index + 1}`;
  const relativePath = `.newbrain/generated-media/${input.kind}/${stamp}${indexPart}-${digest}${extension}`;
  const absolutePath = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!absolutePath.startsWith(boundary)) throw new Error("媒体落盘路径非法。");
  await mkdir(resolve(root, `.newbrain/generated-media/${input.kind}`), { recursive: true });
  await writeFile(absolutePath, bytes);
  return { relativePath: relativePath.replace(/\\/g, "/"), absolutePath, bytes: bytes.length };
}

function mimeForGeneratedMedia(kind: GeneratedMediaKind, fileName: string) {
  const extension = extname(fileName).toLowerCase();
  if (kind === "video") {
    if (extension === ".webm") return "video/webm";
    if (extension === ".mov") return "video/quicktime";
    return "video/mp4";
  }
  if (kind === "music") {
    if (extension === ".wav") return "audio/wav";
    if (extension === ".flac") return "audio/flac";
    if (extension === ".ogg") return "audio/ogg";
    if (extension === ".m4a") return "audio/mp4";
    return "audio/mpeg";
  }
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

function artifactTypeForGeneratedMedia(kind: GeneratedMediaKind, fileName: string) {
  const extension = extname(fileName).toLowerCase().replace(".", "");
  if (extension) return extension;
  return kind === "video" ? "video" : kind === "music" ? "audio" : "image";
}

/**
 * Resolve workspace-local or managed-attachment reference images for Auto media tools.
 * Cloud providers cannot fetch local paths; convert trusted local files to data URLs.
 * Chat attachments live under app state (`…/.newbrain/attachments`), not the project tree.
 */
export async function resolveAutoMediaReferenceImage(input: {
  workspaceRoot: string;
  imageUrl: string;
  attachmentRoots?: string[];
  /** Copy attachment-root files into `{workspace}/.newbrain/attachments/` for reuse. Default true. */
  stageIntoWorkspace?: boolean;
}): Promise<string> {
  const raw = text(input.imageUrl);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || /^data:image\//i.test(raw)) return raw;

  const workspaceRoot = await realpath(input.workspaceRoot);
  const attachmentRoots: string[] = [];
  for (const candidate of input.attachmentRoots ?? []) {
    const trimmed = text(candidate);
    if (!trimmed) continue;
    try {
      attachmentRoots.push(await realpath(trimmed));
    } catch {
      attachmentRoots.push(resolve(trimmed));
    }
  }

  const isInside = (absolutePath: string, root: string) => {
    const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
    return absolutePath === root || absolutePath.startsWith(boundary);
  };

  const candidates: string[] = [];
  if (isAbsolute(raw)) {
    candidates.push(resolve(raw));
  } else {
    const relative = raw.replace(/^\.\//, "");
    candidates.push(resolve(workspaceRoot, relative));
    const leaf = basename(relative);
    if (leaf) {
      for (const root of attachmentRoots) {
        candidates.push(resolve(root, leaf));
      }
    }
  }

  let absolute = "";
  for (const candidate of candidates) {
    let resolved = candidate;
    try {
      resolved = await realpath(candidate);
    } catch {
      // Keep candidate for the existence check below.
    }
    const allowed = isInside(resolved, workspaceRoot)
      || attachmentRoots.some((root) => isInside(resolved, root));
    if (!allowed) continue;
    try {
      const fileStat = await stat(resolved);
      if (fileStat.isFile() && fileStat.size > 0) {
        absolute = resolved;
        break;
      }
    } catch {
      // Try the next candidate.
    }
  }
  if (!absolute) {
    throw new Error(`参考图路径无效（必须位于当前工作区或聊天附件目录内）：${raw}`);
  }

  const fileStat = await stat(absolute);
  if (fileStat.size > MAX_IMAGE_BYTES) {
    throw new Error("参考图文件过大，无法用于图生图/图生视频。");
  }

  if (input.stageIntoWorkspace !== false && !isInside(absolute, workspaceRoot)) {
    const stageDir = resolve(workspaceRoot, ".newbrain", "attachments");
    await mkdir(stageDir, { recursive: true });
    const leaf = basename(absolute);
    let stagedPath = resolve(stageDir, leaf);
    try {
      const existing = await stat(stagedPath);
      if (!existing.isFile() || existing.size !== fileStat.size) {
        const digest = createHash("sha256").update(absolute).digest("hex").slice(0, 8);
        stagedPath = resolve(stageDir, `${digest}-${leaf}`);
      }
    } catch {
      // Destination does not exist yet.
    }
    if (!isInside(stagedPath, workspaceRoot)) {
      throw new Error("参考图暂存路径非法。");
    }
    await copyFile(absolute, stagedPath);
  }

  const bytes = await readFile(absolute);
  const mime = mimeForGeneratedMedia("image", basename(absolute));
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** Register a downloaded generated-media file into BRAIN 文件/产物/任务. */
export async function persistGeneratedMediaToProject(
  deps: Pick<AutoMediaAgentToolDependencies, "ownerId" | "projectId" | "workspaceKey" | "storage" | "notifyUi">,
  input: {
    toolName: AutoMediaToolName;
    relativePath: string;
    workspaceRoot: string;
    jobId?: string;
  }
) {
  if (!deps.storage || !deps.projectId || !deps.ownerId) return null;
  const relativePath = input.relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!relativePath || relativePath.includes("..")) return null;
  const root = await realpath(input.workspaceRoot);
  const absolute = resolve(root, relativePath);
  const boundary = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!absolute.startsWith(boundary)) return null;
  const fileStat = await stat(absolute);
  if (!fileStat.isFile() || fileStat.size <= 0) return null;
  const bytes = await readFile(absolute);
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const ownerId = await deps.ownerId();
  const logicalName = basename(relativePath);
  const kind = mediaKindForTool(input.toolName);
  const existingFiles = deps.storage.listFiles(ownerId, deps.projectId);
  const samePath = existingFiles.filter((file) => file.storageKey === relativePath);
  const sameHash = samePath.find((file) => file.contentHash === contentHash);
  const file = sameHash || deps.storage.registerFile({
    ownerId,
    projectId: deps.projectId,
    logicalName,
    mimeType: mimeForGeneratedMedia(kind, logicalName),
    sizeBytes: bytes.length,
    contentHash,
    storageKey: relativePath,
    versionNo: (samePath[0]?.versionNo || 0) + 1
  });
  const artifacts = deps.storage.listArtifacts(ownerId, deps.projectId);
  const existingArtifact = artifacts.find((item) => item.storageKey === relativePath && item.contentHash === contentHash);
  const artifact = existingArtifact || deps.storage.registerArtifact({
    ownerId,
    projectId: deps.projectId,
    sourceFileId: file.id,
    sourceWorkspaceKey: String(deps.workspaceKey || "explore"),
    artifactType: artifactTypeForGeneratedMedia(kind, logicalName),
    storageKey: relativePath,
    contentHash,
    validationStatus: "VALID"
  });
  const idem = `auto-media:${deps.projectId}:${relativePath}:${contentHash}`;
  const task = deps.storage.createTask({
    ownerId,
    projectId: deps.projectId,
    workspaceKey: String(deps.workspaceKey || "explore"),
    taskType: `auto-media.${input.toolName}`,
    requestId: input.jobId ? `${input.toolName}:${input.jobId}` : `${input.toolName}:${relativePath}`,
    idempotencyKey: idem
  });
  const completed = deps.storage.updateTask({
    ownerId,
    taskId: task.id,
    status: "SUCCEEDED",
    progress: 1,
    resultJson: JSON.stringify({
      relativePath,
      sizeBytes: bytes.length,
      fileId: file.id,
      artifactId: artifact.id,
      tool: input.toolName,
      jobId: input.jobId || ""
    })
  });
  deps.notifyUi?.({ projectId: deps.projectId, reason: `auto-media:${input.toolName}` });
  return { file, artifact, task: completed, relativePath, size: bytes.length };
}

function buildToolOutput(input: {
  toolName: AutoMediaToolName;
  reply: string;
  job: GenerationJobSnapshot;
  localPaths: string[];
  remoteUrls: string[];
}): string {
  const kind = mediaKindForTool(input.toolName);
  const label = kind === "video" ? "视频" : kind === "music" ? "音乐" : "图片";
  const lines = [
    input.reply || `${label}已生成完成（任务 ${input.job.id || "unknown"}）。`,
    ""
  ];
  if (input.localPaths.length) {
    lines.push("已下载到本地工作区（请据此回复用户）：");
    for (const path of input.localPaths) {
      lines.push(`- ${path}`);
    }
    lines.push("");
    if (kind === "image" || kind === "video") {
      lines.push("对用户可见回复必须包含上述本地相对路径；可用 workspace.open_image / workspace.open_video 再次打开；禁止再写「正在生成中」或空 markdown 图片占位。");
    } else {
      lines.push("对用户可见回复必须包含上述本地相对路径；禁止再写「正在生成中」占位后结束。");
    }
  } else if (input.remoteUrls.length) {
    lines.push("本地下载失败，仅有远程地址：");
    for (const url of input.remoteUrls) lines.push(`- ${url}`);
  } else {
    lines.push("生成完成但未找到可下载地址。");
  }
  return lines.join("\n");
}

async function executeAutoMediaTool(
  deps: AutoMediaAgentToolDependencies,
  toolName: AutoMediaToolName,
  input: Record<string, unknown>
): Promise<{ ok: boolean; output: string }> {
  const prompt = text(input.prompt);
  if (!prompt) {
    return { ok: false, output: "缺少必填参数 prompt。" };
  }
  const workspaceRoot = text(deps.workspaceRoot);
  if (!workspaceRoot) {
    return { ok: false, output: "当前工作区路径未知，无法落盘生成结果。" };
  }
  const { baseUrl, bearerToken } = await deps.resolveGateway();
  if (!bearerToken) {
    return { ok: false, output: "媒体生成需要已登录的网关凭证。" };
  }
  if (!baseUrl) {
    return { ok: false, output: "媒体生成需要已配置的模型网关地址。" };
  }
  const requestId = `auto-media-${toolName}-${Date.now()}`;
  const kind = mediaKindForTool(toolName);
  const rawImageUrl = text(input.image_url) || text(input.imageUrl)
    || text(input.first_frame) || text(input.firstFrame) || undefined;
  const rawLastFrame = text(input.last_frame) || text(input.lastFrame)
    || text(input.last_frame_image) || text(input.lastFrameImage) || undefined;
  let imageUrl = rawImageUrl;
  let lastFrameImageUrl = rawLastFrame;
  if (rawImageUrl) {
    try {
      imageUrl = await resolveAutoMediaReferenceImage({
        workspaceRoot,
        imageUrl: rawImageUrl,
        attachmentRoots: deps.attachmentRoots
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, output: message };
    }
  }
  if (rawLastFrame) {
    try {
      lastFrameImageUrl = await resolveAutoMediaReferenceImage({
        workspaceRoot,
        imageUrl: rawLastFrame,
        attachmentRoots: deps.attachmentRoots
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, output: message };
    }
  }
  const width = Number(input.width);
  const height = Number(input.height);
  const sizeFromDims = Number.isFinite(width) && width >= 16 && Number.isFinite(height) && height >= 16
    ? `${Math.round(width)}x${Math.round(height)}`
    : "";
  const size = text(input.size) || sizeFromDims || undefined;
  try {
    const result = await runAutoMediaTool({
      gatewayBaseUrl: baseUrl,
      bearerToken,
      toolName,
      prompt,
      model: text(input.model) || undefined,
      imageUrl,
      lastFrameImageUrl,
      style: text(input.style) || undefined,
      duration: typeof input.duration === "number" ? input.duration : Number(input.duration) || undefined,
      size,
      wait: false,
      pollIntervalMs: DEFAULT_AUTO_MEDIA_POLL_INTERVAL_MS,
      signal: deps.resolveAbortSignal?.(),
      requestId,
      workspaceId: deps.workspaceId,
      threadId: deps.threadId,
      fetchImpl: deps.fetchImpl,
      onProgress: (job) => {
        deps.onProgress?.(`任务 ${job.id} · ${formatGenerationJobProgress(job.progress, job.state)}`);
      }
    });
    const mediaJobId = text(result.job.id);
    if (mediaJobId) deps.onJobId?.(mediaJobId);
    const remoteUrls = extractMediaUrlsFromResult(result.job.resultJson);
    const localPaths: string[] = [];
    for (let index = 0; index < remoteUrls.length; index += 1) {
      const url = remoteUrls[index]!;
      try {
        const saved = await downloadGeneratedMediaToWorkspace({
          workspaceRoot,
          kind,
          url,
          fetchImpl: deps.fetchImpl,
          index
        });
        localPaths.push(saved.relativePath);
        try {
          await persistGeneratedMediaToProject(deps, {
            toolName,
            relativePath: saved.relativePath,
            workspaceRoot,
            jobId: mediaJobId
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          deps.onProgress?.(`登记到项目资源失败：${detail}`);
        }
        if (kind === "image" || kind === "video") {
          try {
            await deps.openLocalMedia?.({ kind, relativePath: saved.relativePath });
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            deps.onProgress?.(`本地预览打开失败：${saved.relativePath} · ${detail}`);
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        deps.onProgress?.(`本地下载失败：${basename(url)} · ${detail}`);
      }
    }
    return {
      ok: localPaths.length > 0 || remoteUrls.length === 0,
      output: buildToolOutput({
        toolName,
        reply: result.reply,
        job: result.job,
        localPaths,
        remoteUrls
      })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

/**
 * Registers spring-app Auto media tools on the agent runtime.
 *
 * @param runtime Agent tool runtime that supports registerExternalTool
 * @param deps Gateway resolver, workspace root, and turn correlation ids
 */
export function registerAutoMediaAgentTools(
  runtime: ToolRuntime,
  deps: AutoMediaAgentToolDependencies
) {
  runtime.unregisterExternalTools("auto-media");

  const imageSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        description: "图片生成提示词（中文或英文均可）"
      },
      model: {
        type: "string",
        description: "可选；留空则由 spring-app 选择可用生图模型"
      },
      image_url: {
        type: "string",
        description:
          "可选参考图：https/data URL、工作区相对路径，或聊天附件本地绝对路径（composer 附件目录亦可）"
      }
    },
    required: ["prompt"],
    additionalProperties: false
  };

  const videoSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        description: "视频生成提示词"
      },
      model: {
        type: "string",
        description: "可选；留空则由 spring-app 选择可用视频模型"
      },
      image_url: {
        type: "string",
        description:
          "可选首帧/参考图：https/data URL、工作区相对路径，或聊天附件本地绝对路径（图生视频；MiniMax H3 role=first_frame）"
      },
      first_frame: {
        type: "string",
        description: "可选首帧图 URL（image_url 别名）"
      },
      last_frame: {
        type: "string",
        description: "可选尾帧图 URL（MiniMax H3 role=last_frame）"
      },
      size: {
        type: "string",
        description: "输出分辨率，如 1920x1080 / 1080x1920；视频场景应使用工程画幅适配器设置"
      },
      width: {
        type: "integer",
        minimum: 16,
        description: "可选宽度；与 height 一起可合成 size"
      },
      height: {
        type: "integer",
        minimum: 16,
        description: "可选高度；与 width 一起可合成 size"
      },
      aspect: {
        type: "string",
        description: "可选画幅比，如 16:9 / 9:16 / 1:1 / 4:3"
      }
    },
    required: ["prompt"],
    additionalProperties: false
  };

  runtime.registerExternalTool({
    name: "image_generate",
    title: "生成图片",
    description:
      "当用户明确要求创作/生成图片、壁纸、海报、插画时必须调用本工具，并等待工具返回后再回复。"
      + " 能力询问（能不能/会不会生成图片）不要调用。"
      + " 工具会在 spring-app 出图、下载到工作区 `.newbrain/generated-media/image/`，并尝试打开侧栏预览。"
      + " 图生图时 image_url 可直接传聊天附件本地路径（无需先复制进工作区）。"
      + " 禁止只写「正在生成中」或 `![正在生成中...]` 后结束；禁止伪造本地图片。",
    namespace: "auto-media",
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: imageSchema
  }, async (input) => executeAutoMediaTool(deps, "image_generate", input));

  runtime.registerExternalTool({
    name: "video_generate",
    title: "生成视频",
    description:
      "当用户明确要求创作/生成视频或动画时必须调用本工具，并等待工具返回后再回复。"
      + " 能力询问不要调用。工具会下载到 `.newbrain/generated-media/video/` 并尝试打开侧栏预览。"
      + " 若当前是视频工程，必须传入工程画幅适配器的 size（如 1920x1080）或 width/height，使生成尺寸与预览窗口一致。"
      + " 禁止写「正在生成中」占位后结束。",
    namespace: "auto-media",
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: videoSchema
  }, async (input) => executeAutoMediaTool(deps, "video_generate", input));

  const musicSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        description: "歌曲/音乐生成提示词，可含歌词、风格、情绪"
      },
      model: {
        type: "string",
        description: "可选；留空则由 spring-app 选择可用音乐模型"
      },
      style: {
        type: "string",
        description: "可选曲风或氛围，如 anime pop / 古风 / lo-fi"
      },
      duration: {
        type: "number",
        description: "可选目标时长（秒）"
      }
    },
    required: ["prompt"],
    additionalProperties: false
  };

  runtime.registerExternalTool({
    name: "music_generate",
    title: "生成音乐",
    description:
      "当用户明确要求创作/生成歌曲、配乐、纯音乐或把歌词变成可听音频时必须调用本工具，并等待工具返回后再回复。"
      + " 能力询问（能不能/会不会生成音乐）不要调用。"
      + " 工具会在 spring-app 生成音乐、下载到工作区 `.newbrain/generated-media/music/`。"
      + " 禁止只写「正在生成中」或建议用户去 Suno/Udio 后结束；禁止伪造本地音频路径。",
    namespace: "auto-media",
    kind: "write",
    risk: "medium",
    requiresApproval: false,
    inputSchema: musicSchema
  }, async (input) => executeAutoMediaTool(deps, "music_generate", input));
}
