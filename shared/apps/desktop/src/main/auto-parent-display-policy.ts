export const DEFAULT_AUTO_PARENT_DISPLAY_NAME = "brain";

/** User-visible label for the parent Auto orchestrator (not the routed upstream model). */
export function resolveAutoParentDisplayName(input?: string | null): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return DEFAULT_AUTO_PARENT_DISPLAY_NAME;
  return trimmed.length > 64 ? trimmed.slice(0, 64) : trimmed;
}

export function readAutoParentDisplayNameFromRecord(
  record?: Record<string, unknown> | null
): string | undefined {
  if (!record) return undefined;
  const raw = record.auto_parent_display_name ?? record.autoParentDisplayName;
  return typeof raw === "string" ? raw : undefined;
}
