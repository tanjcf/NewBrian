const FENCE_PATTERN = /^([ \t]*)(```+|~~~+)([^\r\n]*)$/gm;

function isEscaped(value: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function closeOpenFence(markdown: string) {
  const stack: Array<{ marker: string; indent: string }> = [];
  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    const marker = match[2];
    const active = stack.at(-1);
    if (active && active.marker[0] === marker[0] && marker.length >= active.marker.length && !match[3].trim()) stack.pop();
    else if (!active) stack.push({ marker, indent: match[1] });
  }
  const active = stack.at(-1);
  return active ? `${markdown}${markdown.endsWith("\n") ? "" : "\n"}${active.indent}${active.marker}` : markdown;
}

function closeInlineCode(markdown: string) {
  const withoutFences = markdown.replace(FENCE_PATTERN, "");
  let openRun = "";
  for (let index = 0; index < withoutFences.length;) {
    if (withoutFences[index] !== "`" || isEscaped(withoutFences, index)) { index += 1; continue; }
    let end = index + 1;
    while (withoutFences[end] === "`") end += 1;
    const run = withoutFences.slice(index, end);
    openRun = openRun === run ? "" : openRun || run;
    index = end;
  }
  return openRun ? `${markdown}${openRun}` : markdown;
}

function closeLinkDestination(markdown: string) {
  let openParenthesis = -1;
  for (let index = 0; index < markdown.length - 1; index += 1) {
    if (markdown[index] === "]" && markdown[index + 1] === "(" && !isEscaped(markdown, index)) { openParenthesis = index + 1; index += 1; continue; }
    if (markdown[index] === ")" && openParenthesis >= 0 && !isEscaped(markdown, index)) openParenthesis = -1;
  }
  return openParenthesis >= 0 ? `${markdown})` : markdown;
}

function closeEmphasis(markdown: string) {
  let result = markdown;
  for (const marker of ["**", "__", "~~"]) {
    let count = 0;
    for (let index = 0; index <= markdown.length - marker.length; index += 1) {
      if (markdown.startsWith(marker, index) && !isEscaped(markdown, index)) { count += 1; index += marker.length - 1; }
    }
    if (count % 2 === 1) result += marker;
  }
  return result;
}

/** Produces a renderable snapshot without mutating the persisted model text. */
export function normalizeStreamingMarkdown(content: string, isStreaming: boolean) {
  const normalized = String(content ?? "").replace(/\0/g, "").replace(/\r\n?/g, "\n");
  if (!isStreaming || !normalized) return normalized;
  const withFence = closeOpenFence(normalized);
  if (withFence !== normalized) return withFence;
  return closeEmphasis(closeLinkDestination(closeInlineCode(normalized)));
}

export function safeMarkdownUrl(url: string) {
  const value = String(url ?? "").trim();
  if (!value) return "";
  if (value.startsWith("#") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\")) return value;
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return value;
  return /^(?:https?|mailto):/i.test(value) ? value : "";
}
