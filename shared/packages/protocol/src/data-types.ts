export type BrainDataColumnType = "string" | "number" | "boolean" | "date";
export interface BrainDataColumn { key: string; label: string; type: BrainDataColumnType; }
export interface BrainDataset { schemaVersion: 1; id: string; projectId: string; name: string; columns: BrainDataColumn[]; rowCount: number; sourceFileId?: string; sourceSheet?: string; contentHash: string; updatedAt: string; }
export interface BrainDataTableView { datasetId: string; columns: string[]; sort?: { key: string; direction: "asc" | "desc" }; filters?: Array<{ key: string; operator: "eq" | "contains" | "gt" | "lt"; value: string | number | boolean }>; page: number; pageSize: number; }
export interface BrainDataChartSpec { datasetId: string; type: "line" | "bar" | "scatter" | "pie"; xKey: string; yKeys: string[]; title: string; }
export interface BrainAnalysisArtifact { schemaVersion: 1; id: string; projectId: string; datasetIds: string[]; operation: string; parameters: Record<string, unknown>; resultHash: string; reproducibilityJson: string; createdAt: string; }
