import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import type { BrainDataColumn, BrainDataColumnType } from "@codex-forge/protocol/data-types";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 1_000_000;

function infer(values: string[]): BrainDataColumnType {
  if (values.length && values.every((value) => value === "true" || value === "false")) return "boolean";
  if (values.length && values.every((value) => value !== "" && Number.isFinite(Number(value)))) return "number";
  if (values.length && values.every((value) => value.trim() !== "" && !Number.isNaN(Date.parse(value)))) return "date";
  return "string";
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "text" in value) return String((value as { text?: unknown }).text ?? "");
  return String(value);
}

export async function parseXlsxDataset(input: {
  id: string; projectId: string; name: string; sourceFileId?: string; content: Uint8Array; updatedAt: string; sheetName?: string;
}) {
  if (input.content.byteLength > MAX_BYTES) throw new Error("BRAIN_DATASET_FILE_TOO_LARGE");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.content));
  const sheet = input.sheetName ? workbook.getWorksheet(input.sheetName) : workbook.worksheets[0];
  if (!sheet) throw new Error("BRAIN_DATASET_EMPTY");
  const headerRow = sheet.getRow(1);
  const headerValues = headerRow.values as unknown as unknown[];
  const headers = headerValues.slice(1).map((value: unknown) => cellText(value).trim());
  if (!headers.length || headers.some((value) => !value)) throw new Error("BRAIN_DATASET_HEADER_INVALID");
  const rows: string[][] = [];
  for (let rowNumber = 2; rowNumber <= Math.min(sheet.rowCount, MAX_ROWS + 1); rowNumber += 1) {
    const rowValues = sheet.getRow(rowNumber).values as unknown as unknown[];
    const row = rowValues.slice(1).map((value: unknown) => cellText(value));
    if (row.every((value) => value.trim() === "")) continue;
    rows.push([...Array(headers.length)].map((_, index) => row[index] ?? ""));
  }
  if (sheet.rowCount - 1 > MAX_ROWS) throw new Error("BRAIN_DATASET_ROW_COUNT_INVALID");
  const columns: BrainDataColumn[] = headers.map((key: string, index: number) => ({ key, label: key, type: infer(rows.map((row) => row[index] ?? "")) }));
  return { schemaVersion: 1 as const, id: input.id, projectId: input.projectId, name: input.name, columns,
    rowCount: rows.length, sourceFileId: input.sourceFileId, sourceSheet: sheet.name, contentHash: createHash("sha256").update(input.content).digest("hex"), updatedAt: input.updatedAt, rows };
}

export async function listXlsxSheets(content: Uint8Array): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(content));
  return workbook.worksheets.map((sheet) => sheet.name);
}
