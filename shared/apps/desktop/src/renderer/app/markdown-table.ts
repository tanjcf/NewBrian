export type MarkdownTable = { headers: string[]; rows: string[][]; nextIndex: number };

function splitTableRow(line: string) {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of normalized) {
    if (escaped) { current += character; escaped = false; }
    else if (character === "\\") { escaped = true; current += character; }
    else if (character === "|") { cells.push(current.trim()); current = ""; }
    else current += character;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(cells: string[]) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

export function parseMarkdownTable(lines: string[], startIndex: number): MarkdownTable | null {
  if (!/^\s*\|.*\|\s*$/.test(lines[startIndex] ?? "")) return null;
  const headers = splitTableRow(lines[startIndex]);
  const separator = splitTableRow(lines[startIndex + 1] ?? "");
  if (headers.length < 2 || separator.length !== headers.length || !isSeparatorRow(separator)) return null;
  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
    const row = splitTableRow(lines[index]);
    rows.push(headers.map((_, cellIndex) => row[cellIndex] ?? ""));
    index += 1;
  }
  return { headers, rows, nextIndex: index };
}
