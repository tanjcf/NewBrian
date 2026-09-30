import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { analyzeSpreadsheet, inspectSpreadsheet, updateSpreadsheet, verifySpreadsheetArtifact } from "./spreadsheet-workbook.js";

test("reads, analyzes, and edits a real workbook without losing formulas", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-sheet-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source.xlsx");
  const output = path.join(root, "output.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sales");
  sheet.addRows([["Region", "Amount", "Tax"], ["North", 100, { formula: "B2*0.1", result: 10 }], ["North", 50, { formula: "B3*0.1", result: 5 }], ["South", 80, { formula: "B4*0.1", result: 8 }]]);
  sheet.getCell("A1").font = { bold: true };
  await workbook.xlsx.writeFile(source);

  const inspected = await inspectSpreadsheet(source);
  assert.deepEqual(inspected.sheets[0].rows[1][2], { formula: "B2*0.1", result: 10 });
  const analyzed = await analyzeSpreadsheet(source, { sheet: "Sales", groupBy: ["Region"], metrics: [{ column: "Amount", operation: "sum", as: "total" }] });
  assert.deepEqual(analyzed.groups, [{ Region: "North", count: 2, total: 150 }, { Region: "South", count: 1, total: 80 }]);
  await updateSpreadsheet(source, output, [{ type: "set_cell", sheet: "Sales", cell: "B2", value: 120 }]);
  const evidence = await verifySpreadsheetArtifact(output, { requiredSheets: ["Sales"] });
  assert.equal(evidence.reopened, true);
  assert.equal(evidence.sheetCount, 1);
  assert.equal(evidence.sheets[0].formulaCount, 3);
  const changed = new ExcelJS.Workbook();
  await changed.xlsx.readFile(output);
  assert.equal(changed.getWorksheet("Sales").getCell("B2").value, 120);
  assert.deepEqual(changed.getWorksheet("Sales").getCell("C3").value, { formula: "B3*0.1", result: 5 });
  assert.equal(changed.getWorksheet("Sales").getCell("A1").font.bold, true);
});
