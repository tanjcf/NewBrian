import assert from "node:assert/strict";
import test from "node:test";

import { projectModelChatFailure } from "./model-chat-failure-projection.ts";

test("projects a model failure as visible assistant content", () => {
  assert.deepEqual(projectModelChatFailure({
    content: "",
    reasoningSummary: ""
  }, "Auto 路由网关不可达"), {
    content: "请求未能完成：Auto 路由网关不可达",
    reasoningSummary: "本轮在完成前发生异常：Auto 路由网关不可达",
    excludeFromModelContext: true
  });
});

test("preserves partial model content when projecting a failure", () => {
  assert.deepEqual(projectModelChatFailure({
    content: "已有部分回复",
    reasoningSummary: "正在处理"
  }, "provider timeout", "更长的流式部分回复"), {
    content: "更长的流式部分回复",
    reasoningSummary: "正在处理\n\n本轮在完成前发生异常：provider timeout",
    excludeFromModelContext: true
  });
});
