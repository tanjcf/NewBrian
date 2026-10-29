import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("quant research notes render markdown instead of raw text", () => {
  const source = readFileSync(new URL("./QuantWorkspace.tsx", import.meta.url), "utf8");
  const notes = source.slice(source.indexOf('activeView === "research"'), source.indexOf("尚无研究笔记"));
  assert.match(notes, /<MarkdownMessage content=\{String\(note\.content \|\| ""\)\}/);
  assert.doesNotMatch(notes, /<span>\{note\.content\}<\/span>/);
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.brain-quant-research-note \.markdown-message/);
});
