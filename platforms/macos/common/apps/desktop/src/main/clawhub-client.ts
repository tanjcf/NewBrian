/**
 * ClawHub HTTP client (search / resolve / download).
 *
 * Desktop product path connects directly to ClawHub (`https://clawhub.ai` by default).
 * Gate with `market.directClawhubAllowed` (default true) or `NEWBRAIN_MARKET_DIRECT_CLAWHUB=1`.
 * Override base URL via `NEWBRAIN_CLAWHUB_URL` / `OPENCLAW_CLAWHUB_URL` / `CLAWHUB_URL`.
 */
const DEFAULT_CLAWHUB_URL = "https://clawhub.ai";
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export type ClawHubSkillSearchHit = {
  score: number;
  slug: string;
  ownerHandle?: string | null;
  displayName: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
  pageUrl?: string;
};

export type ClawHubInstallRef = {
  slug: string;
  ownerHandle?: string;
};

export type ClawHubResolvedInstall =
  | {
      ok: true;
      slug: string;
      ownerHandle?: string;
      isOfficial?: boolean | null;
      channel?: string | null;
      installKind: "archive";
      version: string;
      downloadUrl: string;
    }
  | {
      ok: true;
      slug: string;
      ownerHandle?: string;
      isOfficial?: boolean | null;
      channel?: string | null;
      installKind: "github";
      repo: string;
      path: string;
      commit: string;
      contentHash: string;
      sourceUrl: string;
    }
  | {
      ok: false;
      slug: string;
      reason: string;
      message: string;
      status: number;
    };

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl || process.env.NEWBRAIN_CLAWHUB_URL || process.env.OPENCLAW_CLAWHUB_URL || process.env.CLAWHUB_URL || DEFAULT_CLAWHUB_URL)
    .trim()
    .replace(/\/+$/, "");
}

/** Parse `slug` or `@owner/slug` ClawHub refs. */
export function parseClawHubSkillRef(raw: string): ClawHubInstallRef {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("ClawHub skill ref is empty.");
  const owned = /^@([^/]+)\/([A-Za-z0-9][A-Za-z0-9._-]{0,126})$/.exec(trimmed);
  if (owned) return { ownerHandle: owned[1], slug: owned[2] };
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/.test(trimmed)) return { slug: trimmed };
  throw new Error(`Invalid ClawHub skill ref: ${raw}`);
}

function buildUrl(baseUrl: string, path: string, search?: Record<string, string | undefined>) {
  const url = new URL(path.replace(/^\//, ""), `${normalizeBaseUrl(baseUrl)}/`);
  if (search) {
    for (const [key, value] of Object.entries(search)) {
      if (value != null && value !== "") url.searchParams.set(key, value);
    }
  }
  return url;
}

async function readLimitedBytes(response: Response, maxBytes: number, label: string) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  return buffer;
}

async function fetchJson<T>(input: {
  baseUrl?: string;
  path: string;
  search?: Record<string, string | undefined>;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<T> {
  const url = buildUrl(input.baseUrl || DEFAULT_CLAWHUB_URL, input.path, input.search);
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: input.signal
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ClawHub ${url.pathname} failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  const bytes = await readLimitedBytes(response, MAX_JSON_BYTES, `ClawHub JSON ${url.pathname}`);
  return JSON.parse(new TextDecoder("utf-8").decode(bytes)) as T;
}

export async function searchClawHubSkills(input: {
  query: string;
  limit?: number;
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<ClawHubSkillSearchHit[]> {
  const query = input.query.trim() || "*";
  const payload = await fetchJson<{ results?: ClawHubSkillSearchHit[] } | ClawHubSkillSearchHit[]>({
    baseUrl: input.baseUrl,
    path: "/api/v1/search",
    search: {
      q: query,
      limit: String(Math.min(Math.max(input.limit ?? 20, 1), 50)),
      nonSuspiciousOnly: "true"
    },
    signal: input.signal,
    fetchImpl: input.fetchImpl
  });
  const results = Array.isArray(payload) ? payload : payload.results || [];
  const base = normalizeBaseUrl(input.baseUrl);
  return results.map((item) => ({
    ...item,
    pageUrl: item.ownerHandle
      ? `${base}/${encodeURIComponent(item.ownerHandle)}/${encodeURIComponent(item.slug)}`
      : `${base}/skills/${encodeURIComponent(item.slug)}`
  }));
}

export async function resolveClawHubSkillInstall(input: {
  ref: string;
  forceInstall?: boolean;
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<ClawHubResolvedInstall> {
  const parsed = parseClawHubSkillRef(input.ref);
  const payload = await fetchJson<Record<string, any>>({
    baseUrl: input.baseUrl,
    path: `/api/v1/skills/${encodeURIComponent(parsed.slug)}/install`,
    search: {
      ownerHandle: parsed.ownerHandle,
      forceInstall: input.forceInstall ? "1" : undefined
    },
    signal: input.signal,
    fetchImpl: input.fetchImpl
  });

  if (payload.ok === false) {
    return {
      ok: false,
      slug: String(payload.slug || parsed.slug),
      reason: String(payload.reason || "install_failed"),
      message: String(payload.message || "ClawHub refused install resolution."),
      status: Number(payload.status || 400)
    };
  }

  if (payload.installKind === "archive" && payload.archive?.downloadUrl) {
    return {
      ok: true,
      slug: String(payload.slug || parsed.slug),
      ownerHandle: parsed.ownerHandle,
      isOfficial: payload.isOfficial ?? payload.archive.isOfficial,
      channel: payload.channel ?? payload.archive.channel,
      installKind: "archive",
      version: String(payload.archive.version || ""),
      downloadUrl: String(payload.archive.downloadUrl)
    };
  }

  if (payload.installKind === "github" && payload.github?.repo && payload.github?.commit) {
    return {
      ok: true,
      slug: String(payload.slug || parsed.slug),
      ownerHandle: parsed.ownerHandle,
      isOfficial: payload.isOfficial,
      channel: payload.channel,
      installKind: "github",
      repo: String(payload.github.repo),
      path: String(payload.github.path || ""),
      commit: String(payload.github.commit),
      contentHash: String(payload.github.contentHash || ""),
      sourceUrl: String(payload.github.sourceUrl || "")
    };
  }

  throw new Error(`Unsupported ClawHub install resolution for ${input.ref}.`);
}

export async function downloadClawHubArchive(input: {
  url: string;
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<{ bytes: Uint8Array; downloadUrl: string }> {
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(input.url, {
    method: "GET",
    headers: { Accept: "application/zip,application/octet-stream,*/*" },
    signal: input.signal
  });
  if (!response.ok) {
    throw new Error(`ClawHub archive download failed (${response.status}) for ${input.url}`);
  }
  const bytes = await readLimitedBytes(response, MAX_ARCHIVE_BYTES, "ClawHub skill archive");
  return { bytes, downloadUrl: input.url };
}

export function buildGitHubCodeloadUrl(repo: string, commit: string) {
  return `https://codeload.github.com/${repo}/zip/${commit}`;
}

export async function downloadResolvedClawHubInstall(
  resolved: Extract<ClawHubResolvedInstall, { ok: true }>,
  options: { baseUrl?: string; signal?: AbortSignal; fetchImpl?: FetchLike } = {}
) {
  if (resolved.installKind === "archive") {
    return downloadClawHubArchive({
      url: resolved.downloadUrl,
      baseUrl: options.baseUrl,
      signal: options.signal,
      fetchImpl: options.fetchImpl
    });
  }
  return downloadClawHubArchive({
    url: buildGitHubCodeloadUrl(resolved.repo, resolved.commit),
    signal: options.signal,
    fetchImpl: options.fetchImpl
  });
}
