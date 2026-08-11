import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { createServer } from "vite";
import { renderToStaticMarkup } from "react-dom/server";

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error"
});
after(() => server.close());

const { MarkdownMessage } = await server.ssrLoadModule("/src/renderer/app/MarkdownMessage.tsx");

function render(content, extra = {}) {
  return renderToStaticMarkup(createElement(MarkdownMessage, {
    content, workspaceId: "workspace-test", onOpenLocalFile: () => undefined, ...extra
  }));
}

test("exports a memoized message boundary so completed turns remain stable", () => {
  assert.equal(MarkdownMessage.$$typeof, Symbol.for("react.memo"));
});

test("renders GFM, math, file ranges, and interactive code controls", () => {
  const html = render([
    "| 功能 | 状态 |",
    "| --- | --- |",
    "| GFM | **完成** |",
    "",
    "- [x] task",
    "",
    "$x^2$",
    "",
    "[源文件](src/app.ts#L12-L20)",
    "",
    "```ts",
    "const answer = 42;",
    "```"
  ].join("\n"));

  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /class="katex"/);
  assert.match(html, /data-local-file-path="src\/app\.ts"/);
  assert.match(html, /第 12–20 行/);
  assert.match(html, /自动换行/);
  assert.match(html, /查看源码/);
});

test("keeps raw model HTML inert", () => {
  const html = render('<img src=x onerror="alert(1)"><script>alert(2)</script>');
  assert.doesNotMatch(html, /<img\s|<script/i);
  assert.match(html, /&lt;img/);
});

test("decorates diff code without enabling raw HTML", () => {
  const html = render("```diff\n@@ -1 +1 @@\n-old\n+new\n```");
  assert.match(html, /diff-hunk/);
  assert.match(html, /diff-remove/);
  assert.match(html, /diff-add/);
});

test("renders Markdown heading hierarchy as nested expandable sections", () => {
  const html = render("# 总报告\n\n导语\n\n## 第一部分\n\n正文一\n\n### 细节\n\n细节正文\n\n## 第二部分\n\n正文二");
  assert.match(html, /<details[^>]*class="markdown-section markdown-section-level-1"[^>]*open=""/);
  assert.match(html, /<summary[^>]*>.*<h1>总报告<\/h1>.*<\/summary>/s);
  assert.match(html, /markdown-section-level-2/);
  assert.match(html, /markdown-section-level-3/);
  assert.ok(html.indexOf("markdown-section-level-3") < html.indexOf("第二部分"));
  assert.match(html, /细节正文/);
});

test("renders a long completed answer within a bounded regression budget", () => {
  const content = Array.from({ length: 1_000 }, (_, index) => `## Section ${index}\n\nParagraph **${index}** with [link](https://example.com/${index}).`).join("\n\n");
  const startedAt = performance.now();
  const html = render(content);
  const elapsed = performance.now() - startedAt;
  assert.ok(html.length > 100_000);
  assert.ok(elapsed < 2_500, `long Markdown render took ${Math.round(elapsed)}ms`);
});
