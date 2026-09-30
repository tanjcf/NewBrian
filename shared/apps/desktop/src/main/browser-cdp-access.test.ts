import assert from "node:assert/strict";
import test from "node:test";

const { resolveBrowserCdpAccess } = await import(new URL("./browser-cdp-access.ts", import.meta.url).href);
const { probeBrowserSiteTools } = await import(new URL("./browser-site-tools.ts", import.meta.url).href);

test("CDP access is off by default and on when preference enabled", () => {
  assert.equal(resolveBrowserCdpAccess({ fullCdpAccess: false }).enabled, false);
  assert.equal(resolveBrowserCdpAccess({ fullCdpAccess: true }).enabled, true);
});

test("site tools probe skips network when disabled", async () => {
  const result = await probeBrowserSiteTools({
    siteToolsEnabled: false,
    pageUrl: "https://example.com",
    fetchImpl: async () => {
      throw new Error("should not fetch");
    }
  });
  assert.equal(result.enabled, false);
  assert.deepEqual(result.endpoints, []);
});

test("site tools probe collects successful well-known endpoints", async () => {
  const result = await probeBrowserSiteTools({
    siteToolsEnabled: true,
    pageUrl: "https://example.com/app",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/mcp.json")) {
        return { ok: true } as Response;
      }
      return { ok: false } as Response;
    }
  });
  assert.equal(result.enabled, true);
  assert.deepEqual(result.endpoints, ["https://example.com/.well-known/mcp.json"]);
});
