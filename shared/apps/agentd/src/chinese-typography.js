/** True when the text contains CJK ideographs (Chinese prose context). */
export function containsCjkText(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(value ?? ""));
}

/**
 * Normalize ASCII/fullwidth straight double quotes to Chinese curly quotes in Chinese prose.
 * Chat replies often already use “…”; Word/tool payloads frequently still use "..." or ＂...＂.
 * Leave English-only strings unchanged so code/identifiers keep ASCII quotes.
 * Existing “ ” pairs keep open/close state in sync when mixed with leftover ASCII quotes.
 */
export function localizeChineseDoubleQuotes(value) {
  const source = String(value ?? "");
  if (!source || !containsCjkText(source)) return source;
  const normalized = source.replace(/\uFF02/g, '"');
  if (!normalized.includes('"')) return normalized;
  let opening = true;
  let result = "";
  for (const ch of normalized) {
    if (ch === "\u201c") {
      opening = false;
      result += ch;
      continue;
    }
    if (ch === "\u201d") {
      opening = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      result += opening ? "\u201c" : "\u201d";
      opening = !opening;
      continue;
    }
    result += ch;
  }
  return result;
}
