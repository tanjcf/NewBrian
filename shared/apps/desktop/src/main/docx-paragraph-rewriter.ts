import JSZip from "jszip";

export async function replaceDocxParagraph(input: { bytes: Buffer; paragraphIndex: number; start: number; end: number; replacement: string }) {
  if (!Number.isInteger(input.paragraphIndex) || input.paragraphIndex < 0 || input.start < 0 || input.end < input.start) throw new Error("BRAIN_DOCX_RANGE_INVALID");
  const zip = await JSZip.loadAsync(input.bytes); const entry = zip.file("word/document.xml"); if (!entry) throw new Error("BRAIN_DOCX_DOCUMENT_XML_MISSING");
  const xml = await entry.async("string"); const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]; const paragraph = paragraphs[input.paragraphIndex]?.[0]; if (!paragraph) throw new Error("BRAIN_DOCX_PARAGRAPH_NOT_FOUND");
  const texts = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]; const plain = texts.map((item) => item[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">" )).join(""); if (input.end > plain.length) throw new Error("BRAIN_DOCX_RANGE_OUTSIDE_PARAGRAPH");
  const next = `${plain.slice(0, input.start)}${input.replacement}${plain.slice(input.end)}`.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); const replaced = paragraph.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/, `$1${next}$2`);
  const rebuilt = xml.replace(paragraph, replaced); zip.file("word/document.xml", rebuilt); return zip.generateAsync({ type: "nodebuffer" });
}
