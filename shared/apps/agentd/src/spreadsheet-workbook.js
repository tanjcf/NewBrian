import ExcelJS from "exceljs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function valueOf(cell, formulas = true) {
  const value = cell.value;
  if (value && typeof value === "object" && "formula" in value) return formulas ? { formula: value.formula, result: value.result ?? null } : value.result ?? null;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "richText" in value) return value.richText.map((item) => item.text).join("");
  return value ?? null;
}

async function load(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

export async function inspectSpreadsheet(filePath, options = {}) {
  const workbook = await load(filePath);
  const maxRows = Math.max(1, Math.min(5000, Number(options.maxRows) || 200));
  const maxColumns = Math.max(1, Math.min(500, Number(options.maxColumns) || 100));
  const requested = Array.isArray(options.sheetNames) && options.sheetNames.length ? options.sheetNames.map(String) : workbook.worksheets.map((sheet) => sheet.name);
  const sheets = requested.map((name) => {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) throw new Error(`Worksheet not found: ${name}`);
    const rowCount = sheet.actualRowCount || sheet.rowCount;
    const columnCount = sheet.actualColumnCount || sheet.columnCount;
    const rows = [];
    for (let row = 1; row <= Math.min(rowCount, maxRows); row += 1) {
      rows.push(Array.from({ length: Math.min(columnCount, maxColumns) }, (_, column) => valueOf(sheet.getCell(row, column + 1), options.includeFormulas !== false)));
    }
    return { name, rowCount, columnCount, truncated: rowCount > maxRows || columnCount > maxColumns, rows };
  });
  const stat = await fs.stat(filePath);
  return { file: path.basename(filePath), size: stat.size, sheetCount: workbook.worksheets.length, sheets };
}

function numberValue(value) {
  const parsed = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export async function analyzeSpreadsheet(filePath, input = {}) {
  const data = await inspectSpreadsheet(filePath, { sheetNames: input.sheet ? [input.sheet] : undefined, maxRows: input.maxRows || 5000, maxColumns: 500, includeFormulas: false });
  const sheet = data.sheets[0];
  if (!sheet?.rows.length) throw new Error("Spreadsheet contains no analyzable rows.");
  const headerRow = Math.max(1, Number(input.headerRow) || 1);
  const headers = sheet.rows[headerRow - 1].map((value, index) => String(value ?? "").trim() || `Column${index + 1}`);
  const indexes = new Map(headers.map((header, index) => [header, index]));
  const groupBy = (input.groupBy || []).map(String);
  const metrics = input.metrics || [];
  for (const name of [...groupBy, ...metrics.map((metric) => String(metric.column))]) if (!indexes.has(name)) throw new Error(`Column not found: ${name}`);
  const groups = new Map();
  for (const row of sheet.rows.slice(headerRow)) {
    if (row.every((value) => value === null || value === "")) continue;
    const keys = groupBy.map((name) => row[indexes.get(name)] ?? null);
    const id = JSON.stringify(keys);
    if (!groups.has(id)) groups.set(id, { keys, rows: [] });
    groups.get(id).rows.push(row);
  }
  return { sheet: sheet.name, headers, groups: [...groups.values()].map((group) => {
    const output = Object.fromEntries(groupBy.map((name, index) => [name, group.keys[index]]));
    output.count = group.rows.length;
    for (const metric of metrics) {
      const operation = String(metric.operation).toLowerCase();
      const values = group.rows.map((row) => numberValue(row[indexes.get(String(metric.column))])).filter((value) => value !== null);
      const name = metric.as || `${operation}_${metric.column}`;
      if (operation === "count") output[name] = values.length;
      else if (operation === "sum") output[name] = values.reduce((sum, value) => sum + value, 0);
      else if (operation === "avg") output[name] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      else if (operation === "min") output[name] = values.length ? Math.min(...values) : null;
      else if (operation === "max") output[name] = values.length ? Math.max(...values) : null;
      else throw new Error(`Unsupported operation: ${operation}`);
    }
    return output;
  }) };
}

export async function updateSpreadsheet(sourcePath, targetPath, operations) {
  const workbook = await load(sourcePath);
  for (const operation of operations) {
    const type = String(operation.type || "");
    if (type === "add_sheet") { workbook.addWorksheet(String(operation.name)); continue; }
    const sheet = workbook.getWorksheet(String(operation.sheet));
    if (!sheet) throw new Error(`Worksheet not found: ${operation.sheet}`);
    if (type === "set_cell") {
      const cell = sheet.getCell(String(operation.cell));
      cell.value = operation.formula ? { formula: String(operation.formula), result: operation.result } : operation.value ?? null;
      if (operation.numberFormat) cell.numFmt = String(operation.numberFormat);
      if (operation.style) cell.style = operation.style;
    } else if (type === "set_range") {
      const start = sheet.getCell(String(operation.start));
      (operation.values || []).forEach((row, rowOffset) => row.forEach((value, columnOffset) => { sheet.getCell(start.row + rowOffset, start.col + columnOffset).value = value; }));
    } else if (type === "append_rows") (operation.rows || []).forEach((row) => sheet.addRow(row));
    else if (type === "rename_sheet") sheet.name = String(operation.name);
    else if (type === "merge_cells") sheet.mergeCells(String(operation.range));
    else if (type === "set_column_width") sheet.getColumn(operation.column).width = Number(operation.width);
    else if (type === "freeze_panes") sheet.views = [{ state: "frozen", xSplit: Number(operation.columns) || 0, ySplit: Number(operation.rows) || 0 }];
    else if (type === "auto_filter") sheet.autoFilter = String(operation.range);
    else throw new Error(`Unsupported spreadsheet operation: ${type}`);
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await workbook.xlsx.writeFile(targetPath);
  return inspectSpreadsheet(targetPath, { maxRows: 20, maxColumns: 30 });
}

export async function verifySpreadsheetArtifact(filePath, expectations = {}) {
  const workbook = await load(filePath);
  const stat = await fs.stat(filePath);
  const buffer = await fs.readFile(filePath);
  const sheets = workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.actualRowCount || sheet.rowCount,
    columnCount: sheet.actualColumnCount || sheet.columnCount,
    formulaCount: countFormulas(sheet)
  }));
  const evidence = {
    reopened: true,
    fileSize: stat.size,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sheetCount: sheets.length,
    sheets
  };
  if (expectations.sheetCount !== undefined && sheets.length !== Number(expectations.sheetCount)) throw new Error("Spreadsheet sheet count verification failed.");
  if (expectations.requiredSheets && expectations.requiredSheets.some((name) => !sheets.some((sheet) => sheet.name === name))) throw new Error("Spreadsheet required sheet verification failed.");
  return evidence;
}

function countFormulas(sheet) {
  let count = 0;
  sheet.eachRow((row) => row.eachCell((cell) => { if (cell.value && typeof cell.value === "object" && "formula" in cell.value) count += 1; }));
  return count;
}
