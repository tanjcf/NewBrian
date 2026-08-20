const FRESHNESS_CLAIM = /(?:最新|今天|今日|当前|实时|刚刚|近期|现在|截至|截至目前|as of today|latest|currently|right now)/iu;

export function formatDesktopWebSearchUnavailable(reason: string): string {
  return [
    "WEB_SEARCH_UNAVAILABLE",
    reason.trim() || "Search did not return usable sources.",
    "Do not invent current facts, prices, headlines, or timelines.",
    "Tell the user that up-to-date web evidence is unavailable and avoid unsupported freshness claims."
  ].join(" ");
}

export function assertAnswerAllowsFreshnessClaims(input: {
  answer: string;
  searchedAt?: string;
  sourceUrls?: string[];
}): { ok: true } | { ok: false; reason: string } {
  const answer = String(input.answer || "");
  if (!FRESHNESS_CLAIM.test(answer)) return { ok: true };
  const urls = (input.sourceUrls || []).filter((url) => /^https?:\/\//iu.test(url));
  if (!input.searchedAt?.trim() || !urls.length) {
    return {
      ok: false,
      reason: formatDesktopWebSearchUnavailable("Freshness claims require source URLs and searchedAt from a completed search.")
    };
  }
  return { ok: true };
}

export function attachDesktopWebSearchCitations(input: {
  answer: string;
  searchedAt: string;
  items: Array<{ title: string; url: string; publishedAt?: string }>;
}): string {
  const lines = input.items
    .filter((item) => item.url)
    .slice(0, 8)
    .map((item, index) => {
      const title = item.title.trim() || item.url;
      const published = item.publishedAt?.trim() ? ` · published ${item.publishedAt.trim()}` : "";
      return `${index + 1}. [${title}](${item.url})${published}`;
    });
  if (!lines.length) return input.answer;
  return `${input.answer.trim()}\n\n来源（检索时间 ${input.searchedAt}）:\n${lines.join("\n")}`;
}
