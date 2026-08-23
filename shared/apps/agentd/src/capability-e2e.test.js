import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { createBuiltinCapabilityRuntime } from "./tool-registry.js";

test("user-level spreadsheet task completes through capability runtime", async (t) => {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "brain-e2e-"));
  t.after(() => fs.rm(workspacePath, { recursive: true, force: true }));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sales");
  sheet.addRows([["Region", "Amount"], ["North", 100], ["South", 80]]);
  await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });
  await workbook.xlsx.writeFile(path.join(workspacePath, "sales.xlsx"));

  const runtime = createBuiltinCapabilityRuntime(undefined, { policy: { requestApproval: async () => ({ allowed: true }) } });
  const result = await runtime.invoke("spreadsheet.update", {
    targetPath: "sales.xlsx",
    outputPath: "outputs/sales-updated.xlsx",
    operations: [{ type: "set_cell", sheet: "Sales", cell: "B2", value: 120 }]
  }, { approved: true, workspacePath });

  assert.equal(result.status, "completed");
  assert.equal(result.verification.status, "verified");
  assert.equal(result.output.artifact.format, "xlsx");
  const check = new ExcelJS.Workbook();
  await check.xlsx.readFile(path.join(workspacePath, "outputs/sales-updated.xlsx"));
  assert.equal(check.getWorksheet("Sales").getCell("B2").value, 120);
});
