import assert from "node:assert/strict";
import test from "node:test";
const {
  parseOpenComposerAttachmentInput,
  parseSaveComposerClipboardFileInput
} = await import(new URL("./composer-contract.ts", import.meta.url).href);

test("normalizes valid composer attachment inputs", () => {
  assert.deepEqual(parseOpenComposerAttachmentInput({ path: "  C:\\tmp\\image.png  " }), {
    path: "C:\\tmp\\image.png"
  });
  const data = new ArrayBuffer(16);
  assert.deepEqual(parseSaveComposerClipboardFileInput({ name: "image.png", mimeType: "image/png", data }), {
    name: "image.png",
    mimeType: "image/png",
    data
  });
});

test("rejects malformed and oversized composer inputs", () => {
  assert.throws(() => parseOpenComposerAttachmentInput({ path: " " }), /required/);
  assert.throws(() => parseSaveComposerClipboardFileInput({ name: "x", mimeType: "image/png", data: "bytes" }), /ArrayBuffer/);
  assert.throws(() => parseSaveComposerClipboardFileInput({
    name: "x",
    mimeType: "image/png",
    data: new ArrayBuffer(25 * 1024 * 1024)
  }), /exceeds/i);
});
