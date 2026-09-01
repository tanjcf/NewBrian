// @ts-expect-error Electron Vite resolves the source module; Node strip-types tests load .ts directly.
import { type OfficialGovernmentWebService, isOfficialGovernmentUrl } from "./official-government-web-service.ts";

interface ExternalToolRuntime {
  unregisterExternalTools(namespace?: string): unknown;
  registerExternalTool(
    definition: Record<string, unknown>,
    execute: (input: Record<string, unknown>) => Promise<unknown>,
  ): unknown;
}

type OfficialWebService = Pick<OfficialGovernmentWebService, "search" | "read">;

const namespace = "web-official";
const SEARCH_WARNING_WITHOUT_READ = 3;
const SEARCH_BLOCK_WITHOUT_READ = 5;
const IDENTICAL_QUERY_BLOCK = 3;

export function registerOfficialGovernmentWebTools(
  runtime: ExternalToolRuntime,
  service: OfficialWebService,
): void {
  runtime.unregisterExternalTools(namespace);
  let searchCallsWithoutRead = 0;
  let readCalls = 0;
  const queryCounts = new Map<string, number>();
  runtime.registerExternalTool(
    {
      name: "web.search_official",
      title: "搜索政府官网",
      description: "Search official Chinese government websites. Results are restricted to gov.cn domains.",
      kind: "read",
      risk: "low",
      requiresApproval: false,
      namespace,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 300 },
          limit: { type: "integer", minimum: 1, maximum: 10 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async (input) => {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query || query.length > 300) {
        return failedTool("Query must contain 1 to 300 characters");
      }
      const limit = input.limit === undefined ? 5 : input.limit;
      if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 10) {
        return failedTool("Limit must be an integer from 1 to 10");
      }

      if (searchCallsWithoutRead + 1 >= SEARCH_BLOCK_WITHOUT_READ) {
        return loopBlocked([
          "CRITICAL: web.search_official blocked by tool-loop circuit breaker.",
          "Too many searches ran without a fresh web.read_official.",
          "Call web.read_official on the most relevant gov.cn URLs already returned,",
          "or produce the writing specification/draft from current evidence. Do not search again.",
        ].join(" "));
      }

      const identicalCount = (queryCounts.get(query) ?? 0) + 1;
      if (identicalCount >= IDENTICAL_QUERY_BLOCK) {
        return loopBlocked([
          `CRITICAL: web.search_official blocked after repeating query "${query}" ${identicalCount} times.`,
          "Call web.read_official on existing results or draft from current evidence.",
        ].join(" "));
      }

      return toolResult(async () => {
        const results = await service.search({ query, limit: Number(limit) });
        searchCallsWithoutRead += 1;
        queryCounts.set(query, identicalCount);
        const payload: Record<string, unknown> = { count: results.length, results };
        const topOfficialUrl = results
          .map((entry) => (typeof entry?.url === "string" ? entry.url.trim() : ""))
          .find((url) => url && isOfficialGovernmentUrl(url));
        if (topOfficialUrl && readCalls === 0) {
          try {
            const page = await service.read({ url: topOfficialUrl });
            readCalls += 1;
            searchCallsWithoutRead = 0;
            queryCounts.clear();
            payload.auto_read = { url: topOfficialUrl, ...page };
            payload.next_action = [
              "Primary official page content is in auto_read.",
              "Use it as evidence and continue drafting.",
              "Call web.read_official only for additional gov.cn URLs when needed."
            ].join(" ");
          } catch {
            payload.next_action = [
              `Call web.read_official on ${topOfficialUrl} before searching again.`,
              "Search snippets alone are not sufficient evidence."
            ].join(" ");
          }
        } else if (searchCallsWithoutRead >= SEARCH_WARNING_WITHOUT_READ && readCalls === 0) {
          payload.next_action = [
            "Stop additional web.search_official calls.",
            "Call web.read_official on the most relevant gov.cn URLs already returned,",
            "then produce the writing specification or article body. Do not search again."
          ].join(" ");
        } else if (searchCallsWithoutRead >= SEARCH_BLOCK_WITHOUT_READ - 1) {
          payload.next_action = [
            "Search budget nearly exhausted for this turn.",
            "Use already returned results and any read pages.",
            "Produce the writing specification or draft now; do not call web.search_official again."
          ].join(" ");
        }
        return payload;
      });
    },
  );

  runtime.registerExternalTool(
    {
      name: "web.read_official",
      title: "读取政府官网",
      description: "Read and extract visible text from an official gov.cn page.",
      kind: "read",
      risk: "low",
      requiresApproval: false,
      namespace,
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", minLength: 1 } },
        required: ["url"],
        additionalProperties: false,
      },
    },
    async (input) => toolResult(async () => {
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (!url || !isOfficialGovernmentUrl(url)) {
        throw new Error("URL must belong to gov.cn");
      }
      const page = await service.read({ url });
      readCalls += 1;
      searchCallsWithoutRead = 0;
      queryCounts.clear();
      return page;
    }),
  );
}

function loopBlocked(message: string) {
  return {
    ok: false,
    exitCode: 1,
    deniedReason: "tool-loop",
    output: message,
  };
}

function failedTool(message: string) {
  return { ok: false, exitCode: 1, output: message };
}

async function toolResult(operation: () => Promise<unknown>) {
  try {
    const output = await operation();
    return { ok: true, exitCode: 0, output: JSON.stringify(output) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Official web tool failed";
    return { ok: false, exitCode: 1, output: message };
  }
}
