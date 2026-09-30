export function buildGovernmentRevisionPreview(requestText) {
  const text = String(requestText ?? "").trim();
  const numbered = [...text.matchAll(/(?:^|\n)\s*([1-9])\s*[.、]\s*([^\n]+(?:\n(?!\s*[1-9]\s*[.、])[^\n]+)*)/gu)]
    .map((match) => ({ number: match[1], detail: match[2].trim() }))
    .filter((item) => item.detail);
  const items = numbered.length > 0
    ? numbered.map((item) => `${item.number}. ${item.detail}`).join("\n")
    : "1. 按本轮要求调整正文表达、结构和语气。";
  const preserve = /保留[^\n。]*PDF|不得覆盖/u.test(text)
    ? "\n\n第一版 PDF 将保持原文件不变，不覆盖、不改写。"
    : "";
  return `## 修改说明\n\n${items}${preserve}\n\n本轮仅确认修改方向，不生成任何新文件。`;
}
