/**
 * Codex-style automation binding: one task owns one dedicated chat thread.
 * Creation must never inherit the UI-selected or main-process active thread.
 */

export function automationNeedsDedicatedThread(input: {
  workspaceId?: string | null;
  threadId?: string | null;
}): boolean {
  return !String(input.workspaceId || "").trim() || !String(input.threadId || "").trim();
}

/** Title used when allocating the automation-owned conversation. */
export function automationDedicatedThreadTitle(title?: string | null): string {
  const text = String(title || "").trim() || "自动化任务";
  return text.slice(0, 36);
}
