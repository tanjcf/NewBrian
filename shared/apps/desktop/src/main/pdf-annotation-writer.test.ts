import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import test from "node:test";
import { addPdfAnnotation, addPdfAnnotationWithMeta } from "./pdf-annotation-writer.ts";
import { resolveDesktopCjkFontPath } from "./pdf-cjk-font.ts";

test("adds a bounded annotation to a PDF page", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const output = await addPdfAnnotation({
    bytes: Buffer.from(await doc.save()),
    page: 1,
    rect: { x: 20, y: 30, width: 100, height: 50 },
    text: "修改"
  });
  const reopened = await PDFDocument.load(output);
  assert.equal(reopened.getPageCount(), 1);
  assert.ok(output.length > 0);
});

test("embeds a system CJK font for Chinese annotation text", async () => {
  const fontPath = await resolveDesktopCjkFontPath();
  assert.ok(fontPath, "A system CJK font must be available for this host verification.");
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  const result = await addPdfAnnotationWithMeta({
    bytes: Buffer.from(await doc.save()),
    page: 1,
    rect: { x: 24, y: 40, width: 180, height: 60 },
    text: "修改标注：扩产公告"
  });
  assert.equal(result.usedCjkFont, true);
  assert.equal(result.renderedText, "修改标注：扩产公告");
  assert.ok(result.fontPath);
  assert.match(result.fontPath, /simhei|Noto|msyh|simsun|PingFang|CJK/i);
  assert.ok(result.bytes.length > 1_000);
});

test("rejects invalid page and rectangle", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = Buffer.from(await doc.save());
  await assert.rejects(
    () => addPdfAnnotation({ bytes, page: 2, rect: { x: 0, y: 0, width: 10, height: 10 }, text: "x" }),
    /BRAIN_PDF_PAGE_NOT_FOUND/
  );
  await assert.rejects(
    () => addPdfAnnotation({ bytes, page: 1, rect: { x: 0, y: 0, width: 0, height: 10 }, text: "x" }),
    /BRAIN_PDF_ANNOTATION_INVALID/
  );
});
