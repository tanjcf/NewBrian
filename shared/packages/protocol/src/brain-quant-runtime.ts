/**
 * BRAIN Quant Runtime v1 — protocol contract (quant scene sub-architecture).
 * Architecture: docs/architecture/brain-quant-runtime-v1.md
 */

export const BRAIN_QUANT_RUNTIME_VERSION = "brain-quant-runtime-v1" as const;

export const brainQuantCoreOperations = {
  health: "quant.health",
  inspect: "quant.inspect",
  cook: "quant.cook",
  backtestRun: "quant.backtest.run",
  sessionExport: "quant.session.export",
  reportGenerate: "quant.report.generate"
} as const;

export type BrainQuantCoreOperation =
  (typeof brainQuantCoreOperations)[keyof typeof brainQuantCoreOperations];

export const brainQuantDesignSectionKeys = ["research"] as const;
export type BrainQuantDesignSectionKey = (typeof brainQuantDesignSectionKeys)[number];

export const brainQuantCookedPaths = {
  metaDir: ".brain-quant",
  manifestFile: ".brain-quant/manifest.json",
  sessionFile: ".brain-quant/session.json",
  docsRoot: "Docs/BRAIN",
  researchDoc: "Docs/BRAIN/research.md",
  hypothesisDoc: "Docs/BRAIN/hypothesis.json",
  backtestReport: "Docs/BRAIN/backtest-report.json",
  dataDir: "data/bars",
  strategiesDir: "strategies"
} as const;

export interface BrainQuantCookPayload {
  sections: Array<{ sectionKey: string; content: string; revision: number }>;
}

export interface BrainQuantCookResult {
  pipeline: typeof BRAIN_QUANT_RUNTIME_VERSION;
  docsRoot: string;
  exportedFiles: string[];
  manifestPath: string;
}

export function requiresQuantCoreApproval(operation: BrainQuantCoreOperation): boolean {
  return operation !== brainQuantCoreOperations.health
    && operation !== brainQuantCoreOperations.inspect
    && operation !== brainQuantCoreOperations.reportGenerate;
}
