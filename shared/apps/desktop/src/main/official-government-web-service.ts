import { parse } from "parse5";
import { SaxesParser } from "saxes";

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TEXT_CHARS = 40_000;
const MAX_REDIRECTS = 5;
const OFFICIAL_SEARCH_ENDPOINT = "https://sousuo.www.gov.cn/search-gov/data";
const OFFICIAL_SEARCH_TYPE = "zhengcelibrary_gw_bm_gb";

export interface OfficialSearchResult {
  title: string;
  url: string;
  snippet: string;
  rank: number;
}

interface WebServiceOptions {
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
  maxTextChars?: number;
}

interface HtmlNode {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
}

export function isOfficialGovernmentUrl(value: string): boolean {
  try {
    requireOfficialGovernmentUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function requireOfficialGovernmentUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const isGovernmentHost = hostname === "gov.cn" || hostname.endsWith(".gov.cn");

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    !isGovernmentHost
  ) {
    throw new Error("URL must use HTTP(S) and belong to gov.cn");
  }

  return url;
}

export class OfficialGovernmentWebService {
  readonly #fetchImpl: typeof fetch;
  readonly #maxResponseBytes: number;
  readonly #maxTextChars: number;

  constructor(options: WebServiceOptions = {}) {
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  }

  async search(input: { query: string; limit?: number; signal?: AbortSignal }): Promise<OfficialSearchResult[]> {
    const query = input.query.trim();
    if (!query) throw new Error("Search query is required");
    const limit = Math.max(1, Math.min(10, input.limit ?? 5));

    // Prefer the official State Council search API. Bing RSS often returns unrelated
    // non-gov.cn noise that collapses to an empty filtered result set.
    try {
      const official = await this.#searchOfficialApi(query, limit, input.signal);
      if (official.length > 0) return official;
    } catch (error) {
      if (input.signal?.aborted) throw error;
      // Fall through to Bing fallbacks on transport/parse issues.
    }

    const searchUrl = new URL("https://www.bing.com/search");
    searchUrl.searchParams.set("format", "rss");
    searchUrl.searchParams.set("q", `${query} site:gov.cn`);
    searchUrl.searchParams.set("setlang", "zh-cn");

    let rssResults: OfficialSearchResult[] = [];
    try {
      const response = await this.#fetchBounded(searchUrl, {
        redirect: "follow",
      }, input.signal);
      if (!response.ok) throw new Error(`Official search failed with HTTP ${response.status}`);
      const xml = new TextDecoder().decode(response.body);
      rssResults = filterOfficialResults(parseRss(xml), limit);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (!(error instanceof DOMException && error.name === "AbortError") && !(error instanceof TypeError)) {
        throw error;
      }
    }
    if (rssResults.length > 0) return rssResults;

    const htmlSearchUrl = new URL("https://cn.bing.com/search");
    htmlSearchUrl.searchParams.set("q", `${query} site:gov.cn`);
    htmlSearchUrl.searchParams.set("setlang", "zh-cn");
    const htmlResponse = await this.#fetchBounded(htmlSearchUrl, {
      redirect: "follow",
    }, input.signal);
    if (!htmlResponse.ok) throw new Error(`Official HTML search failed with HTTP ${htmlResponse.status}`);
    const html = new TextDecoder().decode(htmlResponse.body);
    return filterOfficialResults(parseBingHtml(html), limit);
  }

  async #searchOfficialApi(query: string, limit: number, signal?: AbortSignal): Promise<OfficialSearchResult[]> {
    const searchUrl = new URL(OFFICIAL_SEARCH_ENDPOINT);
    searchUrl.searchParams.set("t", OFFICIAL_SEARCH_TYPE);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("searchfield", "title:content:summary");
    searchUrl.searchParams.set("sort", "score");
    searchUrl.searchParams.set("sortType", "1");
    searchUrl.searchParams.set("p", "1");
    searchUrl.searchParams.set("n", String(Math.max(limit, 20)));
    searchUrl.searchParams.set("timetype", "timezd");

    const response = await this.#fetchBounded(searchUrl, {
      redirect: "follow",
      headers: {
        accept: "application/json, text/plain, */*",
        referer: "https://sousuo.www.gov.cn/",
      },
    }, signal);
    if (!response.ok) throw new Error(`Official gov.cn search failed with HTTP ${response.status}`);
    const raw = new TextDecoder().decode(response.body);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      throw new Error("Invalid official gov.cn search JSON", { cause: error });
    }
    return filterOfficialResults(parseOfficialSearchPayload(payload), limit);
  }

  async read(input: { url: string; signal?: AbortSignal }): Promise<{ url: string; title: string; text: string }> {
    let currentUrl = requireOfficialGovernmentUrl(input.url);

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await this.#fetchBounded(currentUrl, {
        redirect: "manual",
      }, input.signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Official page redirect is missing Location");
        if (redirectCount === MAX_REDIRECTS) throw new Error("Official page redirected too many times");
        currentUrl = requireOfficialGovernmentUrl(new URL(location, currentUrl).href);
        continue;
      }
      if (!response.ok) throw new Error(`Official page failed with HTTP ${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new Error("Official page response must be HTML");
      }

      const html = new TextDecoder().decode(response.body);
      const document = parse(html) as HtmlNode;
      return {
        url: currentUrl.href,
        title: extractTitle(document),
        text: extractVisibleText(document).slice(0, this.#maxTextChars),
      };
    }

    throw new Error("Official page redirected too many times");
  }

  async #fetchBounded(
    url: URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; status: number; headers: Headers; body: Uint8Array }> {
    const response = await this.#fetchImpl(url, {
      ...init,
      signal,
      headers: {
        "accept-language": "zh-CN,zh;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 NewBrain/0.1",
        ...(init.headers ?? {}),
      },
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > this.#maxResponseBytes) {
      throw new Error("Official web response is too large");
    }
    const body = await readBoundedBody(response, this.#maxResponseBytes);
    return { ok: response.ok, status: response.status, headers: response.headers, body };
  }
}

function parseOfficialSearchPayload(
  payload: unknown,
): Array<{ title: string; url: string; snippet: string }> {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const searchVo = root.searchVO && typeof root.searchVO === "object"
    ? root.searchVO as Record<string, unknown>
    : null;
  const catMapCandidate = (searchVo?.catMap ?? root.catMap ?? (
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>).catMap
      : undefined
  ));
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();

  if (Array.isArray(root.results)) {
    for (const item of root.results) {
      pushOfficialCandidate(results, seen, item);
    }
  }

  if (catMapCandidate && typeof catMapCandidate === "object") {
    for (const value of Object.values(catMapCandidate as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const list = (value as Record<string, unknown>).listVO;
      if (!Array.isArray(list)) continue;
      for (const item of list) pushOfficialCandidate(results, seen, item);
    }
  }

  return results;
}

function pushOfficialCandidate(
  results: Array<{ title: string; url: string; snippet: string }>,
  seen: Set<string>,
  item: unknown,
): void {
  if (!item || typeof item !== "object") return;
  const record = item as Record<string, unknown>;
  const title = stripHtml(String(record.title ?? ""));
  const url = normalizePossiblyRelativeGovUrl(String(record.url ?? record.link ?? ""));
  const snippet = stripHtml(String(record.summary ?? record.content ?? record.description ?? ""));
  if (!title || !url || seen.has(url)) return;
  seen.add(url);
  results.push({ title, url, snippet });
}

function normalizePossiblyRelativeGovUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://www.gov.cn${trimmed}`;
  if (!/^https?:\/\//i.test(trimmed)) return `https://www.gov.cn/${trimmed.replace(/^\/+/, "")}`;
  return trimmed;
}

function stripHtml(value: string): string {
  return normalizeText(value.replace(/<[^>]*>/g, " "));
}

function filterOfficialResults(
  candidates: Array<{ title: string; url: string; snippet: string }>,
  limit: number,
): OfficialSearchResult[] {
  const results: OfficialSearchResult[] = [];
  for (const item of candidates) {
    if (!isOfficialGovernmentUrl(item.url)) continue;
    results.push({
      title: normalizeText(item.title),
      url: requireOfficialGovernmentUrl(item.url).href,
      snippet: normalizeText(item.snippet),
      rank: results.length + 1,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function parseBingHtml(html: string): Array<{ title: string; url: string; snippet: string }> {
  const document = parse(html) as HtmlNode;
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  visitElements(document, (node) => {
    if (node.tagName?.toLowerCase() !== "li" || !hasClass(node, "b_algo")) return;
    const heading = findElement(node, "h2");
    const link = heading ? findElement(heading, "a") : undefined;
    const url = link ? attribute(link, "href") : "";
    if (!url) return;
    const paragraph = findElement(node, "p");
    results.push({
      title: link ? collectText(link) : "",
      url,
      snippet: paragraph ? collectText(paragraph) : "",
    });
  });
  return results;
}

function attribute(node: HtmlNode, name: string): string {
  return node.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function hasClass(node: HtmlNode, name: string): boolean {
  return attribute(node, "class").split(/\s+/u).includes(name);
}

function findElement(node: HtmlNode, tagName: string): HtmlNode | undefined {
  if (node.tagName?.toLowerCase() === tagName.toLowerCase()) return node;
  for (const child of node.childNodes ?? []) {
    const found = findElement(child, tagName);
    if (found) return found;
  }
  return undefined;
}

function visitElements(node: HtmlNode, visit: (node: HtmlNode) => void): void {
  visit(node);
  for (const child of node.childNodes ?? []) visitElements(child, visit);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Official web response is too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseRss(xml: string): Array<{ title: string; url: string; snippet: string }> {
  const items: Array<{ title: string; url: string; snippet: string }> = [];
  let current: { title: string; url: string; snippet: string } | undefined;
  let field: "title" | "link" | "description" | undefined;
  let buffer = "";
  try {
    const parser = new SaxesParser({ xmlns: false });
    parser.on("opentag", (tag) => {
      const name = tag.name.toLowerCase();
      if (name === "item") current = { title: "", url: "", snippet: "" };
      if (current && (name === "title" || name === "link" || name === "description")) {
        field = name;
        buffer = "";
      }
    });
    parser.on("text", (text) => {
      if (field) buffer += text;
    });
    parser.on("cdata", (text) => {
      if (field) buffer += text;
    });
    parser.on("closetag", (tag) => {
      const name = tag.name.toLowerCase();
      if (current && field === name) {
        if (field === "link") current.url = buffer.trim();
        else if (field === "description") current.snippet = buffer;
        else current.title = buffer;
        field = undefined;
        buffer = "";
      }
      if (name === "item" && current) {
        items.push(current);
        current = undefined;
      }
    });
    parser.write(xml).close();
  } catch (error) {
    throw new Error("Invalid search response XML", { cause: error });
  }
  return items;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractTitle(node: HtmlNode): string {
  if (node.tagName?.toLowerCase() === "title") return collectText(node);
  for (const child of node.childNodes ?? []) {
    const title = extractTitle(child);
    if (title) return title;
  }
  return "";
}

function collectText(node: HtmlNode): string {
  const values: string[] = [];
  visitText(node, values, new Set());
  return normalizeText(values.join(" "));
}

function extractVisibleText(node: HtmlNode): string {
  const values: string[] = [];
  visitText(node, values, new Set(["script", "style", "nav", "noscript", "svg", "title"]));
  return normalizeText(values.join(" "));
}

function visitText(node: HtmlNode, values: string[], excluded: ReadonlySet<string>): void {
  if (node.tagName && excluded.has(node.tagName.toLowerCase())) return;
  if (node.nodeName === "#text" && node.value) values.push(node.value);
  for (const child of node.childNodes ?? []) visitText(child, values, excluded);
}
