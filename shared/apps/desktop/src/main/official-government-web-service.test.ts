import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner loads this source file directly.
import { OfficialGovernmentWebService, isOfficialGovernmentUrl } from "./official-government-web-service.ts";

test("accepts only HTTP government domains without credentials", () => {
  assert.equal(isOfficialGovernmentUrl("https://www.gov.cn/x"), true);
  assert.equal(isOfficialGovernmentUrl("https://beijing.gov.cn/x"), true);
  assert.equal(isOfficialGovernmentUrl("https://gov.cn.evil.example/x"), false);
  assert.equal(isOfficialGovernmentUrl("https://evilgov.cn/x"), false);
  assert.equal(isOfficialGovernmentUrl("file:///etc/passwd"), false);
  assert.equal(isOfficialGovernmentUrl("https://user:pass@www.gov.cn/x"), false);
  assert.equal(isOfficialGovernmentUrl("not a URL"), false);
});

test("search prefers the official gov.cn API without a fixed deadline and filters non-government URLs", async () => {
  let requestedUrl = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    assert.equal(init?.signal, undefined);
    return new Response(JSON.stringify({
      code: 200,
      searchVO: {
        catMap: {
          gongwen: {
            listVO: [
              {
                title: "国务院关于<em>育儿补贴</em>的通知",
                url: "https://www.gov.cn/zhengce/a.htm",
                summary: "官方摘要"
              },
              {
                title: "Untrusted",
                url: "https://example.com/b",
                summary: "ignored"
              }
            ]
          }
        }
      }
    }), { headers: { "content-type": "application/json" } });
  };
  const service = new OfficialGovernmentWebService({ fetchImpl });

  const results = await service.search({ query: "育儿补贴", limit: 5 });

  assert.match(requestedUrl, /^https:\/\/sousuo\.www\.gov\.cn\/search-gov\/data\?/);
  assert.match(requestedUrl, /t=zhengcelibrary_gw_bm_gb/);
  assert.deepEqual(results, [
    {
      title: "国务院关于 育儿补贴 的通知",
      url: "https://www.gov.cn/zhengce/a.htm",
      snippet: "官方摘要",
      rank: 1,
    },
  ]);
});

test("search forwards explicit cancellation instead of replacing it with a timer", async () => {
  const controller = new AbortController();
  const service = new OfficialGovernmentWebService({
    fetchImpl: async (_input, init) => {
      assert.equal(init?.signal, controller.signal);
      controller.abort(new Error("user cancelled"));
      throw controller.signal.reason;
    },
  });
  await assert.rejects(() => service.search({ query: "policy", signal: controller.signal }), /user cancelled/);
});

test("search falls back to Bing RSS when the official API returns no gov.cn hits", async () => {
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requested.push(String(input));
    if (String(input).includes("sousuo.www.gov.cn")) {
      return new Response(JSON.stringify({ code: 200, searchVO: { catMap: {} } }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      `<?xml version="1.0"?><rss><channel>
        <item><title>Official result</title><link>https://www.gov.cn/a</link><description> official summary </description></item>
        <item><title>Untrusted result</title><link>https://example.com/b</link><description>ignored</description></item>
      </channel></rss>`,
      { headers: { "content-type": "application/rss+xml" } },
    );
  };
  const service = new OfficialGovernmentWebService({ fetchImpl });

  const results = await service.search({ query: "习近平 新年贺词", limit: 5 });

  assert.match(requested[0], /^https:\/\/sousuo\.www\.gov\.cn\/search-gov\/data\?/);
  assert.match(requested[1], /^https:\/\/www\.bing\.com\/search\?/);
  assert.match(requested[1], /q=.*site%3Agov\.cn/);
  assert.deepEqual(results, [
    {
      title: "Official result",
      url: "https://www.gov.cn/a",
      snippet: "official summary",
      rank: 1,
    },
  ]);
});

test("search falls back to Chinese HTML results when Bing RSS ignores the official-site constraint", async () => {
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requested.push(String(input));
    if (String(input).includes("sousuo.www.gov.cn")) {
      return new Response(JSON.stringify({ code: 200, searchVO: { catMap: {} } }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (requested.filter((url) => url.includes("bing.com")).length === 1) {
      return new Response(
        `<?xml version="1.0"?><rss><channel>
          <item><title>Unrelated result</title><link>https://example.com/marketing</link><description>ignored</description></item>
        </channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } },
      );
    }
    return new Response(
      `<html><body><ol id="b_results">
        <li class="b_algo"><h2><a href="https://www.gov.cn/zhengce/content_1.htm">政策解读</a></h2>
          <div class="b_caption"><p>因地制宜发展新质生产力的官方解读。</p></div></li>
        <li class="b_algo"><h2><a href="https://example.com/untrusted">非官方结果</a></h2></li>
      </ol></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };
  const service = new OfficialGovernmentWebService({ fetchImpl });

  const results = await service.search({ query: "因地制宜发展新质生产力", limit: 5 });

  assert.equal(requested.length, 3);
  assert.match(requested[2], /^https:\/\/cn\.bing\.com\/search\?/);
  assert.deepEqual(results, [{
    title: "政策解读",
    url: "https://www.gov.cn/zhengce/content_1.htm",
    snippet: "因地制宜发展新质生产力的官方解读。",
    rank: 1,
  }]);
});

test("search falls back to Chinese HTML results when the RSS request times out", async () => {
  let attempts = 0;
  const service = new OfficialGovernmentWebService({
    fetchImpl: async (input) => {
      attempts += 1;
      if (String(input).includes("sousuo.www.gov.cn")) {
        return new Response(JSON.stringify({ code: 200, searchVO: { catMap: {} } }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (attempts === 2) throw new DOMException("timed out", "AbortError");
      return new Response(
        `<html><body><li class="b_algo"><h2>
          <a href="https://beijing.gov.cn/case">地方实践</a>
        </h2><p>官方案例材料。</p></li></body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });

  const results = await service.search({ query: "地方实践" });

  assert.equal(attempts, 3);
  assert.equal(results[0]?.url, "https://beijing.gov.cn/case");
});

test("search reports malformed RSS", async () => {
  const service = new OfficialGovernmentWebService({
    fetchImpl: async (input) => {
      if (String(input).includes("sousuo.www.gov.cn")) {
        return new Response(JSON.stringify({ code: 200, searchVO: { catMap: {} } }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("<rss><channel><item></rss>");
    },
  });

  await assert.rejects(() => service.search({ query: "test" }), /invalid search response/i);
});

test("read rejects a redirect outside gov.cn", async () => {
  const service = new OfficialGovernmentWebService({
    fetchImpl: async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/redirected" },
      }),
  });

  await assert.rejects(
    () => service.read({ url: "https://www.gov.cn/start" }),
    /gov\.cn/i,
  );
});

test("read rejects non-HTML responses", async () => {
  const service = new OfficialGovernmentWebService({
    fetchImpl: async () =>
      new Response("binary", { headers: { "content-type": "application/pdf" } }),
  });

  await assert.rejects(
    () => service.read({ url: "https://www.gov.cn/file.pdf" }),
    /HTML/i,
  );
});

test("read rejects response bodies above the byte limit", async () => {
  const service = new OfficialGovernmentWebService({
    fetchImpl: async () =>
      new Response("<html><body>too large</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    maxResponseBytes: 8,
  });

  await assert.rejects(
    () => service.read({ url: "https://www.gov.cn/large" }),
    /too large/i,
  );
});

test("read extracts bounded visible page text and follows official redirects", async () => {
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requested.push(String(input));
    if (requested.length === 1) {
      return new Response(null, {
        status: 301,
        headers: { location: "/article" },
      });
    }
    return new Response(
      `<html><head><title> Policy title </title><style>.x {}</style></head><body>
        <nav>navigation</nav><main><h1>Headline</h1><p>First   paragraph</p>
        <script>danger()</script><p>Second paragraph</p></main></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  };
  const service = new OfficialGovernmentWebService({ fetchImpl, maxTextChars: 33 });

  const page = await service.read({ url: "https://www.gov.cn/start" });

  assert.deepEqual(requested, [
    "https://www.gov.cn/start",
    "https://www.gov.cn/article",
  ]);
  assert.equal(page.url, "https://www.gov.cn/article");
  assert.equal(page.title, "Policy title");
  assert.equal(page.text, "Headline First paragraph Second p");
  assert.doesNotMatch(page.text, /navigation|danger|\.x/);
});
