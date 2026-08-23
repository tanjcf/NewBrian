import { ipcMain } from "electron";
import { brainWorkspaceIpcChannels } from "@codex-forge/protocol";
import type { DataImportService } from "./data-import-service.ts";
export function registerDataImportIpc(input: { dataImport?: DataImportService; resolveOwnerId: () => Promise<string> | string }) {
  if (!input.dataImport) return;
  const service = input.dataImport;
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetImportCsv, async (_event, value: any) => {
    const required = ["projectId", "fileId", "datasetId", "name", "updatedAt"];
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !required.includes(key))) throw new TypeError("Dataset import payload is invalid.");
    for (const key of required) if (typeof value[key] !== "string" || !value[key].trim()) throw new TypeError(`${key} must be a non-empty string.`);
    return service.importCsv(await input.resolveOwnerId(), value);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetImportXlsx, async (_event, value: any) => {
    const required = ["projectId", "fileId", "datasetId", "name", "updatedAt"];
    const allowed = [...required, "sheetName"];
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError("Dataset import payload is invalid.");
    for (const key of required) if (typeof value[key] !== "string" || !value[key].trim()) throw new TypeError(`${key} must be a non-empty string.`);
    if (value.sheetName !== undefined && (typeof value.sheetName !== "string" || !value.sheetName.trim())) throw new TypeError("sheetName must be a non-empty string.");
    return service.importXlsx(await input.resolveOwnerId(), value);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetXlsxSheets, async (_event, value: any) => {
    if (!value || typeof value.projectId !== "string" || typeof value.fileId !== "string") throw new TypeError("XLSX sheets payload is invalid.");
    return service.listXlsxSheets(await input.resolveOwnerId(), value);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.dataDatasetRows, async (_event, value: any) => { if (!value || typeof value.projectId !== "string" || typeof value.datasetId !== "string") throw new TypeError("Dataset rows payload is invalid."); return service.readRows(await input.resolveOwnerId(), { projectId: value.projectId, datasetId: value.datasetId }); });
}
