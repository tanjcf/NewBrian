export type BrainRetentionClass = "projectMetadata" | "cache" | "artifacts" | "diagnostics";

export interface BrainRetentionBudget {
  maxCount: number;
  maxAgeMs: number;
}

/** Separate retention budgets for project metadata, disposable cache, artifacts, and diagnostics. */
export const DEFAULT_BRAIN_RETENTION: Record<BrainRetentionClass, BrainRetentionBudget> = {
  projectMetadata: { maxCount: 5_000, maxAgeMs: 180 * 24 * 60 * 60 * 1_000 },
  cache: { maxCount: 2_000, maxAgeMs: 14 * 24 * 60 * 60 * 1_000 },
  artifacts: { maxCount: 1_000, maxAgeMs: 90 * 24 * 60 * 60 * 1_000 },
  diagnostics: { maxCount: 200, maxAgeMs: 30 * 24 * 60 * 60 * 1_000 }
};

export interface RetentionCandidate {
  id: string;
  createdAt: string;
}

export function selectRetentionVictims(
  candidates: RetentionCandidate[],
  budget: BrainRetentionBudget,
  nowMs = Date.now()
): string[] {
  const sorted = [...candidates].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const expired = sorted.filter((item) => {
    const created = Date.parse(item.createdAt);
    return Number.isFinite(created) && nowMs - created > budget.maxAgeMs;
  });
  const remaining = sorted.filter((item) => !expired.some((victim) => victim.id === item.id));
  const overflow = remaining.length > budget.maxCount
    ? remaining.slice(0, remaining.length - budget.maxCount)
    : [];
  return [...new Set([...expired, ...overflow].map((item) => item.id))];
}
