import assert from "node:assert/strict";
import test from "node:test";

const { combineComposerQuote } = await import(new URL("./composer-quote.ts", import.meta.url).href);

test("combineComposerQuote appends queued text after newer typed input", () => {
  assert.equal(combineComposerQuote("新输入", "排队原文"), "新输入\n\n排队原文");
});

test("combineComposerQuote keeps typed text when quote is empty", () => {
  assert.equal(combineComposerQuote("仅新输入", "  "), "仅新输入");
});

test("combineComposerQuote does not duplicate an already included quote", () => {
  assert.equal(combineComposerQuote("前缀\n\n排队原文", "排队原文"), "前缀\n\n排队原文");
});
