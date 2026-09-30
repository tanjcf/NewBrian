import assert from "node:assert/strict";
import test from "node:test";
import {
  formatComposerAttachmentToken,
  insertComposerAttachmentToken,
  insertComposerAttachmentTokens,
  removeComposerAttachmentToken
} from "./composer-attachment-insert.ts";

test("formats attachment tokens like Cursor @refs", () => {
  assert.equal(formatComposerAttachmentToken("开题计划书.docx"), "@开题计划书.docx");
  assert.equal(formatComposerAttachmentToken("  a\nb  "), "@a b");
  assert.equal(formatComposerAttachmentToken(""), "@附件");
});

test("inserts the token at the caret with spacing", () => {
  const mid = insertComposerAttachmentToken("请根据写提纲", 3, "开题计划书.docx");
  assert.equal(mid.next, "请根据 @开题计划书.docx 写提纲");
  assert.equal(mid.cursor, "请根据 @开题计划书.docx ".length);

  const empty = insertComposerAttachmentToken("", 0, "a.pdf");
  assert.equal(empty.next, "@a.pdf ");
  assert.equal(empty.cursor, "@a.pdf ".length);

  const end = insertComposerAttachmentToken("开头", 2, "b.docx");
  assert.equal(end.next, "开头 @b.docx ");
});

test("inserts multiple tokens in caret order", () => {
  const result = insertComposerAttachmentTokens("写报告", 0, ["提纲.docx", "初稿.docx"]);
  assert.equal(result.next, "@提纲.docx @初稿.docx 写报告");
});

test("removes the first matching token without wrecking neighbors", () => {
  assert.equal(
    removeComposerAttachmentToken("请看 @开题计划书.docx 然后继续", "开题计划书.docx"),
    "请看 然后继续"
  );
  assert.equal(removeComposerAttachmentToken("@a.pdf ", "a.pdf"), "");
  assert.equal(removeComposerAttachmentToken("无附件", "missing.docx"), "无附件");
});
