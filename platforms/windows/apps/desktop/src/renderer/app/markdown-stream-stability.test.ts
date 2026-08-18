import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./MarkdownMessage.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("Windows-only: streaming markdown stays flat to avoid heading remount jumps", () => {
  assert.match(source, /Windows-only/);
  assert.match(source, /isStreaming\s*\?\s*<MarkdownDocument/);
  assert.match(source, /CollapsibleMarkdownDocument content=\{renderableContent\}/);
  assert.doesNotMatch(
    source,
    /isStreaming\s*\?\s*<CollapsibleMarkdownDocument|CollapsibleMarkdownDocument[\s\S]{0,80}isStreaming/
  );
});

test("collapsible section keys stay index-stable", () => {
  assert.match(source, /key=\{`\$\{path\}-\$\{index\}`\}/);
  assert.match(source, /key=\{`s-\$\{index\}`\}/);
  assert.doesNotMatch(source, /key=\{`\$\{index\}-\$\{section\.heading\}`\}/);
});

test("Windows-only: scroll containers disable overflow anchoring during stream growth", () => {
  assert.match(css, /Windows-only:[^]*overflow-anchor:\s*none/s);
  assert.match(css, /\.task-scroll\s*\{[^}]*overflow-anchor:\s*none/s);
  assert.match(css, /\.markdown-message-streaming\s*\{[^}]*overflow-anchor:\s*none/s);
});
