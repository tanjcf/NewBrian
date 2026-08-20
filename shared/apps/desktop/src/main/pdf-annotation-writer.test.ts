import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import test from "node:test";
import { addPdfAnnotation } from "./pdf-annotation-writer.ts";
test("adds a bounded annotation to a PDF page", async () => { const doc = await PDFDocument.create(); doc.addPage([300, 200]); const output = await addPdfAnnotation({ bytes: Buffer.from(await doc.save()), page: 1, rect: { x: 20, y: 30, width: 100, height: 50 }, text: "修改" }); const reopened = await PDFDocument.load(output); assert.equal(reopened.getPageCount(), 1); assert.ok(output.length > 0); });
test("rejects invalid page and rectangle", async () => { const doc = await PDFDocument.create(); doc.addPage(); const bytes = Buffer.from(await doc.save()); await assert.rejects(() => addPdfAnnotation({ bytes, page: 2, rect: { x: 0, y: 0, width: 10, height: 10 }, text: "x" }), /BRAIN_PDF_PAGE_NOT_FOUND/); await assert.rejects(() => addPdfAnnotation({ bytes, page: 1, rect: { x: 0, y: 0, width: 0, height: 10 }, text: "x" }), /BRAIN_PDF_ANNOTATION_INVALID/); });
