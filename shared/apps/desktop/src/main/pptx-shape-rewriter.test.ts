import assert from "node:assert/strict";
import JSZip from "jszip";
import test from "node:test";
import { replacePptxShapeText } from "./pptx-shape-rewriter.ts";

async function fixture() { const zip = new JSZip(); zip.file("ppt/slides/slide1.xml", '<p:sld xmlns:p="x" xmlns:a="y"><p:sp><p:nvSpPr><p:cNvPr id="7" name="标题"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>原始标题</a:t></a:r></a:p></p:txBody></p:sp></p:sld>'); return zip.generateAsync({ type: "nodebuffer" }); }
test("replaces text in a PPTX shape", async () => { const output = await replacePptxShapeText({ bytes: await fixture(), slide: 1, shapeId: "7", start: 2, end: 4, replacement: "修改" }); const zip = await JSZip.loadAsync(output); assert.match(await zip.file("ppt/slides/slide1.xml")!.async("string"), /原始修改/); });
test("rejects missing shape and out-of-range text", async () => { const bytes = await fixture(); await assert.rejects(() => replacePptxShapeText({ bytes, slide: 1, shapeId: "9", start: 0, end: 1, replacement: "x" }), /BRAIN_PPTX_SHAPE_NOT_FOUND/); await assert.rejects(() => replacePptxShapeText({ bytes, slide: 1, shapeId: "7", start: 0, end: 99, replacement: "x" }), /BRAIN_PPTX_RANGE_OUTSIDE_SHAPE/); });
