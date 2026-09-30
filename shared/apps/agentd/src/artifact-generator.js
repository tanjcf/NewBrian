import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { localizeChineseDoubleQuotes } from "./chinese-typography.js";
import {
  fontFileCandidates,
  lineSpacingToDocxLine,
  lineSpacingToPdfLineGap,
  mmToPdfPoints,
  normalizeDocumentStyleValues,
  normalizeFontFamily
} from "./delivery-preferences.js";
import { writeHtmlDeck, writePptxDeck } from "./presentation-deck.js";

export { containsCjkText, localizeChineseDoubleQuotes } from "./chinese-typography.js";

const SUPPORTED_FORMATS = new Set(["pdf", "pptx", "xlsx", "docx", "html"]);
const PAGE_SIZE_ALIASES = new Set(["a3", "a4", "a5", "letter", "legal", "tabloid"]);
const MIME_TYPES = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html; charset=utf-8"
};

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function rows(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => Array.isArray(row) ? row.map((cell) => {
    if (cell == null) return "";
    if (typeof cell === "number" || typeof cell === "boolean") return cell;
    return localizeChineseDoubleQuotes(typeof cell === "string" ? cell : String(cell));
  }) : []);
}

/**
 * Split Markdown pipe tables out of prose so DOCX/PDF keep real tables instead of
 * collapsing "| a | b |" lines into one overlapping paragraph.
 */
export function splitMarkdownTables(content) {
  const lines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
  const prose = [];
  const tables = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const isTableRow = /^\s*\|.+\|\s*$/.test(line);
    if (!isTableRow) {
      prose.push(line);
      index += 1;
      continue;
    }
    const block = [];
    while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
      block.push(lines[index]);
      index += 1;
    }
    const parsed = block
      .filter((row) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(row))
      .map((row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim()));
    if (parsed.length >= 2 && parsed.every((row) => row.length > 0)) {
      tables.push(parsed);
      if (prose.length && prose[prose.length - 1] !== "") prose.push("");
    } else {
      prose.push(...block);
    }
  }
  return { text: prose.join("\n").replace(/\n{3,}/g, "\n\n").trim(), tables };
}

function appendDocxBody(children, body) {
  const { text: remainder, tables } = splitMarkdownTables(body);
  for (const paragraph of remainder.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
    for (const line of paragraph.split("\n").map((item) => item.trim()).filter(Boolean)) {
      children.push(new Paragraph({ children: [new TextRun(line)], spacing: { after: 120 } }));
    }
  }
  for (const tableRows of tables) {
    children.push(buildDocxTable(tableRows));
  }
}

function buildDocxTable(tableRows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows(tableRows).map((row, rowIndex) => new TableRow({
      children: row.map((cell) => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: String(cell), bold: rowIndex === 0 })]
        })]
      }))
    }))
  });
}

function localizeOfficeText(value) {
  return localizeChineseDoubleQuotes(value);
}

/** Remove inline Markdown so office generators never print raw markers. */
export function stripInlineMarkdown(value) {
  return localizeOfficeText(String(value ?? "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function decodeBasicEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

/**
 * Convert model-emitted HTML/XML chrome into plain text / Markdown headings.
 * PDFKit does not render HTML; leaving tags prints them literally in the PDF.
 */
export function normalizeArtifactMarkup(content) {
  let source = String(content ?? "").replace(/\r\n/g, "\n");
  source = source
    .replace(/<\/?(?:document|html|head|body|meta|style|script)\b[^>]*>/gi, "")
    .replace(/<(?:font|margins)\b[^>]*\/?>/gi, "")
    .replace(/<hr\s*\/?>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  source = source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, inner) => {
    const heading = decodeBasicEntities(inner.replace(/<\/?[^>]+>/g, "")).trim();
    if (!heading) return "\n";
    return `\n${"#".repeat(Math.min(Number(level) || 1, 6))} ${heading}\n`;
  });
  source = source.replace(/<(?:p|div)\b[^>]*>([\s\S]*?)<\/(?:p|div)>/gi, (_match, inner) => {
    const body = decodeBasicEntities(inner.replace(/<\/?[^>]+>/g, "")).trim();
    return body ? `\n${body}\n` : "\n";
  });
  source = source
    .replace(/<\/?(?:b|strong)>/gi, "")
    .replace(/<\/?[^>]+>/g, "");
  return decodeBasicEntities(source)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert Markdown-ish article text into heading/body/bullet sections for PDF/DOCX.
 * Keeps Chinese numeral section lines (一、…) as headings when short.
 */
export function markdownToSections(content) {
  const source = normalizeArtifactMarkup(String(content ?? ""))
    .replace(/```[\s\S]*?```/g, (block) => {
      const inner = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      if (/^\s*[{\[]/.test(inner)) return "";
      return `${inner.trim()}\n`;
    })
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
    .trim();
  if (!source) return [];

  const result = [];
  let current = { heading: "", bodyLines: [], bullets: [] };
  const flush = () => {
    const body = stripInlineMarkdown(current.bodyLines.join("\n")).trim();
    const bullets = current.bullets.map((item) => stripInlineMarkdown(item)).filter(Boolean);
    const heading = stripInlineMarkdown(current.heading);
    if (heading || body || bullets.length) result.push({ heading, body, bullets });
    current = { heading: "", bodyLines: [], bullets: [] };
  };

  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/\s+$/u, "");
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/u);
    if (headingMatch) {
      flush();
      current.heading = headingMatch[1].trim();
      continue;
    }
    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/u) || line.match(/^\s*\d+[.)、]\s+(.+)$/u);
    if (bulletMatch) {
      current.bullets.push(bulletMatch[1].trim());
      continue;
    }
    const chineseHeading = line.match(/^(?:[一二三四五六七八九十百千]+[、.．]|第[一二三四五六七八九十]+[章节部分篇])\s*.+$/u);
    if (chineseHeading && Array.from(line).length <= 40 && !/[。；;！？?]/.test(line)) {
      flush();
      current.heading = line.trim();
      continue;
    }
    current.bodyLines.push(line);
  }
  flush();
  return result;
}

function sections(input) {
  const normalized = Array.isArray(input.sections) ? input.sections.map((section) => ({
    heading: stripInlineMarkdown(normalizeArtifactMarkup(text(section?.heading))),
    body: stripInlineMarkdown(normalizeArtifactMarkup(text(section?.body))),
    bullets: Array.isArray(section?.bullets)
      ? section.bullets.map((item) => stripInlineMarkdown(normalizeArtifactMarkup(text(item)))).filter(Boolean)
      : []
  })).filter((section) => section.heading || section.body || section.bullets.length) : [];
  if (normalized.length) return normalized;
  const content = text(input.content);
  if (!content) return [];
  const parsed = markdownToSections(content);
  if (parsed.length) return parsed;
  return [{ heading: "", body: stripInlineMarkdown(normalizeArtifactMarkup(content)), bullets: [] }];
}

async function firstExisting(paths) {
  for (const candidate of paths) {
    if (await fs.stat(candidate).then((stat) => stat.isFile()).catch(() => false)) return candidate;
  }
  return null;
}

function readInputStyle(input) {
  return normalizeDocumentStyleValues(input?.style || {});
}

async function resolvePdfFontPath(style) {
  const preferred = style.fontFamily
    ? fontFileCandidates(style.fontFamily)
    : (process.platform === "win32"
      ? ["C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simsun.ttc"]
      : ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]);
  return firstExisting(preferred);
}

function pdfMarginsFromStyle(style) {
  const defaults = { top: 54, right: 54, bottom: 54, left: 54 };
  if (!style.marginsMm) return defaults;
  const next = { ...defaults };
  for (const edge of ["top", "right", "bottom", "left"]) {
    const points = mmToPdfPoints(style.marginsMm[edge]);
    if (points != null) next[edge] = points;
  }
  return next;
}

async function generatePdf(input, target) {
  const style = readInputStyle(input);
  const font = await resolvePdfFontPath(style);
  const bodySize = style.fontSizePt || 11;
  const titleSize = style.titleFontSizePt || 22;
  const headingSize = Math.max(bodySize + 3, 14);
  const lineGap = lineSpacingToPdfLineGap(style.lineSpacing, bodySize);
  await new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margins: pdfMarginsFromStyle(style),
      info: { Title: text(input.title, "Document") },
      ...(font ? { font } : {})
    });
    const stream = document.pipe(createWriteStream(target));
    stream.on("finish", resolve);
    stream.on("error", reject);
    document.on("error", reject);
    if (font) document.font(font);
    document.fontSize(titleSize).fillColor("#17365D").text(stripInlineMarkdown(normalizeArtifactMarkup(text(input.title, "Document"))), { align: "center" });
    document.moveDown(1.2);
    for (const section of sections(input)) {
      if (section.heading) document.fontSize(headingSize).fillColor("#1F4E78").text(section.heading).moveDown(0.35);
      if (section.body) {
        for (const paragraph of section.body.split(/\n{2,}/).map((part) => part.replace(/\n+/g, "").trim()).filter(Boolean)) {
          document.fontSize(bodySize).fillColor("#202124").text(paragraph, { lineGap, align: "justify" }).moveDown(0.45);
        }
        document.moveDown(0.2);
      }
      for (const bullet of section.bullets) {
        document.fontSize(bodySize).fillColor("#202124").text(`• ${bullet}`, { indent: 14, lineGap: Math.max(2, lineGap - 1) });
      }
      if (section.bullets.length) document.moveDown(0.5);
    }
    document.end();
  });
}

async function generatePptx(input, target, workspaceRoot, options = {}) {
  await writePptxDeck(input, target, sections, {
    workspaceRoot,
    onSlideWritten: options.onSlideWritten
  });
  // Companion web deck for Cursor-style browser presentation / side preview.
  const companion = target.replace(/\.pptx$/i, ".slides.html");
  if (companion !== target) {
    await writeHtmlDeck(input, companion, sections);
  }
}

async function generateHtml(input, target) {
  await writeHtmlDeck(input, target, sections);
}

async function generateXlsx(input, target) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NewBrain";
  const sources = Array.isArray(input.sheets) && input.sheets.length ? input.sheets : [{ name: "Sheet1", rows: input.rows }];
  for (const [index, source] of sources.entries()) {
    const requestedName = text(source?.name, `Sheet${index + 1}`).replace(/[\\/*?:[\]]/g, "_").slice(0, 31) || `Sheet${index + 1}`;
    const sheet = workbook.addWorksheet(requestedName);
    const sheetRows = rows(source?.rows);
    if (!sheetRows.length && text(input.content)) sheetRows.push([text(input.title, "Document")], [text(input.content)]);
    sheetRows.forEach((row) => sheet.addRow(row));
    if (sheet.rowCount) {
      const header = sheet.getRow(1);
      header.font = { name: "Microsoft YaHei", bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F75B5" } };
      header.alignment = { vertical: "middle", horizontal: "center" };
      header.height = 24;
    }
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.font = { name: "Microsoft YaHei", size: 11 };
      row.alignment = { vertical: "middle", wrapText: true };
    });
    sheet.columns.forEach((column) => {
      let width = 10;
      column.eachCell?.({ includeEmpty: true }, (cell) => { width = Math.max(width, Math.min(42, String(cell.value ?? "").length + 3)); });
      column.width = width;
    });
    sheet.views = [{ state: "frozen", ySplit: sheet.rowCount ? 1 : 0 }];
    if (sheet.rowCount > 1 && sheet.columnCount > 0) sheet.autoFilter = `A1:${sheet.getCell(sheet.rowCount, sheet.columnCount).address}`;
  }
  await workbook.xlsx.writeFile(target);
}

function docxRunOptions(textValue, style, extras = {}) {
  const options = {
    text: textValue,
    ...extras
  };
  if (style.fontFamily) options.font = normalizeFontFamily(style.fontFamily);
  if (style.fontSizePt) options.size = Math.round(style.fontSizePt * 2); // half-points
  return options;
}

function appendDocxBodyStyled(children, body, style) {
  const { text: remainder, tables } = splitMarkdownTables(body);
  const line = lineSpacingToDocxLine(style.lineSpacing);
  for (const paragraph of remainder.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
    for (const lineText of paragraph.split("\n").map((item) => item.trim()).filter(Boolean)) {
      children.push(new Paragraph({
        spacing: { after: 120, line, lineRule: "auto" },
        children: [new TextRun(docxRunOptions(lineText, style))]
      }));
    }
  }
  for (const tableRows of tables) {
    children.push(buildDocxTable(tableRows));
  }
}

async function generateDocx(input, target) {
  const style = readInputStyle(input);
  const titleSize = style.titleFontSizePt
    ? Math.round(style.titleFontSizePt * 2)
    : (style.fontSizePt ? Math.round((style.fontSizePt + 6) * 2) : undefined);
  const titleRun = {
    text: stripInlineMarkdown(normalizeArtifactMarkup(text(input.title, "Document"))),
    bold: true,
    ...(style.fontFamily ? { font: normalizeFontFamily(style.fontFamily) } : {}),
    ...(titleSize ? { size: titleSize } : {})
  };
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, alignment: "center", children: [new TextRun(titleRun)] })];
  if (Array.isArray(input.rows) && input.rows.length) {
    children.push(buildDocxTable(input.rows));
  }
  const line = lineSpacingToDocxLine(style.lineSpacing);
  for (const section of sections(input)) {
    if (section.heading) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 120, line, lineRule: "auto" },
        children: [new TextRun(docxRunOptions(section.heading, style, {
          bold: style.headingBold !== false,
          ...(style.fontSizePt ? { size: Math.round((style.fontSizePt + 2) * 2) } : {})
        }))]
      }));
    }
    if (section.body) appendDocxBodyStyled(children, section.body, style);
    for (const bullet of section.bullets) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { line, lineRule: "auto" },
        children: [new TextRun(docxRunOptions(bullet, style))]
      }));
    }
  }
  const document = new Document({ creator: "NewBrain", title: text(input.title, "Document"), sections: [{ properties: {}, children }] });
  await fs.writeFile(target, await Packer.toBuffer(document));
}

export function validateArtifactCreateInput(input) {
  let targetPath = text(input?.targetPath);
  let format = text(input?.format).toLowerCase();
  const title = text(input?.title);
  const extension = targetPath ? path.extname(targetPath).slice(1).toLowerCase() : "";

  // Models often confuse PDF page size with format (e.g. format:"a4").
  if (PAGE_SIZE_ALIASES.has(format)) format = "pdf";
  if (!format && SUPPORTED_FORMATS.has(extension)) format = extension;
  if (!format && (text(input?.content) || Array.isArray(input?.sections) && input.sections.length)) {
    format = "pdf";
  }
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new Error(
      `Unsupported artifact format: ${format || "missing"}. Use exactly one of: pdf, pptx, html, xlsx, docx. Do not pass page size (a4/letter) as format.`
    );
  }

  if (!targetPath) {
    targetPath = defaultArtifactTargetPath(title, format);
  } else if (!path.extname(targetPath)) {
    targetPath = `${targetPath.replace(/[/\\]+$/g, "")}.${format}`;
  }

  const resolvedExtension = path.extname(targetPath).slice(1).toLowerCase();
  if (resolvedExtension !== format) {
    throw new Error(`targetPath extension must be .${format} (got .${resolvedExtension || "none"}). Example: outputs/report.${format}`);
  }
  return { ...input, targetPath, format, title: title || undefined, ...(Object.keys(normalizeDocumentStyleValues(input?.style || {})).length ? { style: normalizeDocumentStyleValues(input.style) } : {}) };
}

/**
 * Structured PDF/DOCX creator input (OpenClaw-style encapsulation).
 * Prefer title + sections of plain Chinese/Markdown. Reject HTML/XML dumps.
 */
export function validateDocumentCreateInput(input, format) {
  const resolvedFormat = String(format || "").toLowerCase();
  if (resolvedFormat !== "pdf" && resolvedFormat !== "docx") {
    throw new Error("document.create_* only supports pdf or docx.");
  }
  const title = text(input?.title);
  const content = text(input?.content);
  const sectionList = Array.isArray(input?.sections) ? input.sections : [];
  if (!title && !content && sectionList.length === 0) {
    throw new Error(
      `document.create_${resolvedFormat} requires title plus sections or plain-text content.`
    );
  }

  const markupProbe = [
    content,
    ...sectionList.map((section) => `${section?.heading ?? ""}\n${section?.body ?? ""}\n${(section?.bullets ?? []).join("\n")}`)
  ].join("\n");
  if (looksLikeHtmlDocumentDump(markupProbe)) {
    throw new Error(
      [
        `document.create_${resolvedFormat} rejects HTML/XML markup.`,
        "Pass structured plain text: { title, sections:[{ heading, body, bullets }] }.",
        "Do not wrap content in <document>, <p>, <h1>, <font>, or <margins>."
      ].join(" ")
    );
  }

  let targetPath = text(input?.targetPath);
  if (!targetPath) {
    targetPath = defaultArtifactTargetPath(title, resolvedFormat);
  } else if (!path.extname(targetPath)) {
    targetPath = `${targetPath.replace(/[/\\]+$/g, "")}.${resolvedFormat}`;
  }
  const extension = path.extname(targetPath).slice(1).toLowerCase();
  if (extension !== resolvedFormat) {
    throw new Error(`targetPath must end with .${resolvedFormat}. Example: outputs/宣讲稿-第一版.${resolvedFormat}`);
  }

  const normalizedSections = sectionList.map((section) => ({
    heading: normalizeArtifactMarkup(text(section?.heading)),
    body: normalizeArtifactMarkup(text(section?.body)),
    bullets: Array.isArray(section?.bullets)
      ? section.bullets.map((item) => normalizeArtifactMarkup(text(item))).filter(Boolean)
      : []
  })).filter((section) => section.heading || section.body || section.bullets.length);

  const tableRows = rows(input?.rows);

  const style = normalizeDocumentStyleValues(input?.style || {});
  return {
    title: title || "Document",
    content: content ? normalizeArtifactMarkup(content) : "",
    sections: normalizedSections,
    rows: tableRows.length ? tableRows : undefined,
    targetPath,
    format: resolvedFormat,
    ...(Object.keys(style).length ? { style } : {})
  };
}

export function looksLikeHtmlDocumentDump(value) {
  const source = String(value ?? "");
  if (!source) return false;
  if (/<(?:document|html|font|margins)\b/i.test(source)) return true;
  const tagMatches = source.match(/<\/?(?:p|h[1-6]|div|span|br|hr|b|strong)\b[^>]*>/gi) ?? [];
  return tagMatches.length >= 3;
}

function defaultArtifactTargetPath(title, format) {
  const slug = (title || "newbrain-output")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.+$/g, "")
    .slice(0, 60) || "newbrain-output";
  return `outputs/${slug}.${format}`;
}

export async function generateArtifact(input, target, options = {}) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (input.format === "pdf") await generatePdf(input, target);
  if (input.format === "pptx") await generatePptx(input, target, options.workspacePath, options);
  if (input.format === "html") await generateHtml(input, target);
  if (input.format === "xlsx") await generateXlsx(input, target);
  if (input.format === "docx") await generateDocx(input, target);
  const stat = await fs.stat(target);
  const minBytes = input.format === "html" ? 40 : 100;
  if (!stat.isFile() || stat.size < minBytes) throw new Error(`Generated ${input.format} artifact is empty.`);
  return { size: stat.size, type: MIME_TYPES[input.format] };
}
