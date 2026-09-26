export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Absolute ceiling for local-path references (no whole-file copy into managed storage). */
export const MAX_LOCAL_LINK_BYTES = 512 * 1024 * 1024;
export const MAX_EXTRACTOR_OUTPUT_BYTES = 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"]);
const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".bmp": "image/bmp", ".svg": "image/svg+xml"
};

const ATTACHMENT_SIZE_LIMIT_RE = /(?:Attachment|Clipboard attachment) exceeds the (\d+) byte limit/i;

export function isImageAttachmentExtension(extension: string) {
  return IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

export function getAttachmentByteLimit(extension: string) {
  return isImageAttachmentExtension(extension) ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_BYTES;
}

export function assertAttachmentSize(extension: string, size: number) {
  const limit = getAttachmentByteLimit(extension);
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) {
    throw new Error(`Attachment exceeds the ${limit} byte limit.`);
  }
}

export function assertClipboardPayloadSize(data: ArrayBuffer) {
  if (!(data instanceof ArrayBuffer) || data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Clipboard attachment exceeds the ${MAX_IMAGE_BYTES} byte limit.`);
  }
}

export function isAttachmentSizeLimitError(error: unknown) {
  return error instanceof Error && ATTACHMENT_SIZE_LIMIT_RE.test(error.message);
}

/** True when a user-picked non-image file should be referenced in place instead of copied. */
export function shouldLocalLinkAttachment(extension: string, size: number) {
  if (isImageAttachmentExtension(extension)) return false;
  if (!Number.isSafeInteger(size) || size < 0) return false;
  return size > MAX_ATTACHMENT_BYTES && size <= MAX_LOCAL_LINK_BYTES;
}

/** True when the file is too large even for a local-path reference. */
export function isAttachmentTooLargeForLocalLink(extension: string, size: number) {
  if (isImageAttachmentExtension(extension)) {
    return !Number.isSafeInteger(size) || size < 0 || size > MAX_IMAGE_BYTES;
  }
  return !Number.isSafeInteger(size) || size < 0 || size > MAX_LOCAL_LINK_BYTES;
}

/** User-facing Chinese notice when a single attachment is over the size limit. */
export function formatAttachmentOversizeMessage(fileName: string, extension: string) {
  const limitMb = Math.round(getAttachmentByteLimit(extension) / (1024 * 1024));
  const kind = isImageAttachmentExtension(extension) ? "图片" : "文件";
  const safeName = String(fileName || "未命名").trim() || "未命名";
  return `${kind}「${safeName}」超过 ${limitMb} MB 限制`;
}

export function formatAttachmentLocalLinkMessage(fileName: string, sizeBytes: number) {
  const safeName = String(fileName || "未命名").trim() || "未命名";
  const sizeLabel = formatAttachmentSize(sizeBytes);
  return `文件「${safeName}」（${sizeLabel}）已按本地路径引用，不整文件复制；发送时将按需读取`;
}

export function formatAttachmentTooLargeForLocalLinkMessage(fileName: string) {
  const safeName = String(fileName || "未命名").trim() || "未命名";
  const limitMb = Math.round(MAX_LOCAL_LINK_BYTES / (1024 * 1024));
  return `文件「${safeName}」超过 ${limitMb} MB 本地引用上限，请挂载工作区、拆分文件或改用数据场景`;
}

/** Summarize skipped oversized files for composer selection / paste flows. */
export function formatAttachmentSelectionNotice(
  skipped: Array<{ name: string; extension: string }>,
  acceptedCount = 0
) {
  if (skipped.length === 0) return "";
  const details = skipped.map((item) => formatAttachmentOversizeMessage(item.name, item.extension)).join("；");
  if (acceptedCount > 0) {
    return `已添加 ${acceptedCount} 个附件；${details}，已跳过。`;
  }
  return `${details}，已跳过。图片不超过 ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB，其他文件复制不超过 ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB（更大文档可本地路径引用，上限 ${Math.round(MAX_LOCAL_LINK_BYTES / (1024 * 1024))} MB）。`;
}

/** Map IPC / main-process size-limit errors into a stable Chinese message. */
export function formatAttachmentSizeLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(ATTACHMENT_SIZE_LIMIT_RE);
  if (!match) return "";
  const limit = Number(match[1]);
  const limitMb = Number.isFinite(limit) ? Math.round(limit / (1024 * 1024)) : 0;
  // Prefer the document-copy limit: clipboard/drag-drop of non-images can hit 20 MB.
  if (limit === MAX_ATTACHMENT_BYTES) {
    return `整文件复制不能超过 ${limitMb || 20} MB。更大的文档请用「选择文件」添加，将自动改为本地路径引用。`;
  }
  if (limit === MAX_IMAGE_BYTES || /clipboard/i.test(message)) {
    return `图片或剪贴板附件不能超过 ${limitMb || 10} MB，请压缩或更换较小的文件后再试。`;
  }
  return limitMb > 0
    ? `附件超过 ${limitMb} MB 限制，请压缩、拆分或挂载工作区后再试。`
    : "附件超过大小限制，请压缩、拆分或挂载工作区后再试。";
}

export function getImageMimeType(extension: string) {
  return IMAGE_MIME_TYPES[extension.toLowerCase()] ?? "";
}

export function getModelEmbeddableImageMimeType(extension: string) {
  return extension.toLowerCase() === ".svg" ? "" : getImageMimeType(extension);
}

export function truncateAttachmentText(text: string, maxCharacters: number) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxCharacters) return normalized;
  return `${normalized.slice(0, maxCharacters)}\n\n[Attachment text truncated after ${maxCharacters} characters.]`;
}

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
