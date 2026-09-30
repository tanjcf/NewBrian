import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildSpreadsheetPreview } from "./spreadsheet-preview.ts";

test("buildSpreadsheetPreview parses CSV into a bounded grid", async () => {
  const csv = Buffer.from("name,value\nAlpha,1\nBeta,2\n", "utf8");
  const preview = await buildSpreadsheetPreview(csv, ".csv");
  assert.equal(preview.sheets.length, 1);
  assert.deepEqual(preview.sheets[0].headers, ["name", "value"]);
  assert.deepEqual(preview.sheets[0].rows, [["Alpha", "1"], ["Beta", "2"]]);
});

test("buildSpreadsheetPreview parses XLSX worksheets", async () => {
  const root = await mkdtemp(join(tmpdir(), "spreadsheet-preview-"));
  const filePath = join(root, "model.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Revenue");
  sheet.addRow(["Region", "Amount"]);
  sheet.addRow(["East", 120]);
  sheet.addRow(["West", 80]);
  await workbook.xlsx.writeFile(filePath);
  const preview = await buildSpreadsheetPreview(await readFile(filePath), ".xlsx");
  assert.equal(preview.sheets[0].name, "Revenue");
  assert.deepEqual(preview.sheets[0].headers, ["Region", "Amount"]);
  assert.deepEqual(preview.sheets[0].rows, [["East", "120"], ["West", "80"]]);
});

test("buildSpreadsheetPreview rejects legacy XLS", async () => {
  await assert.rejects(
    buildSpreadsheetPreview(Buffer.from("legacy"), ".xls"),
    /不支持旧版 \.xls/
  );
});

test("buildSpreadsheetPreview parses sparse XLSX cells via JSZip path", async () => {
  const root = await mkdtemp(join(tmpdir(), "spreadsheet-preview-sparse-"));
  const filePath = join(root, "sparse.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sparse");
  sheet.getCell("A1").value = "A";
  sheet.getCell("C1").value = "C";
  sheet.getCell("A2").value = "1";
  sheet.getCell("C2").value = "3";
  await workbook.xlsx.writeFile(filePath);
  const preview = await buildSpreadsheetPreview(await readFile(filePath), ".xlsx");
  assert.equal(preview.sheets[0].name, "Sparse");
  assert.deepEqual(preview.sheets[0].headers, ["A", "列 2", "C"]);
  assert.deepEqual(preview.sheets[0].rows, [["1", "", "3"]]);
});
