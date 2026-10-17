/**
 * XLSX-CHINESE-PREVIEW-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Opening an xlsx in BRAIN must show Chinese, not numeric character references.
 */
import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { buildSpreadsheetPreview } from "./spreadsheet-preview.ts";

const CASE_ID = "XLSX-CHINESE-PREVIEW-SMOKE-001";

async function xlsxWithSharedStrings(sharedStringsXml: string, sheetXml: string) {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="&#30149;&#21382;" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file("xl/sharedStrings.xml", sharedStringsXml);
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

test(`${CASE_ID} shows 右侧基底节脑出血 instead of numeric character references`, async () => {
  const buffer = await xlsxWithSharedStrings(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>&#35786;&#26029;</t></si>
  <si><t>1&#12289;&#21491;&#20391;&#22522;&#24213;&#33410;&#33041;&#20986;&#34880;</t></si>
</sst>`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c></row>
  </sheetData>
</worksheet>`
  );
  const preview = await buildSpreadsheetPreview(buffer, ".xlsx");
  assert.equal(preview.sheets[0].name, "病历");
  assert.deepEqual(preview.sheets[0].headers, ["诊断"]);
  assert.deepEqual(preview.sheets[0].rows, [["1、右侧基底节脑出血"]]);
  assert.doesNotMatch(preview.sheets[0].rows[0][0], /&#\d+;/);
});
