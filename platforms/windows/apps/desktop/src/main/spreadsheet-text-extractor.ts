import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("Spreadsheet file path is required.");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (error) {
    const fallback = await extractOoxmlText(filePath);
    if (fallback) {
      process.stdout.write(fallback);
      return;
    }
    throw error;
  }
  const chunks: string[] = [];
  let remainingCells = 100_000;
  let remainingChars = 512 * 1024;
  for (const worksheet of workbook.worksheets.slice(0, 5)) {
    const rows: string[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 10_000 || remainingCells <= 0 || remainingChars <= 0) return;
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      remainingCells -= values.length;
      const line = values.map((value) => {
        if (value && typeof value === "object" && "result" in value) {
          return String((value as { result?: unknown }).result ?? "");
        }
        return String(value ?? "");
      }).join("\t").slice(0, remainingChars);
      remainingChars -= line.length;
      rows.push(line);
    });
    chunks.push([`Sheet: ${worksheet.name}`, ...rows].join("\n"));
    if (remainingCells <= 0 || remainingChars <= 0) break;
  }
  process.stdout.write(chunks.join("\n\n"));
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function extractOoxmlText(filePath: string) {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string") ?? "";
  const sheetNames = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]+)"/g)]
    .map((match) => decodeXml(match[1]));
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string") ?? "";
  const sharedStrings = [...sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)]
    .map((match) => decodeXml([...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((item) => item[1]).join("")));
  const sheetPaths = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .slice(0, 5);
  const chunks: string[] = [];
  let remainingCells = 100_000;
  let remainingChars = 512 * 1024;
  for (const [sheetIndex, sheetPath] of sheetPaths.entries()) {
    const xml = await zip.file(sheetPath)?.async("string") ?? "";
    const rows: string[] = [];
    for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      const values: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
        if (remainingCells-- <= 0 || remainingChars <= 0) break;
        const type = /\bt="([^"]+)"/.exec(cellMatch[1])?.[1] ?? "";
        const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cellMatch[2])?.[1]
          ?? /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/.exec(cellMatch[2])?.[1]
          ?? "";
        const value = type === "s" ? (sharedStrings[Number(raw)] ?? "") : decodeXml(raw);
        values.push(value);
      }
      const line = values.join("\t").slice(0, remainingChars);
      remainingChars -= line.length;
      if (line) rows.push(line);
      if (remainingCells <= 0 || remainingChars <= 0 || rows.length >= 10_000) break;
    }
    chunks.push([`Sheet: ${sheetNames[sheetIndex] ?? `Sheet${sheetIndex + 1}`}`, ...rows].join("\n"));
    if (remainingCells <= 0 || remainingChars <= 0) break;
  }
  return chunks.join("\n\n");
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
