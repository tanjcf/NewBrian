/** Speakable text for the preview-header 智能朗读 button. */

export type PreviewSpeechInput = {
  kind?: string;
  content?: string;
  html?: string;
  dataUrl?: string;
  sheets?: Array<{ name?: string; headers?: string[]; rows?: string[][] }>;
};

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function joinSpeechParts(parts: string[]) {
  return parts.reduce((combined, part) => {
    if (!combined) return part;
    const cjkBoundary = /[\u3400-\u9fff]$/u.test(combined) && /^[\u3400-\u9fff]/u.test(part);
    return cjkBoundary ? `${combined}${part}` : `${combined} ${part}`;
  }, "");
}

/** Visible drawing-ml text on one slide, in document order. */
export function speechTextFromSlideXml(xml: string) {
  const parts = [...String(xml || "").matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1] || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return joinSpeechParts(parts);
}

function stripTags(value: string) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function inflateRaw(data: Uint8Array) {
  const copy = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice();
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findZipEocd(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= start; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) return index;
  }
  return -1;
}

/** Read selected ZIP entries. PPTX slide XML is stored deflated or uncompressed. */
export async function readZipTextEntries(bytes: Uint8Array, namePattern: RegExp) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findZipEocd(bytes);
  if (eocd < 0) throw new Error("PPTX_ZIP_INVALID");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const found = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!namePattern.test(name)) continue;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const raw = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (!raw) continue;
    found.set(name, new TextDecoder().decode(raw));
  }
  return found;
}

export async function speechTextFromPptxBytes(bytes: Uint8Array) {
  const slides = await readZipTextEntries(bytes, /^ppt\/slides\/slide\d+\.xml$/i);
  const ordered = [...slides.entries()].sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true }));
  return ordered.map(([, xml]) => speechTextFromSlideXml(xml)).filter(Boolean).join("\n");
}

export function bytesFromDataUrl(dataUrl: string) {
  const comma = String(dataUrl || "").indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : String(dataUrl || "");
  const binary = atob(payload.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function speechTextFromPptxDataUrl(dataUrl: string) {
  return speechTextFromPptxBytes(bytesFromDataUrl(dataUrl));
}

function spreadsheetSpeech(sheets: PreviewSpeechInput["sheets"]) {
  if (!Array.isArray(sheets)) return "";
  return sheets.map((sheet) => {
    const cells = [
      sheet?.name || "",
      ...(Array.isArray(sheet?.headers) ? sheet.headers : []),
      ...(Array.isArray(sheet?.rows) ? sheet.rows.flat() : [])
    ].map((cell) => String(cell || "").trim()).filter(Boolean);
    return cells.join(" ");
  }).filter(Boolean).join("\n");
}

/**
 * Text the preview speaker should read.
 * PPTX previews only carry a data URL, so slide XML is the source — not `content`.
 */
export async function speechTextForPreview(preview: PreviewSpeechInput) {
  const kind = String(preview?.kind || "");
  if (kind === "pptx" && String(preview.dataUrl || "").trim()) {
    const slides = await speechTextFromPptxDataUrl(String(preview.dataUrl));
    if (slides.trim()) return slides;
  }
  if (kind === "docx") return stripTags(String(preview.html || preview.content || ""));
  if (kind === "spreadsheet") return spreadsheetSpeech(preview.sheets);
  if (kind === "html") return stripTags(String(preview.content || ""));
  return String(preview?.content || "").trim();
}
