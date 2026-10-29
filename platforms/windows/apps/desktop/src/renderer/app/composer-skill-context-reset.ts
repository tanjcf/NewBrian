/**
 * New-chat and thread switches blank the composer skill context after paint.
 * A same-turn creator entry (for example Automation Creator) records a pending
 * write that must survive that blank. A later switch has no pending write.
 */
export function composerSkillContextAfterReset(pendingWrite: string | null, resetTo = ""): string {
  return pendingWrite !== null ? pendingWrite : resetTo;
}
