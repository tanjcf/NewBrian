/**
 * Optional site-tools / WebMCP probe when Browser Use siteToolsEnabled is on.
 * Best-effort discovery only — never executes remote tools automatically.
 */

export interface BrowserSiteToolProbeResult {
  origin: string;
  enabled: boolean;
  endpoints: string[];
  detail: string;
}

const CANDIDATE_PATHS = [
  "/.well-known/mcp.json",
  "/.well-known/webmcp.json",
  "/mcp.json"
];

export async function probeBrowserSiteTools(input: {
  siteToolsEnabled: boolean;
  pageUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<BrowserSiteToolProbeResult> {
  const origin = (() => {
    try {
      return new URL(input.pageUrl).origin;
    } catch {
      return "";
    }
  })();
  if (!input.siteToolsEnabled) {
    return {
      origin,
      enabled: false,
      endpoints: [],
      detail: "站点工具已关闭。"
    };
  }
  if (!origin) {
    return { origin: "", enabled: true, endpoints: [], detail: "当前页面 URL 无效。" };
  }
  const fetchFn = input.fetchImpl || fetch;
  const endpoints: string[] = [];
  for (const path of CANDIDATE_PATHS) {
    const url = `${origin}${path}`;
    try {
      const response = await fetchFn(url, { method: "GET" });
      if (response.ok) endpoints.push(url);
    } catch {
      // ignore network failures
    }
  }
  return {
    origin,
    enabled: true,
    endpoints,
    detail: endpoints.length
      ? `发现 ${endpoints.length} 个站点工具端点（仅探测，未自动调用）。`
      : "未发现公开站点工具端点。"
  };
}
