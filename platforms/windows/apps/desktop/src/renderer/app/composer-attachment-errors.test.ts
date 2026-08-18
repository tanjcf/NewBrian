import assert from "node:assert/strict";
import test from "node:test";

const { normalizeComposerAttachmentError } = await import(
  new URL("./composer-attachment-errors.ts", import.meta.url).href
) as typeof import("./composer-attachment-errors.js");

test("maps attachment and clipboard size-limit IPC errors to Chinese guidance", () => {
  assert.equal(
    normalizeComposerAttachmentError(
      new Error("Error invoking remote method 'phase1:select-composer-images': Error: Attachment exceeds the 20971520 byte limit.")
    ),
    "附件不能超过 20 MB，请压缩或更换较小的文件后再试。"
  );
  assert.equal(
    normalizeComposerAttachmentError(new Error("Attachment exceeds the 10485760 byte limit.")),
    "图片或剪贴板附件不能超过 10 MB，请压缩或更换较小的文件后再试。"
  );
  assert.equal(
    normalizeComposerAttachmentError(new Error("Clipboard attachment exceeds the 10485760 byte limit.")),
    "图片或剪贴板附件不能超过 10 MB，请压缩或更换较小的文件后再试。"
  );
});

test("preserves unrelated composer attachment errors", () => {
  assert.equal(
    normalizeComposerAttachmentError(new Error("Attachment source is not a file.")),
    "Attachment source is not a file."
  );
});
