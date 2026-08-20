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
  if (input.answer.includes("来源（检索时间")) return input.answer;
  return `${input.answer.trim()}\n\n来源（检索时间 ${input.searchedAt}）:\n${lines.join("\n")}`;
}

export function collectDesktopWebSearchEvidenceFromTexts(texts: string[]): {
  searchedAt: string;
  items: Array<{ title: string; url: string; publishedAt?: string }>;
  unavailable: boolean;
} | null {
  let searchedAt = "";
  let unavailable = false;
  const items: Array<{ title: string; url: string; publishedAt?: string }> = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const raw = String(text || "").trim();
    if (!raw) continue;
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const match = raw.match(/\{[\s\S]*\}/u);
      if (!match) continue;
      try {
        payload = JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    if (!payload || typeof payload !== "object") continue;
    if (String(payload.status || "") === "unavailable" || String(payload.code || "").includes("WEB_SEARCH")) {
      unavailable = true;
    }
    if (typeof payload.searchedAt === "string" && payload.searchedAt.trim()) {
      searchedAt = payload.searchedAt.trim();
    }
    const list = Array.isArray(payload.items) ? payload.items : [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const url = String(row.url || "").trim();
      if (!/^https?:\/\//iu.test(url) || seen.has(url)) continue;
      seen.add(url);
      items.push({
        title: String(row.title || ""),
        url,
        publishedAt: row.publishedAt == null ? undefined : String(row.publishedAt)
      });
    }
  }
  if (!searchedAt && !items.length && !unavailable) return null;
  return { searchedAt, items, unavailable };
}

/** Binds search evidence onto the final answer or blocks unsupported freshness claims. */
export function finalizeDesktopWebSearchAnswer(input: {
  answer: string;
  toolTexts: string[];
}): string {
  const evidence = collectDesktopWebSearchEvidenceFromTexts(input.toolTexts);
  const answer = String(input.answer || "");
  if (!evidence) {
    const check = assertAnswerAllowsFreshnessClaims({ answer, searchedAt: "", sourceUrls: [] });
    return check.ok ? answer : check.reason;
  }
  const sourceUrls = evidence.items.map((item) => item.url);
  const check = assertAnswerAllowsFreshnessClaims({
    answer,
    searchedAt: evidence.searchedAt,
    sourceUrls
  });
  if (!check.ok) {
    return check.reason;
  }
  if (!evidence.items.length || !evidence.searchedAt) return answer;
  return attachDesktopWebSearchCitations({
    answer,
    searchedAt: evidence.searchedAt,
    items: evidence.items
  });
}
