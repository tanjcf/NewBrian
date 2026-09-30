import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { loadDesktopCjkFontBytes } from "./pdf-cjk-font.ts";

export type PdfAnnotationResult = {
  bytes: Buffer;
  fontPath: string | null;
  usedCjkFont: boolean;
  renderedText: string;
};

function parseHighlightColor(color?: string) {
  const normalized = String(color || "").trim();
  const match = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (!match) return { fill: rgb(1, 0.95, 0.8), stroke: rgb(0.9, 0.2, 0.1) };
  const hex = match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return { fill: rgb(r, g, b), stroke: rgb(Math.min(1, r + 0.15), Math.min(1, g + 0.15), Math.min(1, b + 0.15)) };
}

/** Draws a bounded highlight + annotation text; embeds a system CJK font when available. */
export async function addPdfAnnotation(input: {
  bytes: Buffer;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
  color?: string;
}): Promise<Buffer> {
  const result = await addPdfAnnotationWithMeta(input);
  return result.bytes;
}

export async function addPdfAnnotationWithMeta(input: {
  bytes: Buffer;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
  color?: string;
}): Promise<PdfAnnotationResult> {
  if (
    !Number.isInteger(input.page)
    || input.page < 1
    || !Number.isFinite(input.rect.x)
    || !Number.isFinite(input.rect.y)
    || input.rect.width <= 0
    || input.rect.height <= 0
    || !input.text.trim()
  ) {
    throw new Error("BRAIN_PDF_ANNOTATION_INVALID");
  }

  const document = await PDFDocument.load(input.bytes);
  if (input.page > document.getPageCount()) throw new Error("BRAIN_PDF_PAGE_NOT_FOUND");
  document.registerFontkit(fontkit);

  const page = document.getPage(input.page - 1);
  const colors = parseHighlightColor(input.color);
  page.drawRectangle({
    x: input.rect.x,
    y: input.rect.y,
    width: input.rect.width,
    height: input.rect.height,
    borderColor: colors.stroke,
    borderWidth: 1.5,
    color: colors.fill,
    opacity: 0.18
  });

  const sourceText = input.text.trim().slice(0, 2_000);
  const cjkFont = await loadDesktopCjkFontBytes();
  let usedCjkFont = false;
  let renderedText = sourceText;
  let fontPath: string | null = null;

  if (cjkFont) {
    fontPath = cjkFont.path;
    const embedded = await document.embedFont(cjkFont.bytes, { subset: true });
    page.drawText(sourceText, {
      x: input.rect.x + 3,
      y: input.rect.y + input.rect.height - 12,
      size: 9,
      font: embedded,
      color: rgb(0.45, 0.05, 0.02),
      maxWidth: Math.max(20, input.rect.width - 6),
      lineHeight: 11
    });
    usedCjkFont = true;
  } else {
    renderedText = sourceText.replaceAll(/[^\x20-\x7e]/gu, "?");
    page.drawText(renderedText, {
      x: input.rect.x + 3,
      y: input.rect.y + input.rect.height - 12,
      size: 9,
      color: rgb(0.45, 0.05, 0.02),
      maxWidth: Math.max(20, input.rect.width - 6)
    });
  }

  return {
    bytes: Buffer.from(await document.save({ useObjectStreams: true })),
    fontPath,
    usedCjkFont,
    renderedText
  };
}
