import assert from "node:assert/strict";
import test from "node:test";
import {
  isApprovalWaitNotice,
  settleApprovalWaitFinalContent,
  stripApprovalWaitNotice
} from "./approval-wait-notice.ts";

const NOTICE = [
  "已请求执行工具，等待你批准后继续。",
  "待确认工具：shell.exec",
  "批准后会继续生成可见结果；拒绝则本轮停止。"
].join("\n\n");

test("approval wait copy is recognized and removed after the decision", () => {
  assert.equal(isApprovalWaitNotice(NOTICE), true);
  assert.equal(stripApprovalWaitNotice(NOTICE), "");
  assert.equal(settleApprovalWaitFinalContent(NOTICE, "命令已执行。"), "命令已执行。");
});

test("a real answer stored with the wait copy is kept", () => {
  const mixed = `${NOTICE}\n\n已找到 2026 年最新进展。`;
  assert.equal(stripApprovalWaitNotice(mixed), "已找到 2026 年最新进展。");
  assert.equal(settleApprovalWaitFinalContent(mixed, "fallback"), "已找到 2026 年最新进展。");
});

test("ordinary answers are unchanged", () => {
  assert.equal(isApprovalWaitNotice("编辑了方案。"), false);
  assert.equal(settleApprovalWaitFinalContent("编辑了方案。", "fallback"), "编辑了方案。");
});
