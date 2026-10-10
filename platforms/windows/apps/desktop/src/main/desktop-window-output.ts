/** Decode the Windows UI driver stdout. PowerShell 5.1 pipes are often GBK or UTF-16. */

function cjkScore(text: string) {
  const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const damaged = text.match(/[\uFFFD\u0400-\u04FF\u2500-\u257F\u2666]/g)?.length ?? 0;
  return cjk * 5 - damaged * 8;
}

function titleScore(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.reduce((score, item) => {
      const title = String((item as { title?: unknown } | null)?.title ?? "");
      return score + cjkScore(title);
    }, 0);
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

function hasDamagedTitle(text: string) {
  return /[\uFFFD\u0400-\u04FF\u2500-\u257F\u2666]/.test(text);
}

function decodeUtf16(buffer: Buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (buffer.length >= 4 && (buffer[0] === 0x5b || buffer[0] === 0x7b) && buffer[1] === 0x00) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return "";
}

export function decodeDriverOutput(buffer: Buffer) {
  if (buffer.length === 0) return "";
  const utf16 = decodeUtf16(buffer);
  if (utf16.trim()) return utf16;
  const utf8 = buffer.toString("utf8").replace(/^\uFEFF/, "");
  let gbk = "";
  try {
    gbk = new TextDecoder("gb18030").decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    gbk = "";
  }
  if (!gbk || gbk === utf8) return utf8;
  const utf8Score = titleScore(utf8);
  if (!hasDamagedTitle(utf8) && utf8Score > Number.NEGATIVE_INFINITY) return utf8;
  return titleScore(gbk) > utf8Score ? gbk : utf8;
}
