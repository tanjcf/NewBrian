import { createInterface } from "node:readline";
import { realpath, stat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, extname } from "node:path";

const VERSION = "2";
const MAX_DEFAULT_BYTES = 5 * 1024 * 1024;
const formats = new Map([[".txt", "txt"], [".md", "markdown"], [".markdown", "markdown"], [".docx", "docx"], [".pdf", "pdf"], [".pptx", "pptx"], [".xlsx", "xlsx"], [".csv", "csv"], [".tsv", "tsv"], [".png", "image"], [".jpg", "image"], [".jpeg", "image"], [".gif", "image"], [".webp", "image"]]);
const XLSX_DATA_CHUNK_ROWS = 20;
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
    const responseFormat = format === "csv" || format === "tsv" ? "xlsx" : format;
    response(requestId, { status: "completed", error_code: "", format: responseFormat, ...extracted });
  } catch (error) {
    response(requestId, { status: "failed", error_code: error instanceof Error ? error.message : "DOCUMENT_WORKER_FAILED" });
  }
}

async function extractDocument(filePath, format) {
  if (format === "txt" || format === "markdown") {
    const text = (await readFile(filePath)).toString("utf8");
    return extractTextDocument(text, format);
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
      const anchors = [];
      for (const page of result.pages) {
        anchors.push(...pdfPageChunkAnchors(page));
      }
      return {
        text: result.text,
        anchors,
        warnings: ["PDF chunk anchors use estimated vertical slices per page until exact text boxes are available."]
      };
    } finally { await parser.destroy(); }
  }
  if (format === "pptx") {
    return extractPptx(await readFile(filePath));
  }
  if (format === "csv" || format === "tsv") {
    const text = (await readFile(filePath)).toString("utf8");
    const sheetName = format === "tsv" ? "TSV" : "CSV";
    const { text: sheetText, anchors, warnings } = extractDelimitedSpreadsheet(text, sheetName, format === "tsv" ? "\t" : ",");
    return { text: sheetText, anchors, warnings };
  }
  if (format === "xlsx") {
    const excelModule = await import("exceljs");
    const ExcelJS = excelModule.default ?? excelModule;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const chunks = [];
    const anchors = [];
    for (const sheet of workbook.worksheets.slice(0, 5)) {
      const extracted = extractWorksheetSheet(sheet);
      anchors.push(...extracted.anchors);
      chunks.push(extracted.text);
    }
    return { text: chunks.join("\n\n"), anchors, warnings: workbook.worksheets.length > 5 ? ["Only the first five worksheets were extracted."] : [] };
  }
  throw new Error("DOCUMENT_WORKER_FORMAT_UNSUPPORTED");
}

function textAnchor(format, line, lineNumber) {
  const objectId = `${format}:line:${lineNumber}`;
  return { anchorId: objectId, objectId, format, locator: { kind: "text-range", startLine: lineNumber, endLine: lineNumber, startCharacter: 0, endCharacter: line.length }, selectedText: line };
}

function extractTextDocument(text, format) {
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const anchors = lines.map((line, index) => textAnchor(format, line, index + 1));
  if (format === "markdown") {
    for (const slice of sliceMarkdownSections(normalized)) {
      anchors.push({
        anchorId: `markdown:chunk:${slice.chunkIndex}`,
        objectId: `markdown:chunk:${slice.chunkIndex}`,
        format: "markdown",
        locator: {
          kind: "text-range",
          startLine: slice.startLine,
          endLine: slice.endLine,
          startCharacter: 0,
          endCharacter: slice.text.length
        },
        selectedText: slice.text,
        chunk: {
          chunkIndex: slice.chunkIndex,
          headingPath: slice.headingPath,
          startOffset: slice.startOffset,
          endOffset: slice.endOffset
        }
      });
    }
  }
  if (format === "txt") {
    for (const slice of sliceTextParagraphs(normalized)) {
      anchors.push({
        anchorId: `txt:chunk:${slice.chunkIndex}`,
        objectId: `txt:chunk:${slice.chunkIndex}`,
        format: "txt",
        locator: {
          kind: "text-range",
          startLine: slice.startLine,
          endLine: slice.endLine,
          startCharacter: 0,
          endCharacter: slice.text.length
        },
        selectedText: slice.text,
        chunk: {
          chunkIndex: slice.chunkIndex,
          headingPath: slice.headingPath,
          startOffset: slice.startOffset,
          endOffset: slice.endOffset
        }
      });
    }
  }
  return { text: normalized, anchors, warnings: [] };
}

function sliceMarkdownSections(content) {
  const lines = content.split("\n");
  const slices = [];
  let headingStack = [];
  let chunkLines = [];
  let chunkStartLine = 1;
  let chunkStartOffset = 0;
  let chunkIndex = 0;
  let textOffset = 0;
  const flush = (endLine) => {
    if (!chunkLines.length) return;
    const sliceText = chunkLines.join("\n");
    slices.push({
      chunkIndex,
      headingPath: headingStack.map((item) => item.title),
      startLine: chunkStartLine,
      endLine,
      text: sliceText,
      startOffset: chunkStartOffset,
      endOffset: textOffset
    });
    chunkIndex += 1;
    chunkLines = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flush(index);
      const level = heading[1].length;
      const title = heading[2].trim();
      headingStack = headingStack.filter((item) => item.level < level);
      headingStack.push({ level, title });
      chunkStartLine = index + 1;
      chunkStartOffset = textOffset;
      chunkLines = [line];
    } else {
      if (!chunkLines.length) {
        chunkStartLine = index + 1;
        chunkStartOffset = textOffset;
      }
      chunkLines.push(line);
    }
    textOffset += line.length + 1;
  }
  flush(lines.length);
  if (!slices.length) {
    slices.push({
      chunkIndex: 0,
      headingPath: [],
      startLine: 1,
      endLine: Math.max(1, lines.length),
      text: content,
      startOffset: 0,
      endOffset: content.length
    });
  }
  return slices;
}

function pdfPageChunkAnchors(page) {
  const basis = { width: 595, height: 842 };
  const blocks = String(page.text || "").split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean);
  if (!blocks.length) {
    return [{
      anchorId: `pdf:p:${page.num}:chunk:0`,
      objectId: `pdf:p:${page.num}:chunk:0`,
      format: "pdf",
      locator: { kind: "pdf-text", page: page.num, textRange: { start: 0, end: 0 } },
      page: page.num,
      rect: { x: 0, y: 0, width: basis.width, height: basis.height },
      transform: { coordinateSpace: "pdf-points", basisWidth: basis.width, basisHeight: basis.height, scale: 1 },
      selectedText: "",
      chunk: { chunkIndex: 0, pageOrSheet: page.num, headingPath: [] }
    }];
  }
  const sliceHeight = basis.height / blocks.length;
  let offset = 0;
  return blocks.map((block, chunkIndex) => {
    const anchor = {
      anchorId: `pdf:p:${page.num}:chunk:${chunkIndex}`,
      objectId: `pdf:p:${page.num}:chunk:${chunkIndex}`,
      format: "pdf",
      locator: { kind: "pdf-text", page: page.num, textRange: { start: offset, end: offset + block.length } },
      page: page.num,
      rect: { x: 0, y: sliceHeight * chunkIndex, width: basis.width, height: sliceHeight },
      transform: { coordinateSpace: "pdf-points", basisWidth: basis.width, basisHeight: basis.height, scale: 1 },
      selectedText: block,
      chunk: {
        chunkIndex,
        pageOrSheet: page.num,
        headingPath: inferHeadingPath(block),
        startOffset: offset,
        endOffset: offset + block.length
      }
    };
    offset += block.length + 2;
    return anchor;
  });
}

function inferHeadingPath(text) {
  const firstLine = String(text || "").split("\n").map((line) => line.trim()).find(Boolean) || "";
  if (/^#{1,6}\s+/.test(firstLine)) return [firstLine.replace(/^#{1,6}\s+/, "").trim()];
  if (firstLine.length <= 80 && /^[A-Z0-9][^.!?]*$/.test(firstLine)) return [firstLine];
  return [];
}

function paragraphHeadingLevel(paragraphXml) {
  const style = /<w:pStyle\b[^>]*\bw:val="([^"]+)"/.exec(paragraphXml)?.[1];
  if (style) {
    const match = /^(?:Heading|heading|标题)(\d+)$/i.exec(style);
    if (match) return Number(match[1]);
  }
  const outline = /<w:outlineLvl\b[^>]*\bw:val="(\d+)"/.exec(paragraphXml)?.[1];
  if (outline !== undefined) return Number(outline) + 1;
  return 0;
}

async function extractDocx(data) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("DOCUMENT_WORKER_DOCX_INVALID");
  const anchors = [];
  const text = [];
  let paragraphIndex = 0;
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const paragraphMeta = paragraphs.map((match) => {
    const paragraphXml = match[0];
    const paragraph = [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((item) => decodeXml(item[1])).join("");
    const meta = { paragraphIndex, paragraph, headingLevel: paragraphHeadingLevel(paragraphXml) };
    paragraphIndex += 1;
    return meta;
  });
  for (const item of paragraphMeta) {
    const objectId = `docx:p:${item.paragraphIndex}`;
    anchors.push({
      anchorId: objectId,
      objectId,
      format: "docx",
      locator: { kind: "docx-object", objectType: "paragraph", paragraphIndex: item.paragraphIndex, textRange: { start: 0, end: item.paragraph.length } },
      selectedText: item.paragraph
    });
    text.push(item.paragraph);
  }
  let headingStack = [];
  let chunkParagraphs = [];
  let chunkIndex = 0;
  let textOffset = 0;
  const flushDocxChunk = (endParagraphIndex) => {
    if (!chunkParagraphs.length) return;
    const chunkText = chunkParagraphs.map((item) => item.paragraph).join("\n");
    const first = chunkParagraphs[0];
    const chunkStartOffset = textOffset - chunkText.length - Math.max(0, chunkParagraphs.length - 1);
    anchors.push({
      anchorId: `docx:chunk:${chunkIndex}`,
      objectId: `docx:chunk:${chunkIndex}`,
      format: "docx",
      locator: {
        kind: "docx-object",
        objectType: "paragraph",
        paragraphIndex: first.paragraphIndex,
        textRange: { start: 0, end: chunkText.length }
      },
      selectedText: chunkText,
      chunk: {
        chunkIndex,
        headingPath: headingStack.map((item) => item.title),
        startOffset: Math.max(0, chunkStartOffset),
        endOffset: textOffset,
        endParagraphIndex
      }
    });
    chunkIndex += 1;
    chunkParagraphs = [];
  };
  for (const item of paragraphMeta) {
    if (item.headingLevel > 0) {
      flushDocxChunk(item.paragraphIndex - 1);
      headingStack = headingStack.filter((entry) => entry.level < item.headingLevel);
      headingStack.push({ level: item.headingLevel, title: item.paragraph.trim() || `Heading ${item.headingLevel}` });
      chunkParagraphs = [item];
    } else {
      if (!chunkParagraphs.length) chunkParagraphs = [item];
      else chunkParagraphs.push(item);
    }
    textOffset += item.paragraph.length + 1;
  }
  flushDocxChunk(paragraphMeta.length ? paragraphMeta[paragraphMeta.length - 1].paragraphIndex : 0);
  if (!anchors.some((anchor) => anchor.chunk)) {
    anchors.push({
      anchorId: "docx:chunk:0",
      objectId: "docx:chunk:0",
      format: "docx",
      locator: { kind: "docx-object", objectType: "paragraph", paragraphIndex: 0, textRange: { start: 0, end: text.join("\n").length } },
      selectedText: text.join("\n"),
      chunk: { chunkIndex: 0, headingPath: [], startOffset: 0, endOffset: text.join("\n").length, endParagraphIndex: Math.max(0, paragraphMeta.length - 1) }
    });
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
    const slideTexts = [];
    for (const shape of xml.matchAll(shapePattern)) {
      const id = /<p:cNvPr\b[^>]*\bid="([^"]+)"/.exec(shape[0])?.[1] ?? String(zIndex + 1);
      const shapeText = [...shape[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((item) => decodeXml(item[1])).join(" ").trim();
      const offset = /<a:off\b[^>]*\bx="(\d+)"[^>]*\by="(\d+)"/.exec(shape[0]);
      const extent = /<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(shape[0]);
      const page = slideIndex + 1;
      const objectId = `pptx:s:${page}:shape:${id}`;
      anchors.push({ anchorId: objectId, objectId, format: "pptx", locator: { kind: "pptx-shape", slide: page, shapeId: id, zIndex, textRange: { start: 0, end: shapeText.length } }, page, rect: { x: Number(offset?.[1] ?? 0), y: Number(offset?.[2] ?? 0), width: Number(extent?.[1] ?? 0), height: Number(extent?.[2] ?? 0) }, transform: { coordinateSpace: "slide-emu", basisWidth: 12192000, basisHeight: 6858000, scale: 1 }, selectedText: shapeText });
      if (shapeText) {
        slideTexts.push(shapeText);
        text.push(`Slide ${page}: ${shapeText}`);
      }
      zIndex += 1;
    }
    const slideText = slideTexts.join("\n");
    anchors.push({
      anchorId: `pptx:s:${slideIndex + 1}:chunk:0`,
      objectId: `pptx:s:${slideIndex + 1}:chunk:0`,
      format: "pptx",
      locator: { kind: "pptx-shape", slide: slideIndex + 1, shapeId: `slide-chunk-0`, zIndex: 0, textRange: { start: 0, end: slideText.length } },
      page: slideIndex + 1,
      rect: { x: 0, y: 0, width: 12192000, height: 6858000 },
      transform: { coordinateSpace: "slide-emu", basisWidth: 12192000, basisHeight: 6858000, scale: 1 },
      selectedText: slideText,
      chunk: { chunkIndex: 0, pageOrSheet: slideIndex + 1, headingPath: slideTexts[0] ? [slideTexts[0]] : [] }
    });
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

function columnLettersToIndex(letters) {
  let value = 0;
  for (const character of letters.toUpperCase()) value = value * 26 + (character.charCodeAt(0) - 64);
  return Math.max(0, value - 1);
}

function columnIndexToLetters(index) {
  let value = Math.max(0, index);
  let letters = "";
  while (value >= 0) {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  }
  return letters || "A";
}

function sheetRangeRect(startCol, startRow, endCol, endRow) {
  return {
    x: startCol,
    y: Math.max(0, startRow - 1),
    width: Math.max(1, endCol - startCol + 1),
    height: Math.max(1, endRow - startRow + 1)
  };
}

function sheetGridTransform(columnCount, rowCount) {
  return {
    coordinateSpace: "sheet-grid",
    basisWidth: Math.max(columnCount, 26),
    basisHeight: Math.max(rowCount, 50),
    scale: 1
  };
}

function xlsxSheetChunkAnchors(sheetName, rows, columnCount) {
  const anchors = [];
  const colCount = Math.max(columnCount, 1);
  const rowCount = Math.max(rows.length, 1);
  const transform = sheetGridTransform(colCount, rowCount);
  if (!rows.length) {
    anchors.push({
      anchorId: `xlsx:${sheetName}:chunk:0`,
      objectId: `xlsx:${sheetName}:chunk:0`,
      format: "xlsx",
      locator: { kind: "xlsx-range", sheet: sheetName, range: "A1:A1" },
      sheet: sheetName,
      range: "A1:A1",
      selectedText: "",
      rect: sheetRangeRect(0, 1, colCount - 1, 1),
      transform,
      chunk: { chunkIndex: 0, pageOrSheet: sheetName, headingPath: [] }
    });
    return anchors;
  }
  const headerRow = rows[0];
  const headerEndCol = columnIndexToLetters(Math.max(colCount - 1, 0));
  anchors.push({
    anchorId: `xlsx:${sheetName}:chunk:header`,
    objectId: `xlsx:${sheetName}:chunk:header`,
    format: "xlsx",
    locator: { kind: "xlsx-range", sheet: sheetName, range: `A${headerRow.rowNumber}:${headerEndCol}${headerRow.rowNumber}` },
    sheet: sheetName,
    range: `A${headerRow.rowNumber}:${headerEndCol}${headerRow.rowNumber}`,
    selectedText: headerRow.text,
    rect: sheetRangeRect(0, headerRow.rowNumber, colCount - 1, headerRow.rowNumber),
    transform,
    chunk: { chunkIndex: 0, pageOrSheet: sheetName, headingPath: [headerRow.text.split("\t")[0] || "Header"] }
  });
  const dataRows = rows.slice(1);
  for (let offset = 0; offset < dataRows.length; offset += XLSX_DATA_CHUNK_ROWS) {
    const batch = dataRows.slice(offset, offset + XLSX_DATA_CHUNK_ROWS);
    const startRow = batch[0].rowNumber;
    const endRow = batch[batch.length - 1].rowNumber;
    const chunkIndex = Math.floor(offset / XLSX_DATA_CHUNK_ROWS) + 1;
    const range = `A${startRow}:${headerEndCol}${endRow}`;
    anchors.push({
      anchorId: `xlsx:${sheetName}:chunk:${chunkIndex}`,
      objectId: `xlsx:${sheetName}:chunk:${chunkIndex}`,
      format: "xlsx",
      locator: { kind: "xlsx-range", sheet: sheetName, range },
      sheet: sheetName,
      range,
      selectedText: batch.map((row) => row.text).join("\n"),
      rect: sheetRangeRect(0, startRow, colCount - 1, endRow),
      transform,
      chunk: { chunkIndex, pageOrSheet: sheetName, headingPath: [sheetName, `Rows ${startRow}-${endRow}`] }
    });
  }
  return anchors;
}

function extractWorksheetSheet(sheet) {
  const rows = [];
  const cellAnchors = [];
  let maxColumns = sheet.columnCount || 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    maxColumns = Math.max(maxColumns, values.length);
    rows.push({ rowNumber: row.number, text: values.map((value) => String(value ?? "")).join("\t"), values });
    row.eachCell({ includeEmpty: false }, (cell) => {
      const range = cell.address;
      const value = typeof cell.value === "object" && cell.value && "result" in cell.value ? cell.value.result : cell.value;
      const formula = typeof cell.value === "object" && cell.value && "formula" in cell.value ? String(cell.value.formula) : undefined;
      const transform = sheetGridTransform(Math.max(sheet.columnCount || 1, maxColumns), Math.max(sheet.rowCount || 1, rows.length));
      cellAnchors.push({
        anchorId: `xlsx:${sheet.name}:${range}`,
        objectId: `xlsx:${sheet.name}:${range}`,
        format: "xlsx",
        locator: { kind: "xlsx-range", sheet: sheet.name, range, ...(formula ? { formula } : {}) },
        sheet: sheet.name,
        range,
        selectedText: String(value ?? ""),
        rect: sheetGridRect(range),
        transform
      });
    });
  });
  const chunkAnchors = xlsxSheetChunkAnchors(sheet.name, rows, Math.max(maxColumns, 1));
  return {
    text: [`Sheet: ${sheet.name}`, ...rows.map((row) => row.text)].join("\n"),
    anchors: [...chunkAnchors, ...cellAnchors]
  };
}

function parseDelimitedRow(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && character === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current);
  return cells.map((value) => value.trim());
}

function extractDelimitedSpreadsheet(text, sheetName, delimiter) {
  const normalized = text.replaceAll("\r\n", "\n").replace(/\n+$/, "");
  const lines = normalized.split("\n").filter((line) => line.length > 0);
  const rows = lines.map((line, index) => {
    const values = parseDelimitedRow(line, delimiter);
    return { rowNumber: index + 1, text: values.join("\t"), values };
  });
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.values.length), 0);
  const colCount = Math.max(maxColumns, 1);
  const transform = sheetGridTransform(colCount, Math.max(rows.length, 1));
  const anchors = xlsxSheetChunkAnchors(sheetName, rows, colCount);
  for (const row of rows) {
    row.values.forEach((value, columnIndex) => {
      const range = `${columnIndexToLetters(columnIndex)}${row.rowNumber}`;
      anchors.push({
        anchorId: `xlsx:${sheetName}:${range}`,
        objectId: `xlsx:${sheetName}:${range}`,
        format: "xlsx",
        locator: { kind: "xlsx-range", sheet: sheetName, range },
        sheet: sheetName,
        range,
        selectedText: value,
        rect: sheetGridRect(range),
        transform
      });
    });
  }
  return {
    text: [`Sheet: ${sheetName}`, ...rows.map((row) => row.text)].join("\n"),
    anchors,
    warnings: []
  };
}

function sliceTextParagraphs(content) {
  const lines = content.split("\n");
  const slices = [];
  let chunkLines = [];
  let chunkStartLine = 1;
  let chunkStartOffset = 0;
  let chunkIndex = 0;
  let textOffset = 0;
  const flush = (endLine) => {
    if (!chunkLines.length) return;
    const sliceText = chunkLines.join("\n");
    const firstLine = chunkLines.map((line) => line.trim()).find(Boolean) || "";
    slices.push({
      chunkIndex,
      headingPath: firstLine ? [firstLine.slice(0, 80)] : [],
      startLine: chunkStartLine,
      endLine,
      text: sliceText,
      startOffset: chunkStartOffset,
      endOffset: textOffset
    });
    chunkIndex += 1;
    chunkLines = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      flush(index);
      chunkStartLine = index + 2;
      chunkStartOffset = textOffset + line.length + 1;
    } else {
      if (!chunkLines.length) {
        chunkStartLine = index + 1;
        chunkStartOffset = textOffset;
      }
      chunkLines.push(line);
    }
    textOffset += line.length + 1;
  }
  flush(lines.length);
  if (!slices.length) {
    slices.push({
      chunkIndex: 0,
      headingPath: [],
      startLine: 1,
      endLine: Math.max(1, lines.length),
      text: content,
      startOffset: 0,
      endOffset: content.length
    });
  }
  return slices;
}

function sheetGridRect(address) {
  const match = /^([A-Z]+)(\d+)$/i.exec(String(address || "").trim());
  if (!match) return { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: columnLettersToIndex(match[1]),
    y: Math.max(0, Number(match[2]) - 1),
    width: 1,
    height: 1
  };
}

const runOnce = process.argv.includes("--once");
const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  try { await ingest(JSON.parse(line)); }
  catch { response("unknown", { status: "failed", error_code: "DOCUMENT_WORKER_BAD_JSON" }); }
  if (runOnce) {
    lines.close();
    process.stdin.destroy();
  }
});
