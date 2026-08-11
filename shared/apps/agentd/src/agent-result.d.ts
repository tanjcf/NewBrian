export interface AgentModelUsage {
  requestedModel: string;
  selectedModel: string;
  selectedModels: string[];
  routingReasons: string[];
}

export interface StructuredAgentResult {
  schemaVersion: 1;
  status: "completed" | "partial";
  role: string;
  summary: string;
  content: string;
  findings: Array<{ summary: string; confidence: number }>;
  evidenceRefs: string[];
  artifacts: unknown[];
  changedFiles: unknown[];
  tests: unknown[];
  unresolvedQuestions: string[];
  qualityGates: Array<{ id: string; status: "passed" | "failed" | "not_required"; detail: string }>;
  worktree: null | { repositoryRoot: string; worktreePath: string; branch: string; baseRef: string };
  contextCapsule: unknown;
  /** Models actually used by this child agent (Auto may resolve away from requestedModel). */
  modelUsage: AgentModelUsage | null;
}

export function createStructuredAgentResult(input: Record<string, unknown>): StructuredAgentResult;
export function synthesizeAgentResults(results: StructuredAgentResult[]): Record<string, unknown>;
