const ATTACHMENT_SIZE_LIMIT_RE = /(?:Attachment|Clipboard attachment) exceeds the (\d+) byte limit/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function stripIpcInvokePrefix(message: string) {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
    .replace(/^Error invoking remote method "[^"]+":\s*(?:Error:\s*)?/i, "")
    .trim();
}

/** Maps composer attachment IPC failures into a stable Chinese user-facing message. */
export function normalizeComposerAttachmentError(error: unknown) {
  const message = stripIpcInvokePrefix(error instanceof Error ? error.message : String(error));
  if (/本地引用上限|本地路径引用/u.test(message)) return message;
  const match = message.match(ATTACHMENT_SIZE_LIMIT_RE);
  if (!match) return message;
  const limit = Number(match[1]);
  const limitMb = Number.isFinite(limit) ? Math.round(limit / (1024 * 1024)) : 0;
  // Prefer the document-copy limit over the "Clipboard attachment" wording: drag-drop of
  // .docx/.pdf uses saveComposerClipboardFile and can hit the 20 MB copy ceiling.
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

/** True when a chat error should render next to the composer (not only at scroll top). */
export function isComposerAttachmentErrorMessage(message: string) {
  const text = String(message || "").trim();
  if (!text) return false;
  return (
    /图片或剪贴板附件不能超过/.test(text)
    || /整文件复制不能超过/.test(text)
    || /附件超过/.test(text)
    || /本地引用上限/.test(text)
    || /已跳过。?图片不超过/.test(text)
    || /超过 \d+ MB 限制/.test(text)
  );
}
