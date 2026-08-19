import { createInterface } from "node:readline";
import { realpath, stat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, extname } from "node:path";

const VERSION = "1";
const MAX_DEFAULT_BYTES = 5 * 1024 * 1024;
const formats = new Map([[".txt", "txt"], [".md", "markdown"], [".markdown", "markdown"], [".docx", "docx"], [".pdf", "pdf"], [".xlsx", "xlsx"]]);
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
    const text = await extractText(resolvedTarget, format);
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    const anchors = lines.map((line, index) => ({
      format,
      locator: format === "pdf" ? { page: 1, line: index + 1 } : { line: index + 1 },
      ...(format === "pdf" ? { page: 1 } : {}),
      ...(format === "xlsx" ? { sheet: "Sheet1" } : {}),
      selectedText: line
    }));
    response(requestId, { status: "completed", error_code: "", format, text, anchors, warnings: [] });
  } catch (error) {
    response(requestId, { status: "failed", error_code: error instanceof Error ? error.message : "DOCUMENT_WORKER_FAILED" });
  }
}

async function extractText(filePath, format) {
  if (format === "txt" || format === "markdown") return (await readFile(filePath)).toString("utf8");
  if (format === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.default.extractRawText({ path: filePath })).value;
  }
  if (format === "pdf") {
    const pdfModule = await import("pdf-parse");
    const PDFParse = pdfModule.PDFParse ?? pdfModule.default?.PDFParse;
    if (!PDFParse) throw new Error("DOCUMENT_WORKER_PDF_PARSER_UNAVAILABLE");
    const parser = new PDFParse({ data: await readFile(filePath), disableFontFace: true, useSystemFonts: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false });
    try { return (await parser.getText()).text; } finally { await parser.destroy(); }
  }
  if (format === "xlsx") {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const chunks = [];
    for (const sheet of workbook.worksheets.slice(0, 5)) {
      const rows = [];
      sheet.eachRow({ includeEmpty: false }, (row) => rows.push((Array.isArray(row.values) ? row.values.slice(1) : []).map((value) => String(value ?? "")).join("\t")));
      chunks.push([`Sheet: ${sheet.name}`, ...rows].join("\n"));
    }
    return chunks.join("\n\n");
  }
  throw new Error("DOCUMENT_WORKER_FORMAT_UNSUPPORTED");
}

createInterface({ input: process.stdin }).on("line", (line) => {
  try { void ingest(JSON.parse(line)); }
  catch { response("unknown", { status: "failed", error_code: "DOCUMENT_WORKER_BAD_JSON" }); }
});
