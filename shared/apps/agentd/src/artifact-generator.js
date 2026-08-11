import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import PptxGenJS from "pptxgenjs";

const SUPPORTED_FORMATS = new Set(["pdf", "pptx", "xlsx", "docx"]);
const PAGE_SIZE_ALIASES = new Set(["a3", "a4", "a5", "letter", "legal", "tabloid"]);
const MIME_TYPES = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function rows(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => Array.isArray(row) ? row.map((cell) => cell == null || ["string", "number", "boolean"].includes(typeof cell) ? (cell ?? "") : String(cell)) : []);
}

/** Remove inline Markdown so office generators never print raw markers. */
export function stripInlineMarkdown(value) {
  return String(value ?? "")
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
    .trim();
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

async function generatePdf(input, target) {
  const font = await firstExisting(process.platform === "win32" ? [
    "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simsun.ttc"
  ] : ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]);
  await new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margins: { top: 54, right: 54, bottom: 54, left: 54 },
      info: { Title: text(input.title, "Document") },
      ...(font ? { font } : {})
    });
    const stream = document.pipe(createWriteStream(target));
    stream.on("finish", resolve);
    stream.on("error", reject);
    document.on("error", reject);
    if (font) document.font(font);
    document.fontSize(22).fillColor("#17365D").text(stripInlineMarkdown(normalizeArtifactMarkup(text(input.title, "Document"))), { align: "center" });
    document.moveDown(1.2);
    for (const section of sections(input)) {
      if (section.heading) document.fontSize(15).fillColor("#1F4E78").text(section.heading).moveDown(0.35);
      if (section.body) {
        for (const paragraph of section.body.split(/\n{2,}/).map((part) => part.replace(/\n+/g, "").trim()).filter(Boolean)) {
          document.fontSize(11).fillColor("#202124").text(paragraph, { lineGap: 4, align: "justify" }).moveDown(0.45);
        }
        document.moveDown(0.2);
      }
      for (const bullet of section.bullets) document.fontSize(11).fillColor("#202124").text(`• ${bullet}`, { indent: 14, lineGap: 3 });
      if (section.bullets.length) document.moveDown(0.5);
    }
    document.end();
  });
}

async function generatePptx(input, target) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "codeCN";
  deck.subject = text(input.title, "Presentation");
  deck.title = text(input.title, "Presentation");
  deck.company = "codeCN";
  deck.lang = "zh-CN";
  deck.theme = { headFontFace: "Microsoft YaHei", bodyFontFace: "Microsoft YaHei", lang: "zh-CN" };
  const slides = Array.isArray(input.slides) && input.slides.length ? input.slides : sections(input).map((section) => ({
    title: section.heading || text(input.title, "Presentation"), body: section.body, bullets: section.bullets
  }));
  const titleSlide = deck.addSlide();
  titleSlide.background = { color: "F5F8FC" };
  titleSlide.addText(stripInlineMarkdown(text(input.title, "Presentation")), { x: 0.8, y: 2.2, w: 11.7, h: 0.8, fontFace: "Microsoft YaHei", fontSize: 28, bold: true, color: "17365D", align: "center", margin: 0 });
  for (const source of slides) {
    const slide = deck.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.16, fill: { color: "2F75B5" }, line: { color: "2F75B5" } });
    slide.addText(stripInlineMarkdown(text(source?.title, "Section")), { x: 0.7, y: 0.45, w: 11.9, h: 0.55, fontFace: "Microsoft YaHei", fontSize: 24, bold: true, color: "17365D", margin: 0 });
    const body = stripInlineMarkdown(text(source?.body));
    const bullets = Array.isArray(source?.bullets)
      ? source.bullets.map((item) => stripInlineMarkdown(text(item))).filter(Boolean)
      : [];
    const runs = [];
    if (body) runs.push({ text: body, options: { breakLine: bullets.length > 0 } });
    for (const bullet of bullets) runs.push({ text: bullet, options: { bullet: { indent: 18 }, breakLine: true } });
    slide.addText(runs.length ? runs : [{ text: "", options: {} }], { x: 0.85, y: 1.35, w: 11.6, h: 5.25, fontFace: "Microsoft YaHei", fontSize: 18, color: "202124", breakLine: false, valign: "top", margin: 0.08, paraSpaceAfterPt: 12, fit: "shrink" });
  }
  await deck.writeFile({ fileName: target });
}

async function generateXlsx(input, target) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "codeCN";
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

async function generateDocx(input, target) {
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, alignment: "center", children: [new TextRun({ text: stripInlineMarkdown(normalizeArtifactMarkup(text(input.title, "Document"))), bold: true })] })];
  for (const section of sections(input)) {
    if (section.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.heading)] }));
    if (section.body) {
      for (const paragraph of section.body.split(/\n{2,}/).map((part) => part.replace(/\n+/g, "").trim()).filter(Boolean)) {
        children.push(new Paragraph({ children: [new TextRun(paragraph)], spacing: { after: 160 } }));
      }
    }
    for (const bullet of section.bullets) children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
  }
  if (Array.isArray(input.rows) && input.rows.length) {
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows(input.rows).map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(String(cell))] })) })) }));
  }
  const document = new Document({ creator: "codeCN", title: text(input.title, "Document"), sections: [{ properties: {}, children }] });
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
      `Unsupported artifact format: ${format || "missing"}. Use exactly one of: pdf, pptx, xlsx, docx. Do not pass page size (a4/letter) as format.`
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
  return { ...input, targetPath, format, title: title || undefined };
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

  return {
    title: title || "Document",
    content: content ? normalizeArtifactMarkup(content) : "",
    sections: normalizedSections,
    targetPath,
    format: resolvedFormat
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
  const slug = (title || "codecn-output")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.+$/g, "")
    .slice(0, 60) || "codecn-output";
  return `outputs/${slug}.${format}`;
}

export async function generateArtifact(input, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (input.format === "pdf") await generatePdf(input, target);
  if (input.format === "pptx") await generatePptx(input, target);
  if (input.format === "xlsx") await generateXlsx(input, target);
  if (input.format === "docx") await generateDocx(input, target);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size < 100) throw new Error(`Generated ${input.format} artifact is empty.`);
  return { size: stat.size, type: MIME_TYPES[input.format] };
}
