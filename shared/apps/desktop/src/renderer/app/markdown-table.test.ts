import assert from "node:assert/strict";
import test from "node:test";

const { parseMarkdownTable } = await import(new URL("./markdown-table.ts", import.meta.url).href) as typeof import("./markdown-table.js");

test("parses a standard markdown table into readable cells", () => {
  const lines = ["| 章节 | 内容要点 |", "| --- | --- |", "| 一、问题导向 | 发现慢、响应慢 |", "| 二、改革举措 | 一网统筹、一键响应 |", "正文继续"];
  assert.deepEqual(parseMarkdownTable(lines, 0), {
    headers: ["章节", "内容要点"],
    rows: [["一、问题导向", "发现慢、响应慢"], ["二、改革举措", "一网统筹、一键响应"]],
    nextIndex: 4
  });
});

test("does not reinterpret ordinary pipe text as a table", () => {
  assert.equal(parseMarkdownTable(["A | B", "ordinary text"], 0), null);
});
