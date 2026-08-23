import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { listXlsxSheets, parseXlsxDataset } from "./data-xlsx-parser.ts";

test("parses the first XLSX sheet into bounded typed rows", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("数据");
  sheet.addRow(["symbol", "close", "active"]);
  sheet.addRow(["600519", 1500, true]);
  sheet.addRow(["000001", 12, false]);
  const second = workbook.addWorksheet("汇总");
  second.addRow(["name", "value"]);
  second.addRow(["利润", 88]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  assert.deepEqual(await listXlsxSheets(bytes), ["数据", "汇总"]);
  const result = await parseXlsxDataset({ id: "d", projectId: "p", name: "行情", content: bytes, updatedAt: "now", sheetName: "数据" });
  assert.deepEqual(result.columns.map((column) => column.type), ["number", "number", "boolean"]);
  assert.deepEqual(result.rows[0], ["600519", "1500", "true"]);
  assert.equal(result.rowCount, 2);
  assert.equal(result.contentHash.length, 64);
  assert.equal(result.sourceSheet, "数据");
  const summary = await parseXlsxDataset({ id: "s", projectId: "p", name: "汇总", content: bytes, updatedAt: "now", sheetName: "汇总" });
  assert.deepEqual(summary.rows, [["利润", "88"]]);
});
