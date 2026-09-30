import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { validateDocumentAnchor } from "@codex-forge/protocol/document-anchor";
import { DocumentWorkerProcess } from "./document-worker-process.ts";

test("reopens and extracts representative image PDF DOCX PPTX XLSX and text fixtures", async () => {
  const root = await mkdtemp(join(tmpdir(), "brain-document-formats-"));
  const worker = new DocumentWorkerProcess({
    appDirectory: process.cwd(),
    workerSourcePath: fileURLToPath(new URL("./document-worker.js", import.meta.url))
  });
  try {
    await createFixtures(root);
    const expected = [
      ["pixel.png", "image", "image-region", ""],
      ["notice.pdf", "pdf", "pdf-text", "PDF fixture"],
      ["report.docx", "docx", "docx-object", "DOCX fixture"],
      ["deck.pptx", "pptx", "pptx-shape", "PPTX fixture"],
      ["model.xlsx", "xlsx", "xlsx-range", "Revenue"],
      ["notes.md", "markdown", "text-range", "Markdown fixture"]
    ] as const;
    for (const [relativePath, format, locatorKind, text] of expected) {
      const result = await worker.ingest({ requestId: `fixture-${format}`, projectRoot: root, relativePath, maxBytes: 2 * 1024 * 1024 });
      const reopened = await worker.ingest({ requestId: `fixture-${format}-reopen`, projectRoot: root, relativePath, maxBytes: 2 * 1024 * 1024 });
      assert.equal(result.format, format);
      assert.ok(result.anchors?.length, `${format} should expose anchors`);
      assert.equal(result.anchors?.[0]?.locator.kind, locatorKind);
      if (format === "markdown") {
        assert.ok(result.anchors?.some((anchor) => anchor.objectId.startsWith("markdown:chunk:")), "markdown should expose section chunk anchors");
      }
      if (format === "pdf") {
        assert.ok(result.anchors?.some((anchor) => anchor.objectId.includes(":chunk:")), "pdf should expose page chunk anchors");
      }
      if (format === "docx") {
        assert.ok(result.anchors?.some((anchor) => anchor.objectId.startsWith("docx:chunk:")), "docx should expose heading chunk anchors");
      }
      if (format === "pptx") {
        assert.ok(result.anchors?.some((anchor) => anchor.objectId.includes(":chunk:")), "pptx should expose slide chunk anchors");
      }
      if (format === "xlsx") {
        assert.ok(result.anchors?.some((anchor) => anchor.objectId.includes(":chunk:")), "xlsx should expose sheet chunk anchors");
        assert.ok(result.anchors?.some((anchor) => Boolean(anchor.chunk)), "xlsx chunk anchors should include chunk metadata");
      }
      if (text) assert.match(result.text ?? "", new RegExp(text));
      for (const anchor of result.anchors ?? []) validateDocumentAnchor(anchor);
      assert.deepEqual(
        reopened.anchors?.map(({ anchorId, objectId }) => ({ anchorId, objectId })),
        result.anchors?.map(({ anchorId, objectId }) => ({ anchorId, objectId })),
        `${format} object identities must remain stable after reopening`
      );
    }

    const Excel = new ExcelJS.Workbook();
    await Excel.xlsx.load(await readFile(join(root, "model.xlsx")));
    assert.equal(Excel.getWorksheet("Model")?.getCell("B2").formula, "B1*2");
    const docx = await JSZip.loadAsync(await readFile(join(root, "report.docx")));
    assert.ok(docx.file("word/document.xml"));
    const pptx = await JSZip.loadAsync(await readFile(join(root, "deck.pptx")));
    assert.ok(pptx.file("ppt/slides/slide1.xml"));
  } finally {
    await worker.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

async function createFixtures(root: string) {
  await writeFile(join(root, "notes.md"), "# Markdown fixture\n正文", "utf8");
  await writeFile(join(root, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  await writeFile(join(root, "notice.pdf"), minimalPdf("PDF fixture"));

  const docx = new JSZip();
  docx.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  docx.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX fixture</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  await writeFile(join(root, "report.docx"), await docx.generateAsync({ type: "nodebuffer" }));

  const pptx = new JSZip();
  pptx.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
  pptx.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
  pptx.file("ppt/presentation.xml", '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
  pptx.file("ppt/_rels/presentation.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
  pptx.file("ppt/slides/slide1.xml", '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="8" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>PPTX fixture</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  await writeFile(join(root, "deck.pptx"), await pptx.generateAsync({ type: "nodebuffer" }));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Model");
  sheet.getCell("A1").value = "Revenue";
  sheet.getCell("B1").value = 100;
  sheet.getCell("B2").value = { formula: "B1*2", result: 200 };
  await workbook.xlsx.writeFile(join(root, "model.xlsx"));
}

function minimalPdf(text: string) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 20 100 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}
