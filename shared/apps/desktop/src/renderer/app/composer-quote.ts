/** Merge a queued quote into whatever the user already typed. Never drops newer input. */
export function combineComposerQuote(typed: string, quoted: string): string {
  const existing = String(typed || "").trim();
  const next = String(quoted || "").trim();
  if (!next) return existing;
  if (!existing) return next;
  if (existing.includes(next)) return existing;
  return `${existing}\n\n${next}`;
}
