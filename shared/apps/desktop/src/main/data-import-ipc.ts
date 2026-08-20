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
}
