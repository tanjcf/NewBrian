/**
 * Extract concrete fact tokens that should survive a style/fact review pass.
 * Tokens come only from the candidate draft itself so preservation stays
 * scenario-agnostic (coal, agriculture, computing clusters, etc.).
 */
export function extractPreservableGovernmentFacts(text) {
  const compact = String(text ?? "").replace(/\s+/g, "");
  if (!compact) return [];
  const patterns = [
    /\d+(?:\.\d+)?(?:万亿|亿|万)?(?:元|吨|人次|套|家|个|项|亩|千瓦|兆瓦|台|人|次|%|％)/gu,
    /无较大及以上安全事故/gu,
    /【待核验】[^【\n]{0,40}/gu,
    /【待补充】[^【\n]{0,40}/gu
  ];
  const facts = new Set();
  for (const pattern of patterns) {
    for (const match of compact.matchAll(pattern)) {
      const value = String(match[0] ?? "").trim();
      if (value.length >= 2) facts.add(value);
    }
  }
  return [...facts];
}

export function preserveSubstantiveGovernmentDraft(reviewed, candidate) {
  const reviewedCompact = String(reviewed ?? "").replace(/\s+/g, "");
  const candidateText = String(candidate ?? "");
  const candidateCompact = candidateText.replace(/\s+/g, "");
  const requiredFacts = extractPreservableGovernmentFacts(candidateText);
  const lostFacts = requiredFacts.some((fact) => !reviewedCompact.includes(fact));
  const candidateSections = (candidateText.match(/^#{1,6}\s+/gmu) || []).length;
  const reviewedSections = (String(reviewed ?? "").match(/^#{1,6}\s+/gmu) || []).length;
  const collapsed = candidateCompact.length >= 220 && reviewedCompact.length < candidateCompact.length * 0.6;
  return lostFacts || collapsed || (candidateSections >= 4 && reviewedSections < 4)
    ? candidateText
    : String(reviewed ?? "");
}
