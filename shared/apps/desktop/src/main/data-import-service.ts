import { parseCsvDataset } from "./data-csv-parser.ts";
import { normalizeDataset } from "./data-dataset-policy.ts";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export class DataImportService {
  private readonly storage: BrainWorkspaceStorage;
  private readonly resolveWorkspaceRoot: (workspaceId: string) => Promise<string>;
  constructor(storage: BrainWorkspaceStorage, resolveWorkspaceRoot: (workspaceId: string) => Promise<string>) { this.storage = storage; this.resolveWorkspaceRoot = resolveWorkspaceRoot; }
  async importCsv(ownerId: string, input: { projectId: string; fileId: string; datasetId: string; name: string; updatedAt: string }) {
    const project = this.storage.getProject(ownerId, input.projectId); if (project.primaryWorkspaceKey !== "data") throw new Error("BRAIN_DATA_WORKSPACE_REQUIRED"); if (!project.localWorkspaceId) throw new Error("BRAIN_LOCAL_WORKSPACE_REQUIRED");
    const file = this.storage.getFile(ownerId, input.projectId, input.fileId); const root = await realpath(await this.resolveWorkspaceRoot(project.localWorkspaceId));
    if (isAbsolute(file.storageKey)) throw new Error("BRAIN_DATASET_PATH_OUTSIDE_PROJECT");
    const path = await realpath(resolve(root, file.storageKey)); const rel = relative(root, path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel) || !(await stat(path)).isFile()) throw new Error("BRAIN_DATASET_PATH_OUTSIDE_PROJECT");
    const content = await readFile(path); const parsed = parseCsvDataset({ id: input.datasetId, projectId: input.projectId, name: input.name, sourceFileId: input.fileId, content, updatedAt: input.updatedAt });
    const dataset = normalizeDataset(parsed); this.storage.saveDataset({ ownerId, dataset }); return { dataset, rows: parsed.rows };
  }
}
