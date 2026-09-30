import JSZip from "jszip";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export async function replacePptxShapeText(input: { bytes: Buffer; slide: number; shapeId: string; start: number; end: number; replacement: string }): Promise<Buffer> {
  if (!Number.isInteger(input.slide) || input.slide < 1 || !input.shapeId.trim() || input.start < 0 || input.end < input.start) throw new Error("BRAIN_PPTX_OPERATION_INVALID");
  const zip = await JSZip.loadAsync(input.bytes);
  const entry = zip.file(`ppt/slides/slide${input.slide}.xml`);
  if (!entry) throw new Error("BRAIN_PPTX_SLIDE_NOT_FOUND");
  const xml = await entry.async("string");
  const shape = [...xml.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]).find((value) => new RegExp(`<p:cNvPr[^>]+\\bid=["']${input.shapeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(value));
  if (!shape) throw new Error("BRAIN_PPTX_SHAPE_NOT_FOUND");
  const textMatches = [...shape.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)];
  const plain = textMatches.map((item) => item[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">" )).join("");
  if (input.end > plain.length) throw new Error("BRAIN_PPTX_RANGE_OUTSIDE_SHAPE");
  const next = plain.slice(0, input.start) + input.replacement + plain.slice(input.end);
  let index = 0;
  const updatedShape = shape.replace(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g, (full, _text) => {
    const remaining = next.slice(index);
    const value = remaining.slice(0, Math.min(Math.max(plain.length - index, 0), remaining.length));
    index += value.length;
    return `<a:t>${escapeXml(value)}</a:t>`;
  });
  zip.file(`ppt/slides/slide${input.slide}.xml`, xml.replace(shape, updatedShape));
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}
