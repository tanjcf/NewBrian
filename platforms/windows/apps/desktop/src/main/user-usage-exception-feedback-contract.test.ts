import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner loads this source file directly.
import { parseConfirmUsageExceptionFeedbackInput, parseCreateUsageExceptionFeedbackPreviewInput } from "./user-usage-exception-feedback-contract.ts";

test("accepts and trims the exact preview input fields", () => {
  assert.deepEqual(parseCreateUsageExceptionFeedbackPreviewInput({
    workspaceId: " workspace-1 ",
    threadId: " thread-1 ",
    description: " 生成文档后一直没有完成 "
  }), {
    workspaceId: "workspace-1",
    threadId: "thread-1",
    description: "生成文档后一直没有完成"
  });
});

test("rejects renderer-provided trusted or unknown preview fields", () => {
  for (const forbidden of ["title", "logs", "environment", "deviceId", "appVersion", "context"]) {
    assert.throws(() => parseCreateUsageExceptionFeedbackPreviewInput({
      workspaceId: "workspace-1",
      threadId: "thread-1",
      description: "界面空白",
      [forbidden]: "renderer-controlled"
    }), /exactly workspaceId, threadId, and description/);
  }
});

test("rejects empty identifiers and oversized descriptions", () => {
  assert.throws(() => parseCreateUsageExceptionFeedbackPreviewInput({
    workspaceId: "",
    threadId: "thread-1",
    description: "界面空白"
  }), /workspaceId/);
  assert.throws(() => parseCreateUsageExceptionFeedbackPreviewInput({
    workspaceId: "workspace-1",
    threadId: "thread-1",
    description: "x".repeat(4_001)
  }), /4,000/);
});

test("confirm accepts only one non-empty preview identifier", () => {
  assert.deepEqual(parseConfirmUsageExceptionFeedbackInput({ previewId: " preview-1 " }), {
    previewId: "preview-1"
  });
  assert.throws(() => parseConfirmUsageExceptionFeedbackInput({ previewId: "preview-1", title: "changed" }), /exactly previewId/);
  assert.throws(() => parseConfirmUsageExceptionFeedbackInput({ previewId: " " }), /previewId/);
});
