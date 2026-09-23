import assert from "node:assert/strict";
import test from "node:test";

const { normalizeComposerAttachmentError } = await import(
  new URL("./composer-attachment-errors.ts", import.meta.url).href
) as typeof import("./composer-attachment-errors.js");

test("maps attachment and clipboard size-limit IPC errors to Chinese guidance", () => {
  assert.match(
    normalizeComposerAttachmentError(
      new Error("Error invoking remote method 'phase1:select-composer-images': Error: Attachment exceeds the 20971520 byte limit.")
    ),
    /整文件复制不能超过 20 MB/
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

test("preserves local-link guidance and unrelated errors", () => {
  assert.match(
    normalizeComposerAttachmentError(new Error("文件「huge.pdf」超过 512 MB 本地引用上限，请挂载工作区、拆分文件或改用数据场景")),
    /本地引用上限/
  );
  assert.equal(
    normalizeComposerAttachmentError(new Error("Attachment source is not a file.")),
    "Attachment source is not a file."
  );
});
