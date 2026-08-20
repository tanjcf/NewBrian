import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { loadDesktopCjkFontBytes } from "./pdf-cjk-font.ts";

export type PdfAnnotationResult = {
  bytes: Buffer;
  fontPath: string | null;
  usedCjkFont: boolean;
  renderedText: string;
};

/** Draws a bounded highlight + annotation text; embeds a system CJK font when available. */
export async function addPdfAnnotation(input: {
  bytes: Buffer;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
}): Promise<Buffer> {
  const result = await addPdfAnnotationWithMeta(input);
  return result.bytes;
}

export async function addPdfAnnotationWithMeta(input: {
  bytes: Buffer;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
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
  page.drawRectangle({
    x: input.rect.x,
    y: input.rect.y,
    width: input.rect.width,
    height: input.rect.height,
    borderColor: rgb(0.9, 0.2, 0.1),
    borderWidth: 1.5,
    color: rgb(1, 0.95, 0.8),
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
