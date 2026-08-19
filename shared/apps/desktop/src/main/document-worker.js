import { createInterface } from "node:readline";
import { realpath, stat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, extname } from "node:path";

const VERSION = "2";
const MAX_DEFAULT_BYTES = 5 * 1024 * 1024;
const formats = new Map([[".txt", "txt"], [".md", "markdown"], [".markdown", "markdown"], [".docx", "docx"], [".pdf", "pdf"], [".pptx", "pptx"], [".xlsx", "xlsx"], [".png", "image"], [".jpg", "image"], [".jpeg", "image"], [".gif", "image"], [".webp", "image"]]);
const output = process.stdout;

function response(requestId, values) {
  output.write(`${JSON.stringify({ protocol_version: VERSION, request_id: requestId, ...values })}\n`);
}

async function ingest(request) {
  const requestId = String(request.request_id || "");
  try {
    if (request.protocol_version !== VERSION || !requestId) throw new Error("DOCUMENT_WORKER_BAD_REQUEST");
    const root = await realpath(String(request.project_root || ""));
    const relativePath = String(request.relative_path || "");
    if (!relativePath || isAbsolute(relativePath)) throw new Error("DOCUMENT_WORKER_PATH_FORBIDDEN");
    const target = resolve(root, relativePath);
    const resolvedTarget = await realpath(target);
    const escaped = relative(root, resolvedTarget);
    if (escaped.startsWith("..") || isAbsolute(escaped)) throw new Error("DOCUMENT_WORKER_PATH_FORBIDDEN");
    const format = formats.get(extname(resolvedTarget).toLowerCase());
    if (!format) throw new Error("DOCUMENT_WORKER_FORMAT_UNSUPPORTED");
    const fileStat = await stat(resolvedTarget);
    const maxBytes = Math.min(Math.max(Number(request.max_bytes) || MAX_DEFAULT_BYTES, 1), 20 * 1024 * 1024);
    if (!fileStat.isFile() || fileStat.size > maxBytes) throw new Error("DOCUMENT_WORKER_FILE_TOO_LARGE");
    const extracted = await extractDocument(resolvedTarget, format);
    response(requestId, { status: "completed", error_code: "", format, ...extracted });
  } catch (error) {
    response(requestId, { status: "failed", error_code: error instanceof Error ? error.message : "DOCUMENT_WORKER_FAILED" });
  }
}

async function extractDocument(filePath, format) {
  if (format === "txt" || format === "markdown") {
    const text = (await readFile(filePath)).toString("utf8");
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    return { text, anchors: lines.map((line, index) => textAnchor(format, line, index + 1)), warnings: [] };
  }
  if (format === "image") return extractImage(await readFile(filePath));
  if (format === "docx") {
    return extractDocx(await readFile(filePath));
  }
  if (format === "pdf") {
    const pdfModule = await import("pdf-parse");
    const PDFParse = pdfModule.PDFParse ?? pdfModule.default?.PDFParse;
    if (!PDFParse) throw new Error("DOCUMENT_WORKER_PDF_PARSER_UNAVAILABLE");
    const parser = new PDFParse({ data: await readFile(filePath), disableFontFace: true, useSystemFonts: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false });
    try {
      const result = await parser.getText();
      const anchors = result.pages.map((page) => ({
        anchorId: `pdf:page:${page.num}`,
        objectId: `pdf:page:${page.num}`,
        format: "pdf",
        locator: { kind: "pdf-text", page: page.num, textRange: { start: 0, end: page.text.length } },
        page: page.num,
        rect: { x: 0, y: 0, width: 595, height: 842 },
        transform: { coordinateSpace: "pdf-points", basisWidth: 595, basisHeight: 842, scale: 1 },
        selectedText: page.text
      }));
      return { text: result.text, anchors, warnings: ["PDF text coordinates use a page basis until the renderer supplies exact selection rectangles."] };
    } finally { await parser.destroy(); }
  }
  if (format === "pptx") {
    return extractPptx(await readFile(filePath));
  }
  if (format === "xlsx") {
    const excelModule = await import("exceljs");
    const ExcelJS = excelModule.default ?? excelModule;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const chunks = [];
    const anchors = [];
    for (const sheet of workbook.worksheets.slice(0, 5)) {
      const rows = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(values.map((value) => String(value ?? "")).join("\t"));
        row.eachCell({ includeEmpty: false }, (cell) => {
          const range = cell.address;
          const value = typeof cell.value === "object" && cell.value && "result" in cell.value ? cell.value.result : cell.value;
          const formula = typeof cell.value === "object" && cell.value && "formula" in cell.value ? String(cell.value.formula) : undefined;
          anchors.push({
            anchorId: `xlsx:${sheet.name}:${range}`,
            objectId: `xlsx:${sheet.name}:${range}`,
            format: "xlsx",
            locator: { kind: "xlsx-range", sheet: sheet.name, range, ...(formula ? { formula } : {}) },
            sheet: sheet.name,
            range,
            selectedText: String(value ?? "")
          });
        });
      });
      chunks.push([`Sheet: ${sheet.name}`, ...rows].join("\n"));
    }
    return { text: chunks.join("\n\n"), anchors, warnings: workbook.worksheets.length > 5 ? ["Only the first five worksheets were extracted."] : [] };
  }
  throw new Error("DOCUMENT_WORKER_FORMAT_UNSUPPORTED");
}

function textAnchor(format, line, lineNumber) {
  const objectId = `${format}:line:${lineNumber}`;
  return { anchorId: objectId, objectId, format, locator: { kind: "text-range", startLine: lineNumber, endLine: lineNumber, startCharacter: 0, endCharacter: line.length }, selectedText: line };
}

async function extractDocx(data) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("DOCUMENT_WORKER_DOCX_INVALID");
  const anchors = [];
  const text = [];
  let paragraphIndex = 0;
  for (const match of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const paragraph = [...match[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((item) => decodeXml(item[1])).join("");
    const objectId = `docx:p:${paragraphIndex}`;
    anchors.push({ anchorId: objectId, objectId, format: "docx", locator: { kind: "docx-object", objectType: "paragraph", paragraphIndex, textRange: { start: 0, end: paragraph.length } }, selectedText: paragraph });
    text.push(paragraph);
    paragraphIndex += 1;
  }
  return { text: text.join("\n"), anchors, warnings: [] };
}

async function extractPptx(data) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const anchors = [];
  const text = [];
  for (let slideIndex = 0; slideIndex < slideNames.length; slideIndex += 1) {
    const xml = await zip.file(slideNames[slideIndex])?.async("string") ?? "";
    const shapePattern = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    let zIndex = 0;
    for (const shape of xml.matchAll(shapePattern)) {
      const id = /<p:cNvPr\b[^>]*\bid="([^"]+)"/.exec(shape[0])?.[1] ?? String(zIndex + 1);
      const shapeText = [...shape[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((item) => decodeXml(item[1])).join(" ").trim();
      const offset = /<a:off\b[^>]*\bx="(\d+)"[^>]*\by="(\d+)"/.exec(shape[0]);
      const extent = /<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(shape[0]);
      const page = slideIndex + 1;
      const objectId = `pptx:s:${page}:shape:${id}`;
      anchors.push({ anchorId: objectId, objectId, format: "pptx", locator: { kind: "pptx-shape", slide: page, shapeId: id, zIndex, textRange: { start: 0, end: shapeText.length } }, page, rect: { x: Number(offset?.[1] ?? 0), y: Number(offset?.[2] ?? 0), width: Number(extent?.[1] ?? 0), height: Number(extent?.[2] ?? 0) }, transform: { coordinateSpace: "slide-emu", basisWidth: 12192000, basisHeight: 6858000, scale: 1 }, selectedText: shapeText });
      if (shapeText) text.push(`Slide ${page}: ${shapeText}`);
      zIndex += 1;
    }
  }
  return { text: text.join("\n"), anchors, warnings: [] };
}

function extractImage(data) {
  const dimensions = imageDimensions(data);
  if (!dimensions) throw new Error("DOCUMENT_WORKER_IMAGE_INVALID");
  const objectId = "image:region:0";
  return { text: "", anchors: [{ anchorId: objectId, objectId: "image", format: "image", locator: { kind: "image-region", regionIndex: 0 }, rect: { x: 0, y: 0, width: dimensions.width, height: dimensions.height }, transform: { coordinateSpace: "pixels", basisWidth: dimensions.width, basisHeight: dimensions.height, scale: 1 } }], warnings: ["Image OCR is not available; coordinate annotation remains supported."] };
}

function imageDimensions(data) {
  if (data.length >= 24 && data.toString("ascii", 1, 4) === "PNG") return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.length >= 10 && ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))) return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  if (data.length >= 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" && data.toString("ascii", 12, 16) === "VP8X") return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue; }
      const marker = data[offset + 1];
      const size = data.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
      if (size < 2) break;
      offset += 2 + size;
    }
  }
  return null;
}

function decodeXml(value) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

createInterface({ input: process.stdin }).on("line", (line) => {
  try { void ingest(JSON.parse(line)); }
  catch { response("unknown", { status: "failed", error_code: "DOCUMENT_WORKER_BAD_JSON" }); }
});
