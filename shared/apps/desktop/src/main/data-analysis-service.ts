import { createHash } from "node:crypto";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.ts";
import type { DataImportService } from "./data-import-service.ts";

export interface DataAnalysisResult { datasetId: string; operation: "summary"; inputHash: string; rowCount: number; columns: Array<{ key: string; count: number; missingCount: number; min: number | null; max: number | null; mean: number | null; median: number | null; standardDeviation: number | null }>; createdAt: string; }

export function summarizeNumericColumns(input: { datasetId: string; contentHash: string; columns: Array<{ key: string; type: string }>; rows: string[][]; createdAt: string }): DataAnalysisResult {
  const numeric = input.columns.map((column, index) => ({ column, index })).filter(({ column }) => column.type === "number");
  const columns = numeric.map(({ column, index }) => {
    const values = input.rows.map((row) => Number(row[index])).filter((value) => Number.isFinite(value));
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const ordered = [...values].sort((a, b) => a - b);
    const median = ordered.length ? (ordered.length % 2 ? ordered[(ordered.length - 1) / 2] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2) : null;
    const variance = mean === null || values.length < 2 ? null : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    return { key: column.key, count: values.length, missingCount: input.rows.length - values.length, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, mean: mean === null ? null : Number(mean.toFixed(8)), median: median === null ? null : Number(median.toFixed(8)), standardDeviation: variance === null ? null : Number(Math.sqrt(variance).toFixed(8)) };
  });
  const inputHash = createHash("sha256").update(JSON.stringify({ datasetId: input.datasetId, contentHash: input.contentHash, columns, rowCount: input.rows.length })).digest("hex");
  return { datasetId: input.datasetId, operation: "summary", inputHash, rowCount: input.rows.length, columns, createdAt: input.createdAt };
}

export class DataAnalysisService {
  private readonly storage: BrainWorkspaceStorage;
  private readonly imports: DataImportService;
  constructor(storage: BrainWorkspaceStorage, imports: DataImportService) { this.storage = storage; this.imports = imports; }
  async summarize(ownerId: string, projectId: string, datasetId: string) {
    const dataset = this.storage.listDatasets(ownerId, projectId).find((item) => item.id === datasetId);
    if (!dataset) throw new Error("BRAIN_DATASET_NOT_FOUND");
    const rows = await this.imports.readRows(ownerId, { projectId, datasetId });
    const result = summarizeNumericColumns({ datasetId, contentHash: dataset.contentHash, columns: dataset.columns, rows, createdAt: new Date().toISOString() });
    return this.storage.saveDataAnalysis({ ownerId, projectId, datasetId, operation: result.operation, inputHash: result.inputHash, result, createdAt: result.createdAt });
  }
  list(ownerId: string, projectId: string, datasetId: string) { return this.storage.listDataAnalyses(ownerId, projectId, datasetId); }
}
