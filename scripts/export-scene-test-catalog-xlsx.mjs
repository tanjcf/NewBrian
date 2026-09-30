/**
 * Export seven-scene operation catalogs to XLSX.
 * Usage: node scripts/export-scene-test-catalog-xlsx.mjs [outputPath]
 */
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogDir = join(root, "docs/evidence/scene-tests/catalog");
const defaultOut = join(root, "docs/evidence/scene-tests/seven-scene-operations-1224.xlsx");
const scenes = ["quant", "game", "video", "music", "data", "software", "document"];

const HEADERS = ["序号", "场景", "场景名", "opId", "操作名", "前置", "步骤", "预期", "自动化", "阻断"];

async function loadExcelJS() {
  const candidates = [
    join(root, "platforms/windows/apps/desktop/node_modules/exceljs/excel.js"),
    join(root, "node_modules/exceljs/excel.js")
  ];
  for (const candidate of candidates) {
    try {
      const mod = await import(pathToFileURL(candidate).href);
      return mod.default ?? mod;
    } catch {
      // try next
    }
  }
  throw new Error("exceljs not found; run pnpm install in platforms/windows/apps/desktop");
}

function rowFromOp(op, index, scene, displayName) {
  const steps = Array.isArray(op.steps) ? op.steps.join(" → ") : String(op.steps ?? "");
  return [
    index + 1,
    scene,
    displayName,
    op.opId,
    op.title,
    op.precondition,
    steps,
    op.expected,
    op.automation,
    op.blocking ? "是" : "否"
  ];
}

function styleHeaderRow(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E79" }
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 22;
}

function styleDataSheet(sheet) {
  styleHeaderRow(sheet);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: HEADERS.length }
  };
  const widths = [6, 10, 12, 28, 24, 18, 36, 36, 10, 6];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
}

async function main() {
  const outPath = resolve(process.argv[2] ?? defaultOut);
  await mkdir(dirname(outPath), { recursive: true });

  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BRAIN scene-test catalog";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("汇总", {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  summarySheet.columns = [
    { header: "场景 key", key: "scene", width: 12 },
    { header: "场景名", key: "displayName", width: 14 },
    { header: "条数", key: "count", width: 8 },
    { header: "L0", key: "l0", width: 6 },
    { header: "L1", key: "l1", width: 6 },
    { header: "L2", key: "l2", width: 6 },
    { header: "L3", key: "l3", width: 6 },
    { header: "阻断条数", key: "blocking", width: 10 }
  ];
  styleHeaderRow(summarySheet);

  const allSheet = workbook.addWorksheet("全部1224条");
  allSheet.addRow(HEADERS);
  styleDataSheet(allSheet);

  let grandTotal = 0;
  let grandBlocking = 0;

  for (const scene of scenes) {
    const jsonPath = join(catalogDir, `${scene}.json`);
    const catalog = JSON.parse(await readFile(jsonPath, "utf8"));
    const { displayName, operations, layers, totalOperations } = catalog;
    const blockingCount = operations.filter((op) => op.blocking).length;

    summarySheet.addRow({
      scene,
      displayName,
      count: totalOperations,
      l0: layers?.L0 ?? "",
      l1: layers?.L1 ?? "",
      l2: layers?.L2 ?? "",
      l3: layers?.L3 ?? "",
      blocking: blockingCount
    });

    const sheet = workbook.addWorksheet(displayName, {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    sheet.addRow(HEADERS);
    styleDataSheet(sheet);

    operations.forEach((op, i) => {
      const row = rowFromOp(op, i, scene, displayName);
      sheet.addRow(row);
      allSheet.addRow(row);
    });

    grandTotal += operations.length;
    grandBlocking += blockingCount;
  }

  summarySheet.addRow({});
  summarySheet.addRow({
    scene: "合计",
    displayName: `${scenes.length} 个场景`,
    count: grandTotal,
    blocking: grandBlocking
  });

  await workbook.xlsx.writeFile(outPath);
  console.log(`Wrote ${grandTotal} operations to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
