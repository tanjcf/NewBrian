import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "ScrollToBottomButton.tsx"), "utf8");
const styles = readFileSync(join(here, "../styles.css"), "utf8");

test("ScrollToBottomButton exposes Codex dual-state working dots and arrow", () => {
  assert.match(source, /showWorkingDots/);
  assert.match(source, /chat-jump-latest-dots/);
  assert.match(source, /chat-jump-latest-arrow/);
  assert.match(source, /data-working/);
});

test("styles define wave-dot animation for the scroll-to-bottom FAB", () => {
  assert.match(styles, /\.chat-jump-latest-dot/);
  assert.match(styles, /@keyframes chat-jump-wave-dot/);
  assert.match(styles, /\.chat-jump-latest-arrow/);
});
