import assert from "node:assert/strict";
import test from "node:test";

const attachmentPolicy = await import(
  new URL("./attachment-security.ts", import.meta.url).href
) as typeof import("./attachment-security.js");
const {
  assertAttachmentSize,
  assertClipboardPayloadSize,
  formatAttachmentOversizeMessage,
  formatAttachmentSelectionNotice,
  formatAttachmentSizeLimitError,
  getAttachmentByteLimit,
  isAttachmentSizeLimitError,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES
} = attachmentPolicy;

test("enforces smaller image and bounded document attachment limits", () => {
  assert.doesNotThrow(() => assertAttachmentSize(".pdf", MAX_ATTACHMENT_BYTES));
  assert.throws(() => assertAttachmentSize(".pdf", MAX_ATTACHMENT_BYTES + 1), /exceeds/);
  assert.doesNotThrow(() => assertAttachmentSize(".png", MAX_IMAGE_BYTES));
  assert.throws(() => assertAttachmentSize(".png", MAX_IMAGE_BYTES + 1), /exceeds/);
  assert.equal(getAttachmentByteLimit(".jpeg"), MAX_IMAGE_BYTES);
  assert.equal(getAttachmentByteLimit(".docx"), MAX_ATTACHMENT_BYTES);
});

test("rejects oversized clipboard payloads at the IPC boundary", () => {
  assert.doesNotThrow(() => assertClipboardPayloadSize(new ArrayBuffer(16)));
  assert.throws(() => assertClipboardPayloadSize(new ArrayBuffer(MAX_IMAGE_BYTES + 1)), /exceeds/);
});

test("uses one image media policy while excluding SVG from model embedding", () => {
  assert.equal(attachmentPolicy.getImageMimeType(".JPEG"), "image/jpeg");
  assert.equal(attachmentPolicy.getImageMimeType(".svg"), "image/svg+xml");
  assert.equal(attachmentPolicy.getModelEmbeddableImageMimeType(".svg"), "");
  assert.equal(attachmentPolicy.getModelEmbeddableImageMimeType(".png"), "image/png");
  assert.equal(attachmentPolicy.getImageMimeType(".txt"), "");
});

test("formats attachment sizes and bounds extracted text", () => {
  assert.equal(attachmentPolicy.formatAttachmentSize(1024), "1.0 KB");
  assert.equal(attachmentPolicy.formatAttachmentSize(1024 * 1024), "1.0 MB");
  assert.equal(attachmentPolicy.truncateAttachmentText(" a\r\nb ", 10), "a\nb");
  assert.match(attachmentPolicy.truncateAttachmentText("abcdef", 3), /^abc\n\n\[Attachment text truncated/);
});

test("maps size-limit errors into Chinese composer notices", () => {
  const oversize = new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit.`);
  assert.equal(isAttachmentSizeLimitError(oversize), true);
  assert.equal(formatAttachmentOversizeMessage("huge.pdf", ".pdf"), "文件「huge.pdf」超过 20 MB 限制");
  assert.equal(formatAttachmentOversizeMessage("photo.png", ".png"), "图片「photo.png」超过 10 MB 限制");
  assert.match(
    formatAttachmentSelectionNotice([{ name: "huge.pdf", extension: ".pdf" }], 0),
    /已跳过.*20 MB/
  );
  assert.match(
    formatAttachmentSelectionNotice([{ name: "photo.png", extension: ".png" }], 2),
    /已添加 2 个附件/
  );
  assert.equal(
    formatAttachmentSizeLimitError(oversize),
    "附件不能超过 20 MB，请压缩或更换较小的文件后再试。"
  );
});
