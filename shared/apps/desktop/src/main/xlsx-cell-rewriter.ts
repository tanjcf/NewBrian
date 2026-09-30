import ExcelJS from "exceljs";

export async function replaceXlsxCell(input: {
  bytes: Buffer;
  sheet: string;
  cell: string;
  value: string | number | boolean | null;
}): Promise<Buffer> {
  if (!input.sheet.trim() || !/^[A-Za-z]{1,3}[1-9][0-9]{0,6}$/.test(input.cell)) {
    throw new Error("BRAIN_XLSX_CELL_INVALID");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input.bytes);
  const worksheet = workbook.getWorksheet(input.sheet);
  if (!worksheet) throw new Error("BRAIN_XLSX_SHEET_NOT_FOUND");
  worksheet.getCell(input.cell).value = input.value;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
