import JSZip from "jszip";

export const SPREADSHEET_PREVIEW_MAX_ROWS = 200;
export const SPREADSHEET_PREVIEW_MAX_COLS = 50;
export const SPREADSHEET_PREVIEW_MAX_SHEETS = 10;

export type SpreadsheetPreviewSheet = {
  name: string;
  headers: string[];
  rows: string[][];
  truncated: boolean;
  totalRows: number;
};

export type SpreadsheetPreviewData = {
  sheets: SpreadsheetPreviewSheet[];
};

function splitDelimitedLine(line: string, delimiter: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      result.push(value);
      value = "";
    } else value += char;
  }
  result.push(value);
  return result;
}

function normalizeGrid(headers: string[], rows: string[][]) {
  const width = Math.min(
    Math.max(headers.length, ...rows.map((row) => row.length), 0),
    SPREADSHEET_PREVIEW_MAX_COLS
  );
  return {
    headers: [...Array(width)].map((_, index) => {
      const value = headers[index]?.trim() ?? "";
      return value || `列 ${index + 1}`;
    }),
    rows: rows.map((row) => [...Array(width)].map((_, index) => row[index] ?? ""))
  };
}

function parseDelimited(buffer: Buffer, delimiter: string, sheetName: string): SpreadsheetPreviewSheet {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) {
    return { name: sheetName, headers: [], rows: [], truncated: false, totalRows: 0 };
  }
  const parsedRows = lines.map((line) => splitDelimitedLine(line, delimiter));
  const [headerRow, ...bodyRows] = parsedRows;
  const totalRows = bodyRows.length;
  const limitedRows = bodyRows.slice(0, SPREADSHEET_PREVIEW_MAX_ROWS);
  const grid = normalizeGrid(headerRow.map((value) => value.trim()), limitedRows);
  return {
    name: sheetName,
    headers: grid.headers,
    rows: grid.rows,
    truncated: totalRows > SPREADSHEET_PREVIEW_MAX_ROWS,
    totalRows
  };
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function columnIndexFromRef(cellRef: string): number {
  const match = /^([A-Za-z]+)/.exec(cellRef);
  if (!match) return 0;
  let index = 0;
  for (const char of match[1].toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    decodeXml([...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((item) => item[1]).join(""))
  );
}

function parseSheetNames(workbookXml: string): string[] {
  return [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]+)"/g)].map((match) => decodeXml(match[1]));
}

function parseSheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const cells: string[] = [];
    let maxCol = -1;
    for (const cellMatch of rowMatch[1].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = /\br="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const col = ref ? columnIndexFromRef(ref) : maxCol + 1;
      if (col >= SPREADSHEET_PREVIEW_MAX_COLS) continue;
      let value = "";
      if (type === "inlineStr") {
        value = decodeXml([...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((item) => item[1]).join(""));
      } else {
        const raw = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1] ?? "";
        value = type === "s" ? (sharedStrings[Number(raw)] ?? "") : decodeXml(raw);
      }
      while (cells.length <= col) cells.push("");
      cells[col] = value;
      maxCol = Math.max(maxCol, col);
    }
    rows.push(cells.slice(0, SPREADSHEET_PREVIEW_MAX_COLS));
  }
  return rows;
}

/**
 * Parse XLSX via JSZip + OOXML XML (not ExcelJS).
 * ExcelJS `xlsx.load()` builds readable-stream PassThroughs and `for await`s them in
 * parse-sax; that throws "iterable is not async iterable" in packaged Electron.
 */
async function parseXlsx(buffer: Buffer): Promise<SpreadsheetPreviewData> {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) {
    throw new Error("无效的 .xlsx 文件（缺少 workbook.xml）。");
  }
  const sheetNames = parseSheetNames(workbookXml);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string") ?? "";
  const sharedStrings = parseSharedStrings(sharedXml);
  const sheetPaths = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .slice(0, SPREADSHEET_PREVIEW_MAX_SHEETS);

  const sheets: SpreadsheetPreviewSheet[] = [];
  for (const [sheetIndex, sheetPath] of sheetPaths.entries()) {
    const xml = await zip.file(sheetPath)?.async("string") ?? "";
    const allRows = parseSheetRows(xml, sharedStrings);
    if (!allRows.length) {
      sheets.push({
        name: sheetNames[sheetIndex] || `Sheet${sheetIndex + 1}`,
        headers: [],
        rows: [],
        truncated: false,
        totalRows: 0
      });
      continue;
    }
    const [headerRow, ...bodyRows] = allRows;
    const totalRows = bodyRows.length;
    const limitedRows = bodyRows.slice(0, SPREADSHEET_PREVIEW_MAX_ROWS);
    const headerValues = headerRow.map((value) => value.trim());
    const hasHeaders = headerValues.some((value) => value !== "");
    const grid = normalizeGrid(
      hasHeaders ? headerValues : limitedRows[0]?.map((_, index) => `列 ${index + 1}`) ?? [],
      hasHeaders ? limitedRows : limitedRows.slice(1)
    );
    sheets.push({
      name: sheetNames[sheetIndex] || `Sheet${sheetIndex + 1}`,
      headers: grid.headers,
      rows: grid.rows,
      truncated: totalRows > SPREADSHEET_PREVIEW_MAX_ROWS,
      totalRows: hasHeaders ? totalRows : Math.max(0, totalRows - 1)
    });
  }

  if (!sheets.length) {
    return { sheets: [{ name: "Sheet1", headers: [], rows: [], truncated: false, totalRows: 0 }] };
  }
  return { sheets };
}

export async function buildSpreadsheetPreview(buffer: Buffer, extension: string): Promise<SpreadsheetPreviewData> {
  const normalized = extension.toLowerCase();
  if (normalized === ".csv") return { sheets: [parseDelimited(buffer, ",", "CSV")] };
  if (normalized === ".tsv") return { sheets: [parseDelimited(buffer, "\t", "TSV")] };
  if (normalized === ".xlsx") return parseXlsx(buffer);
  if (normalized === ".xls") throw new Error("不支持旧版 .xls 格式，请转换为 .xlsx 或 .csv。");
  throw new Error("不支持的表格格式。");
}
