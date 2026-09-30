import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { ComposerAttachment, SaveComposerClipboardFileInput } from "@codex-forge/protocol";
import {
  formatAttachmentLocalLinkMessage,
  formatAttachmentOversizeMessage,
  formatAttachmentTooLargeForLocalLinkMessage,
  isAttachmentSizeLimitError,
  isAttachmentTooLargeForLocalLink,
  isImageAttachmentExtension,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES,
  shouldLocalLinkAttachment
} from "./attachment-security.ts";

export const ATTACHMENT_PROTOCOL_HOST = "media";
export const LOCAL_FILE_PROTOCOL_HOST = "local-file";

export interface ComposerAttachmentSkip {
  name: string;
  reason: string;
}

export interface ComposerAttachmentSelectionResult {
  attachments: ComposerAttachment[];
  skipped: ComposerAttachmentSkip[];
  detail: string;
  linked?: Array<{ name: string; reason: string }>;
}

function formatSelectionDetail(
  skipped: ComposerAttachmentSkip[],
  linked: Array<{ name: string; reason: string }>,
  acceptedCopiedCount: number
) {
  if (skipped.length === 0 && linked.length === 0) return "";
  const parts: string[] = [];
  if (acceptedCopiedCount > 0) parts.push(`已添加 ${acceptedCopiedCount} 个附件`);
  if (linked.length > 0) parts.push(linked.map((item) => item.reason).join("；"));
  if (skipped.length > 0) {
    const details = skipped.map((item) => item.reason).join("；");
    parts.push(`${details}，已跳过`);
  }
  if (skipped.length > 0 && acceptedCopiedCount + linked.length === 0) {
    return `${parts.join("；")}。图片不超过 ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB，其他文件复制不超过 ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB（更大文档可本地路径引用）。`;
  }
  return `${parts.join("；")}。`;
}

/** Builds a stable custom-protocol URL that Chromium will not rewrite as a hostname-only URL. */
export function buildManagedAttachmentUrl(filePath: string) {
  return `newbrain-attachment://${ATTACHMENT_PROTOCOL_HOST}/${encodeURIComponent(basename(filePath))}`;
}

export function buildLocalFileAttachmentUrl(filePath: string) {
  return `newbrain-local-file://${LOCAL_FILE_PROTOCOL_HOST}/${encodeURIComponent(resolve(filePath))}`;
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
  private readonly allowedLocalPaths = new Set<string>();

  constructor(dependencies: ComposerAttachmentServiceDependencies) {
    this.dependencies = dependencies;
  }

  async select(): Promise<ComposerAttachmentSelectionResult> {
    const paths = (await this.dependencies.selectFiles()).slice(0, 5);
    const attachments: ComposerAttachment[] = [];
    const skipped: ComposerAttachmentSkip[] = [];
    const linked: Array<{ name: string; reason: string }> = [];
    let copiedCount = 0;
    for (const sourcePath of paths) {
      const originalName = basename(sourcePath);
      try {
        const attachment = await this.store(sourcePath, originalName);
        attachments.push(attachment);
        if (attachment.linkMode === "local") {
          linked.push({
            name: originalName,
            reason: formatAttachmentLocalLinkMessage(originalName, attachment.sizeBytes || 0)
          });
        } else {
          copiedCount += 1;
        }
      } catch (error) {
        if (!isAttachmentSizeLimitError(error) && !(error instanceof Error && /本地引用上限|超过 .* MB/.test(error.message))) {
          throw error;
        }
        const extension = extname(originalName || sourcePath);
        skipped.push({
          name: originalName,
          reason: error instanceof Error && /本地引用上限/.test(error.message)
            ? error.message
            : formatAttachmentOversizeMessage(originalName, extension)
        });
      }
    }
    return {
      attachments,
      skipped,
      linked,
      detail: formatSelectionDetail(skipped, linked, copiedCount)
    };
  }

  async store(sourcePath: string, originalName: string): Promise<ComposerAttachment> {
    const resolvedSource = resolve(sourcePath);
    const sourceStat = await this.dependencies.statFile(resolvedSource);
    if (!sourceStat.isFile()) throw new Error("Attachment source is not a file.");
    const extension = extname(originalName || resolvedSource);
    const displayName = originalName || basename(resolvedSource);

    if (shouldLocalLinkAttachment(extension, sourceStat.size)) {
      this.allowedLocalPaths.add(resolvedSource);
      return {
        name: displayName,
        path: resolvedSource,
        url: buildLocalFileAttachmentUrl(resolvedSource),
        sourcePath: resolvedSource,
        linkMode: "local",
        sizeBytes: sourceStat.size
      };
    }

    if (isAttachmentTooLargeForLocalLink(extension, sourceStat.size)) {
      if (isImageAttachmentExtension(extension)) {
        this.dependencies.assertSize(extension, sourceStat.size);
      }
      throw new Error(formatAttachmentTooLargeForLocalLinkMessage(displayName));
    }

    this.dependencies.assertSize(extension, sourceStat.size);
    await this.dependencies.ensureDirectory(this.dependencies.attachmentRoot);
    const safeExtension = extension.replace(/[^a-z0-9.]/gi, "");
    const filePath = join(
      this.dependencies.attachmentRoot,
      `${this.dependencies.nowMs()}-${this.dependencies.makeId()}${safeExtension}`
    );
    await this.dependencies.copyFile(resolvedSource, filePath);
    return {
      name: displayName,
      path: filePath,
      url: await this.previewUrl(filePath),
      sourcePath: resolvedSource,
      linkMode: "copied",
      sizeBytes: sourceStat.size
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
      url: await this.previewUrl(filePath, input.mimeType),
      linkMode: "copied",
      sizeBytes: input.data.byteLength
    };
  }

  async open(input: { path: string }) {
    const attachmentRoot = resolve(this.dependencies.attachmentRoot);
    const targetPath = resolve(input.path);
    const relativePath = relative(attachmentRoot, targetPath);
    const inManagedRoot = Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
    const allowedLocal = this.allowedLocalPaths.has(targetPath);
    if (!inManagedRoot && !allowedLocal) {
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
