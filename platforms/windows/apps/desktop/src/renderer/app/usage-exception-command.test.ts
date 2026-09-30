import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner loads this source file directly.
import { parseUsageExceptionCommand } from "./usage-exception-command.ts";

test("matches a usage exception command and removes a Chinese colon", () => {
  assert.deepEqual(parseUsageExceptionCommand("newbrain使用异常：生成文档后一直没有完成"), {
    matched: true,
    description: "生成文档后一直没有完成"
  });
});

test("matches case-insensitively with surrounding whitespace and an ASCII colon", () => {
  assert.deepEqual(parseUsageExceptionCommand("  NewBrain使用异常: 登录后界面空白  "), {
    matched: true,
    description: "登录后界面空白"
  });
});

test("rejects a matched command without an exception description", () => {
  assert.deepEqual(parseUsageExceptionCommand("newbrain使用异常 ：  "), {
    matched: true,
    error: "请补充 NewBrain 使用异常的具体现象。"
  });
});

test("does not match when the trigger phrase is not at the beginning", () => {
  assert.deepEqual(parseUsageExceptionCommand("如何理解 newbrain使用异常 这个功能？"), {
    matched: false
  });
});

test("does not match a longer word that merely starts with the trigger characters", () => {
  assert.deepEqual(parseUsageExceptionCommand("newbrain使用异常率怎么统计"), {
    matched: false
  });
});
