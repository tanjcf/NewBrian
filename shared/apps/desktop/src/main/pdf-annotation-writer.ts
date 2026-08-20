import { PDFDocument, rgb } from "pdf-lib";

export async function addPdfAnnotation(input: { bytes: Buffer; page: number; rect: { x: number; y: number; width: number; height: number }; text: string }): Promise<Buffer> {
  if (!Number.isInteger(input.page) || input.page < 1 || !Number.isFinite(input.rect.x) || !Number.isFinite(input.rect.y) || input.rect.width <= 0 || input.rect.height <= 0 || !input.text.trim()) throw new Error("BRAIN_PDF_ANNOTATION_INVALID");
  const document = await PDFDocument.load(input.bytes);
  if (input.page > document.getPageCount()) throw new Error("BRAIN_PDF_PAGE_NOT_FOUND");
  const page = document.getPage(input.page - 1);
  page.drawRectangle({ x: input.rect.x, y: input.rect.y, width: input.rect.width, height: input.rect.height, borderColor: rgb(0.9, 0.2, 0.1), borderWidth: 1.5, color: rgb(1, 0.95, 0.8), opacity: 0.18 });
  const displayText = input.text.trim().slice(0, 2_000).replaceAll(/[^\x20-\x7e]/gu, "?");
  page.drawText(displayText, { x: input.rect.x + 3, y: input.rect.y + input.rect.height - 12, size: 9, color: rgb(0.45, 0.05, 0.02), maxWidth: Math.max(20, input.rect.width - 6) });
  return Buffer.from(await document.save({ useObjectStreams: true }));
}
