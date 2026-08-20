import { createHash } from "node:crypto";

export interface DataAnalysisResult { datasetId: string; operation: "summary"; inputHash: string; rowCount: number; columns: Array<{ key: string; count: number; min: number | null; max: number | null; mean: number | null }>; createdAt: string; }

export function summarizeNumericColumns(input: { datasetId: string; contentHash: string; columns: Array<{ key: string; type: string }>; rows: string[][]; createdAt: string }): DataAnalysisResult {
  const numeric = input.columns.map((column, index) => ({ column, index })).filter(({ column }) => column.type === "number");
  const columns = numeric.map(({ column, index }) => {
    const values = input.rows.map((row) => Number(row[index])).filter((value) => Number.isFinite(value));
    return { key: column.key, count: values.length, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, mean: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(8)) : null };
  });
  const inputHash = createHash("sha256").update(JSON.stringify({ datasetId: input.datasetId, contentHash: input.contentHash, columns, rowCount: input.rows.length })).digest("hex");
  return { datasetId: input.datasetId, operation: "summary", inputHash, rowCount: input.rows.length, columns, createdAt: input.createdAt };
}
