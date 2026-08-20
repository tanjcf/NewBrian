import { parseCsvDataset } from "./data-csv-parser.ts";
import { normalizeDataset } from "./data-dataset-policy.ts";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

export class DataImportService {
  private readonly storage: BrainWorkspaceStorage;
  private readonly resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  constructor(storage: BrainWorkspaceStorage, resolveWorkspaceRoot: (workspaceId: string) => Promise<string>) { this.storage = storage; this.resolveWorkspaceRoot = resolveWorkspaceRoot; }
  async importCsv(ownerId: string, input: { projectId: string; fileId: string; datasetId: string; name: string; updatedAt: string }) {
    const project = this.storage.getProject(ownerId, input.projectId); if (project.primaryWorkspaceKey !== "data") throw new Error("BRAIN_DATA_WORKSPACE_REQUIRED"); if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const file = this.storage.getFile(ownerId, input.projectId, input.fileId); const root = await this.resolveWorkspaceRoot(project.localWorkspaceId); const path = `${root}/${file.storageKey.replaceAll("\\", "/")}`;
    const content = await import("node:fs/promises").then((fs) => fs.readFile(path)); const parsed = parseCsvDataset({ id: input.datasetId, projectId: input.projectId, name: input.name, sourceFileId: input.fileId, content, updatedAt: input.updatedAt });
    const dataset = normalizeDataset(parsed); this.storage.saveDataset({ ownerId, dataset }); return { dataset, rows: parsed.rows };
  }
}
