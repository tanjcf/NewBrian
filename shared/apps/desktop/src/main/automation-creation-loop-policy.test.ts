import assert from "node:assert/strict";
import test from "node:test";
import { agentLoopAllowedToolNames } from "./automation-creation-loop-policy.ts";

const tools = ["shell.exec", "workspace.read"];

test("automation creation turns do not receive tools", () => {
  assert.deepEqual(agentLoopAllowedToolNames({
    latestUserRequest: "请帮我创建一个自动化任务：每天早上 08:00（北京时间）启动运维工程师 skill，对当前已配置的各节点进行巡检。",
    governmentRevisionPreview: false,
    remoteAllowedToolNames: tools
  }), []);
});

test("ordinary work keeps the remote tool allowlist", () => {
  assert.deepEqual(agentLoopAllowedToolNames({
    latestUserRequest: "看一下当前项目的 git 状态",
    governmentRevisionPreview: false,
    remoteAllowedToolNames: tools
  }), tools);
});
