import assert from "node:assert/strict";
import test from "node:test";

const { normalizeStreamingMarkdown, safeMarkdownUrl } = await import(new URL("./streaming-markdown.ts", import.meta.url).href);

test("leaves completed markdown unchanged outside streaming", () => {
  const markdown = "# 标题\n\n- 项目\n\n```ts\nconst value = 1;\n```";
  assert.equal(normalizeStreamingMarkdown(markdown, false), markdown);
});

test("closes an incomplete fenced code block only for rendering", () => {
  const partial = "开始\n\n```ts\nconst value =";
  assert.equal(normalizeStreamingMarkdown(partial, true), partial + "\n```");
  assert.equal(normalizeStreamingMarkdown(partial, false), partial);
});

test("repairs common incomplete inline constructs during streaming", () => {
  assert.equal(normalizeStreamingMarkdown("**正在生成", true), "**正在生成**");
  assert.equal(normalizeStreamingMarkdown("使用 `code", true), "使用 `code`");
  assert.equal(normalizeStreamingMarkdown("[文件](G:/work/file.ts", true), "[文件](G:/work/file.ts)");
});

test("normalizes transport line endings and removes null bytes", () => {
  assert.equal(normalizeStreamingMarkdown("甲\r\n乙\0", false), "甲\n乙");
});

test("allows workspace and safe web links while blocking active schemes", () => {
  assert.equal(safeMarkdownUrl("G:/work/file.ts"), "G:/work/file.ts");
  assert.equal(safeMarkdownUrl("../file.ts"), "../file.ts");
  assert.equal(safeMarkdownUrl("https://example.com"), "https://example.com");
  assert.equal(safeMarkdownUrl("mailto:user@example.com"), "mailto:user@example.com");
  assert.equal(safeMarkdownUrl("javascript:alert(1)"), "");
  assert.equal(safeMarkdownUrl("data:text/html,unsafe"), "");
});
