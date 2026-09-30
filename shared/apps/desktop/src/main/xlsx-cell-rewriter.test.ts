import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import test from "node:test";
import { replaceXlsxCell } from "./xlsx-cell-rewriter.ts";

async function fixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("数据");
  sheet.getCell("B2").value = "旧值";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("replaces an XLSX cell while preserving the workbook", async () => {
  const output = await replaceXlsxCell({ bytes: await fixture(), sheet: "数据", cell: "B2", value: "新值" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output);
  assert.equal(workbook.getWorksheet("数据")!.getCell("B2").value, "新值");
});

test("rejects missing sheets and unsafe cell references", async () => {
  const bytes = await fixture();
  await assert.rejects(() => replaceXlsxCell({ bytes, sheet: "不存在", cell: "B2", value: "x" }), /BRAIN_XLSX_SHEET_NOT_FOUND/);
  await assert.rejects(() => replaceXlsxCell({ bytes, sheet: "数据", cell: "A1;DROP", value: "x" }), /BRAIN_XLSX_CELL_INVALID/);
});
