const LOCAL_RUNTIME_STATE = /当前(?:持久化|目标|步骤|任务|线程|审批|运行|进度|状态|会话|工作区)/gu;

/**
 * Tool-side guidance only. Must never be written into the user-visible assistant
 * bubble — Auto Mode / search policy prompts live in spring-app, not BRAIN UI.
 */
export function formatDesktopWebSearchUnavailable(reason: string, code?: string): string {
  const { userHint } = describeDesktopWebSearchFailure(reason, code);
  return [
    "WEB_SEARCH_UNAVAILABLE",
    reason.trim() || "Search did not return usable sources.",
    "Do not invent current facts, prices, headlines, or timelines.",
    userHint
      ? `Tell the user in Chinese: ${userHint}`
      : "Tell the user that up-to-date web evidence is unavailable and avoid unsupported freshness claims."
  ].join(" ");
}

const WEB_SEARCH_FAILURE_HINTS: Record<string, string> = {
  WEB_SEARCH_PAYMENT_REQUIRED: "联网搜索余额不足，请充值后再试。",
  WEB_SEARCH_BUDGET_EXCEEDED: "今日联网搜索额度已用完，请明天再试或联系管理员提高额度。",
  WEB_SEARCH_USER_REQUIRED: "需要登录账号后才能使用联网搜索。",
  WEB_SEARCH_AUTH_REQUIRED: "需要登录账号后才能使用联网搜索。",
  WEB_SEARCH_CHARGE_CONFLICT: "联网搜索计费未能完成，请稍后重试。",
  WEB_SEARCH_DISABLED: "管理员已关闭联网搜索。",
  WEB_SEARCH_NOT_CONFIGURED: "联网搜索暂未配置，请联系管理员。",
  WEB_SEARCH_PROVIDER_NOT_CONFIGURED: "联网搜索暂未配置，请联系管理员。"
};

/**
 * Spring reports orchestration failures as "WEB_SEARCH_XXX: detail" messages
 * (or as the error code of a non-2xx response).
 */
export function describeDesktopWebSearchFailure(
  reason: string,
  fallbackCode = "WEB_SEARCH_UNAVAILABLE"
): { code: string; userHint: string } {
  const embedded = /^\s*(WEB_SEARCH_[A-Z_]+)\s*:/u.exec(String(reason || ""))?.[1];
  const code = embedded || fallbackCode;
  return { code, userHint: WEB_SEARCH_FAILURE_HINTS[code] ?? "" };
}

/** Kept for unit tests / tool contracts; BRAIN must not rewrite chat answers with this. */
export function assertAnswerAllowsFreshnessClaims(input: {
  answer: string;
  searchedAt?: string;
  sourceUrls?: string[];
}): { ok: true } | { ok: false; reason: string } {
  const answer = String(input.answer || "").replace(LOCAL_RUNTIME_STATE, "");
  // Narrow: only strong external freshness claims, not casual 现在/当前 chat.
  const strongClaim =
    /(?:最新(?:消息|新闻|股价|价格|行情|公告|数据)|今天(?:的)?(?:股价|价格|行情|新闻)|今日(?:股价|价格|行情)|实时(?:股价|价格|行情|数据)|截至目前|as of today|\blatest (?:price|news|data)\b)/iu;
  if (!strongClaim.test(answer)) return { ok: true };
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

/**
 * Optionally attach citation blocks when this turn actually ran web search.
 * Never rewrite the assistant answer into WEB_SEARCH_* machine prompts — those
 * belong in tool payloads / spring-app Auto Mode, not the BRAIN chat bubble.
 */
export function finalizeDesktopWebSearchAnswer(input: {
  answer: string;
  toolTexts: string[];
}): string {
  const evidence = collectDesktopWebSearchEvidenceFromTexts(input.toolTexts);
  const answer = String(input.answer || "");
  if (!evidence?.items.length || !evidence.searchedAt) return answer;
  return attachDesktopWebSearchCitations({
    answer,
    searchedAt: evidence.searchedAt,
    items: evidence.items
  });
}
