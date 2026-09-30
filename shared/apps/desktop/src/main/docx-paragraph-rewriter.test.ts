import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { replaceDocxParagraph } from "./docx-paragraph-rewriter.ts";

async function fixture() { const zip = new JSZip(); zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>原始文本</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>'); return zip.generateAsync({ type: "nodebuffer" }); }
test("replaces a docx paragraph range and escapes xml", async () => { const output = await replaceDocxParagraph({ bytes: await fixture(), paragraphIndex: 0, start: 2, end: 4, replacement: "<新>" }); const zip = await JSZip.loadAsync(output); const xml = await zip.file("word/document.xml")!.async("string"); assert.match(xml, /原始&lt;新&gt;/); });
test("rejects a docx paragraph range outside text", async () => { const bytes = await fixture(); await assert.rejects(() => replaceDocxParagraph({ bytes, paragraphIndex: 1, start: 0, end: 99, replacement: "x" }), /BRAIN_DOCX_RANGE_OUTSIDE_PARAGRAPH/); });
