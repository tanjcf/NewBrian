import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { ComposerAttachment, SaveComposerClipboardFileInput } from "@codex-forge/protocol";

export const ATTACHMENT_PROTOCOL_HOST = "media";

export interface ComposerAttachmentSkip {
  name: string;
  reason: string;
}

export interface ComposerAttachmentSelectionResult {
  attachments: ComposerAttachment[];
  skipped: ComposerAttachmentSkip[];
  detail: string;
}

const ATTACHMENT_SIZE_LIMIT_RE = /exceeds the (\d+) byte limit/i;
const IMAGE_EXTENSION_RE = /^\.(png|jpe?g|webp|gif|bmp|svg)$/i;

function isAttachmentSizeLimitError(error: unknown): error is Error {
  return error instanceof Error && ATTACHMENT_SIZE_LIMIT_RE.test(error.message);
}

function formatSkippedAttachmentReason(fileName: string, extension: string, error: Error) {
  const matchedLimit = Number(error.message.match(ATTACHMENT_SIZE_LIMIT_RE)?.[1] || 0);
  const fallbackMb = IMAGE_EXTENSION_RE.test(extension) ? 10 : 20;
  const limitMb = Number.isFinite(matchedLimit) && matchedLimit > 0
    ? Math.round(matchedLimit / (1024 * 1024))
    : fallbackMb;
  const kind = IMAGE_EXTENSION_RE.test(extension) ? "图片" : "文件";
  const safeName = String(fileName || "未命名").trim() || "未命名";
  return `${kind}「${safeName}」超过 ${limitMb} MB 限制`;
}

function formatSelectionDetail(
  skipped: Array<{ name: string; reason: string }>,
  acceptedCount: number
) {
  if (skipped.length === 0) return "";
  const details = skipped.map((item) => item.reason).join("；");
  if (acceptedCount > 0) {
    return `已添加 ${acceptedCount} 个附件；${details}，已跳过。`;
  }
  return `${details}，已跳过。图片不超过 10 MB，其他文件不超过 20 MB。`;
}

/** Builds a stable custom-protocol URL that Chromium will not rewrite as a hostname-only URL. */
export function buildManagedAttachmentUrl(filePath: string) {
  return `newbrain-attachment://${ATTACHMENT_PROTOCOL_HOST}/${encodeURIComponent(basename(filePath))}`;
}

/**
 * Chromium may rewrite `newbrain-attachment:///file.png` into `newbrain-attachment://file.png/`.
 * Accept both the stable host form and legacy triple-slash / hostname-as-filename forms.
 */
export function resolveManagedAttachmentFileName(requestUrl: string) {
  const parsed = new URL(requestUrl);
  const host = decodeURIComponent(parsed.hostname || "").replace(/^\/+|\/+$/g, "");
  const pathName = decodeURIComponent(parsed.pathname || "").replace(/^\/+|\/+$/g, "");
  if (host && host !== ATTACHMENT_PROTOCOL_HOST) {
    return pathName ? `${host}/${pathName}` : host;
  }
  return pathName;
}

export function resolveManagedAttachmentPath(requestUrl: string, attachmentRoot: string) {
  const fileName = resolveManagedAttachmentFileName(requestUrl);
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return null;
  }
  const root = resolve(attachmentRoot);
  const filePath = resolve(root, fileName);
  const relativePath = relative(root, filePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return filePath;
}

export interface ComposerAttachmentServiceDependencies {
  attachmentRoot: string;
  selectFiles: () => Promise<string[]>;
  statFile: (path: string) => Promise<{ isFile: () => boolean; size: number }>;
  ensureDirectory: (path: string) => Promise<unknown>;
  copyFile: (source: string, target: string) => Promise<unknown>;
  writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
  readFile: (path: string) => Promise<Uint8Array>;
  openPath: (path: string) => Promise<string>;
  assertSize: (extension: string, size: number) => void;
  getImageMimeType: (extension: string) => string;
  nowMs: () => number;
  makeId: () => string;
}

/** Owns managed attachment ingestion, opening, clipboard persistence, and preview URLs. */
export class ComposerAttachmentService {
  private readonly dependencies: ComposerAttachmentServiceDependencies;

  constructor(dependencies: ComposerAttachmentServiceDependencies) {
    this.dependencies = dependencies;
  }

  async select(): Promise<ComposerAttachmentSelectionResult> {
    const paths = (await this.dependencies.selectFiles()).slice(0, 5);
    const attachments: ComposerAttachment[] = [];
    const skipped: ComposerAttachmentSkip[] = [];
    for (const sourcePath of paths) {
      const originalName = basename(sourcePath);
      try {
        attachments.push(await this.store(sourcePath, originalName));
      } catch (error) {
        if (!isAttachmentSizeLimitError(error)) throw error;
        const extension = extname(originalName || sourcePath);
        skipped.push({
          name: originalName,
          reason: formatSkippedAttachmentReason(originalName, extension, error)
        });
      }
    }
    return {
      attachments,
      skipped,
      detail: formatSelectionDetail(skipped, attachments.length)
    };
  }

  async store(sourcePath: string, originalName: string): Promise<ComposerAttachment> {
    const sourceStat = await this.dependencies.statFile(sourcePath);
    if (!sourceStat.isFile()) throw new Error("Attachment source is not a file.");
    this.dependencies.assertSize(extname(originalName || sourcePath), sourceStat.size);
    await this.dependencies.ensureDirectory(this.dependencies.attachmentRoot);
    const safeExtension = extname(originalName).replace(/[^a-z0-9.]/gi, "");
    const filePath = join(
      this.dependencies.attachmentRoot,
      `${this.dependencies.nowMs()}-${this.dependencies.makeId()}${safeExtension}`
    );
    await this.dependencies.copyFile(sourcePath, filePath);
    return {
      name: originalName || basename(sourcePath),
      path: filePath,
      url: await this.previewUrl(filePath)
    };
  }

  async saveClipboard(input: SaveComposerClipboardFileInput): Promise<ComposerAttachment> {
    await this.dependencies.ensureDirectory(this.dependencies.attachmentRoot);
    const mimeExtension = input.mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
    const sourceExtension = extname(input.name).replace(/[^a-z0-9.]/gi, "");
    const fileName = `${this.dependencies.nowMs()}-${this.dependencies.makeId()}${sourceExtension || `.${mimeExtension}`}`;
    const filePath = join(this.dependencies.attachmentRoot, fileName);
    await this.dependencies.writeFile(filePath, new Uint8Array(input.data));
    return {
      name: input.name || fileName,
      path: filePath,
      url: await this.previewUrl(filePath, input.mimeType)
    };
  }

  async open(input: { path: string }) {
    const attachmentRoot = resolve(this.dependencies.attachmentRoot);
    const targetPath = resolve(input.path);
    const relativePath = relative(attachmentRoot, targetPath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      return { ok: false, detail: "Attachment is outside the managed attachment directory." };
    }
    const stat = await this.dependencies.statFile(targetPath).catch(() => null);
    if (!stat?.isFile()) return { ok: false, detail: "Attachment file was not found." };
    const detail = await this.dependencies.openPath(targetPath);
    return { ok: detail.length === 0, detail };
  }

  private attachmentUrl(filePath: string) {
    return buildManagedAttachmentUrl(filePath);
  }

  async previewUrl(filePath: string, mimeType = "") {
    const imageMimeType = mimeType.startsWith("image/")
      ? mimeType
      : this.dependencies.getImageMimeType(extname(filePath));
    if (!imageMimeType) return this.attachmentUrl(filePath);
    const bytes = await this.dependencies.readFile(filePath);
    return `data:${imageMimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  }
}
