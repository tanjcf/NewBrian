import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { countGovernmentWritingCharacters, enforceGovernmentWritingLength, isGovernmentWritingLengthAccepted, parseRequestedLengthRange, trimGovernmentWritingToRange } from "./government-writing-output.ts";

test("parses explicit and approximate Chinese document length requirements", () => {
  assert.deepEqual(parseRequestedLengthRange("正文必须控制在720至880字"), { min: 720, max: 880 });
  assert.deepEqual(parseRequestedLengthRange("写一篇约800字的讲话稿"), { min: 720, max: 880 });
  assert.deepEqual(parseRequestedLengthRange("800字左右"), { min: 720, max: 880 });
  assert.deepEqual(parseRequestedLengthRange("正文不超过800字"), { min: 1, max: 800 });
  assert.deepEqual(parseRequestedLengthRange("控制在800字以内"), { min: 1, max: 800 });
  assert.deepEqual(parseRequestedLengthRange("正文不少于800字"), { min: 800, max: 50_000 });
  assert.deepEqual(parseRequestedLengthRange("至少800字"), { min: 800, max: 50_000 });
  assert.deepEqual(parseRequestedLengthRange("正文控制在800字"), { min: 720, max: 880 });
  assert.deepEqual(parseRequestedLengthRange("约999999字"), { min: 50_000, max: 50_000 });
  assert.equal(parseRequestedLengthRange("篇幅不限"), null);
});

test("parses an English request for an approximate Chinese-character length", () => {
  assert.deepEqual(
    parseRequestedLengthRange("Draft an approximately 300-Chinese-character speech."),
    { min: 270, max: 330 }
  );
});

test("counts visible document characters without markdown or whitespace", () => {
  assert.equal(countGovernmentWritingCharacters("# 标题\n\n同志们： **大家好**。"), 10);
  assert.equal(isGovernmentWritingLengthAccepted("中".repeat(720), { min: 720, max: 880 }), true);
  assert.equal(isGovernmentWritingLengthAccepted("中".repeat(1046), { min: 720, max: 880 }), false);
});

test("revises an out-of-range draft until it passes without invoking tools", async () => {
  const attempts: number[] = [];
  const result = await enforceGovernmentWritingLength({
    text: "中".repeat(1046),
    range: { min: 720, max: 880 },
    revise: async (_text, _count, attempt) => {
      attempts.push(attempt);
      return attempt === 1 ? "中".repeat(900) : "中".repeat(800);
    }
  });
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(countGovernmentWritingCharacters(result), 800);
});

test("does not revise a draft that already satisfies the requested range", async () => {
  let calls = 0;
  const result = await enforceGovernmentWritingLength({
    text: "中".repeat(800),
    range: { min: 720, max: 880 },
    revise: async () => { calls += 1; return "unexpected"; }
  });
  assert.equal(calls, 0);
  assert.equal(countGovernmentWritingCharacters(result), 800);
});

test("safely trims an overlong model revision after retries are exhausted", async () => {
  const result = await enforceGovernmentWritingLength({
      text: "一".repeat(500),
      range: { min: 270, max: 330 },
      maxRevisions: 3,
      revise: async () => "一".repeat(400)
  });
  assert.equal(countGovernmentWritingCharacters(result), 330);
  assert.match(result, /。$/);
});

test("prefers complete Chinese sentences when trimming", () => {
  const result = trimGovernmentWritingToRange(
    `同志们：${"甲".repeat(140)}。${"乙".repeat(140)}。${"丙".repeat(140)}。`,
    { min: 270, max: 330 }
  );
  assert.equal(result.includes("丙"), false);
  assert.equal(isGovernmentWritingLengthAccepted(result, { min: 270, max: 330 }), true);
});

test("rejects an under-length draft when model revisions cannot satisfy the range", async () => {
  const range = { min: 270, max: 330 };
  await assert.rejects(() => enforceGovernmentWritingLength({
      text: "同志们，今天部署下一阶段工作。",
      range,
      maxRevisions: 0,
      revise: async () => ""
    }), /长度校验未通过/u);
});

test("never replaces a truncated draft with a scenario template", async () => {
  const range = { min: 1080, max: 1320 };
  await assert.rejects(() => enforceGovernmentWritingLength({
      text: "农业案例稿件被模型异常截断。",
      range,
      evidenceContext: "历史对话曾讨论煤炭企业、原煤产量301万吨；当前任务是农业新质生产力案例分析。",
      maxRevisions: 0,
      revise: async () => ""
    }), /长度校验未通过/u);
});

test("keeps scenario material out of production fallback code", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("./government-writing-output.ts", import.meta.url), "utf8")
  );
  assert.doesNotMatch(source, /煤炭企业2025年年终总结发言稿|窗口与后台协同/u);
});
