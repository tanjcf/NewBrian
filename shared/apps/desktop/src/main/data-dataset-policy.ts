import type { BrainDataColumn, BrainDataset } from "@codex-forge/protocol/data-types";

const MAX_COLUMNS = 256;
const MAX_ROWS = 1_000_000;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function normalizeDataset(input: { id: string; projectId: string; name: string; columns: BrainDataColumn[]; rowCount: number; sourceFileId?: string; sourceSheet?: string; contentHash: string; updatedAt: string }): BrainDataset {
  if (!input.id.trim() || !input.projectId.trim() || !input.name.trim()) throw new Error("BRAIN_DATASET_IDENTITY_INVALID");
  if (!Array.isArray(input.columns) || input.columns.length === 0 || input.columns.length > MAX_COLUMNS) throw new Error("BRAIN_DATASET_COLUMNS_INVALID");
  const seen = new Set<string>();
  const columns = input.columns.map((column) => {
    if (!KEY.test(column.key) || !column.label.trim() || !["string", "number", "boolean", "date"].includes(column.type) || seen.has(column.key)) throw new Error("BRAIN_DATASET_COLUMN_INVALID");
    seen.add(column.key); return { key: column.key, label: column.label.trim(), type: column.type };
  });
  if (!Number.isInteger(input.rowCount) || input.rowCount < 0 || input.rowCount > MAX_ROWS) throw new Error("BRAIN_DATASET_ROW_COUNT_INVALID");
  if (!/^[a-f0-9]{64}$/i.test(input.contentHash)) throw new Error("BRAIN_DATASET_HASH_INVALID");
  return { schemaVersion: 1, id: input.id.trim(), projectId: input.projectId.trim(), name: input.name.trim(), columns, rowCount: input.rowCount, sourceFileId: input.sourceFileId?.trim() || undefined, sourceSheet: input.sourceSheet?.trim() || undefined, contentHash: input.contentHash.toLowerCase(), updatedAt: input.updatedAt };
}
