/** BRAIN Data Runtime v1 — analysis editor protocol contract. */

export const BRAIN_DATA_RUNTIME_VERSION = "brain-data-runtime-v1" as const;

export const brainDataCoreOperations = {
  analysisGet: "data.analysis_get",
  analysisSave: "data.analysis_save",
  cook: "data.cook"
} as const;

export type BrainDataCoreOperation =
  (typeof brainDataCoreOperations)[keyof typeof brainDataCoreOperations];

export interface BrainDataRegionRow {
  region: string;
  yoy: number;
  height: number;
}

export interface BrainDataAnalysisState {
  schemaVersion?: number;
  pipeline?: typeof BRAIN_DATA_RUNTIME_VERSION;
  fileName: string;
  rows: unknown[];
  insight: string;
  regionRows: BrainDataRegionRow[];
  analyzing: boolean;
}

export interface BrainDataAnalysisSavePayload {
  state: BrainDataAnalysisState;
}

export function requiresDataCoreApproval(operation: BrainDataCoreOperation): boolean {
  return operation !== brainDataCoreOperations.analysisGet;
}
